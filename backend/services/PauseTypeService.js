const { executeNonQuery, executeQuery, appDb, appDatabaseName } = require('../config/database');
const {
    PAUSE_TYPES,
    normalizePauseTypeCode,
    getPauseTypeLabel,
    countedPauseMinutes
} = require('../constants/pauseTypes');

let tableReady = false;
let historiquePauseTypeReady = false;

async function ensurePauseTypeLogTable() {
    if (tableReady) return;
    await executeNonQuery(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AB_PAUSE_TYPE_LOG')
        BEGIN
            CREATE TABLE ${appDb}.[dbo].[AB_PAUSE_TYPE_LOG] (
                Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                RequestId NVARCHAR(64) NULL,
                OperatorCode NVARCHAR(50) NOT NULL,
                LancementCode NVARCHAR(50) NOT NULL,
                PauseTypeCode NVARCHAR(32) NOT NULL,
                DateCreation DATE NOT NULL,
                HeureDebut TIME NULL,
                CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AB_PAUSE_TYPE_LOG_CreatedAt DEFAULT SYSUTCDATETIME()
            );
            CREATE INDEX IX_AB_PAUSE_TYPE_LOG_Operator_Date
                ON ${appDb}.[dbo].[AB_PAUSE_TYPE_LOG] (OperatorCode, DateCreation);
        END
    `);
    tableReady = true;
}

/** Colonne PauseTypeCode sur l'historique — type collé à l'événement PAUSE. */
async function ensureHistoriquePauseTypeColumn() {
    if (historiquePauseTypeReady) return;
    try {
        await executeNonQuery(`
            IF COL_LENGTH('${appDatabaseName}.dbo.ABHISTORIQUE_OPERATEURS', 'PauseTypeCode') IS NULL
            BEGIN
                ALTER TABLE ${appDb}.[dbo].[ABHISTORIQUE_OPERATEURS]
                    ADD [PauseTypeCode] NVARCHAR(32) NULL;
            END
        `);
        historiquePauseTypeReady = true;
    } catch (e) {
        console.warn('ensureHistoriquePauseTypeColumn:', e.message);
    }
}

async function savePauseType({
    requestId,
    operatorCode,
    lancementCode,
    pauseTypeCode,
    dateCreation,
    heureDebut
}) {
    const code = normalizePauseTypeCode(pauseTypeCode);
    if (!code) {
        throw new Error('INVALID_PAUSE_TYPE');
    }
    await ensurePauseTypeLogTable();
    await executeNonQuery(
        `
        INSERT INTO ${appDb}.[dbo].[AB_PAUSE_TYPE_LOG]
            (RequestId, OperatorCode, LancementCode, PauseTypeCode, DateCreation, HeureDebut)
        VALUES
            (@requestId, @operatorCode, @lancementCode, @pauseTypeCode, CAST(@dateCreation AS DATE), CAST(@heureDebut AS TIME))
        `,
        {
            requestId: requestId || null,
            operatorCode,
            lancementCode,
            pauseTypeCode: code,
            dateCreation,
            heureDebut
        }
    );
    return { code, label: getPauseTypeLabel(code) };
}

function timeToMinutes(value) {
    if (value == null) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.getHours() * 60 + value.getMinutes() + value.getSeconds() / 60;
    }
    const str = String(value);
    const m = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]) + Number(m[3] || 0) / 60;
}

function minutesBetween(start, end) {
    const a = timeToMinutes(start);
    const b = timeToMinutes(end);
    if (a == null || b == null) return 0;
    let diff = b - a;
    if (diff < 0) diff += 24 * 60;
    return Math.max(0, Math.round(diff));
}

function toDateKey(value) {
    if (!value) return null;
    if (value instanceof Date) {
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const str = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
    return str;
}

/** Date / heure courantes en Europe/Paris (compteurs atelier). */
function parisNowParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        clock: `${parts.hour}:${parts.minute}:${parts.second}`
    };
}

function todayKeyParis(date = new Date()) {
    return parisNowParts(date).dateKey;
}

const DAY_TARGET_MINUTES = 8 * 60 + 45; // 8h45 lun–jeu
const FRIDAY_TARGET_MINUTES = 5 * 60; // 5h vendredi (fermeture 13h)

function targetMinutesForDate(dateKey) {
    const d = new Date(`${dateKey}T12:00:00`);
    // 5 = vendredi
    return d.getDay() === 5 ? FRIDAY_TARGET_MINUTES : DAY_TARGET_MINUTES;
}

function enrichDayCounters(row) {
    const pauseMinutes = Number(row.pauseMinutes) || 0;
    const autreMinutes = Number(row.autreMinutes) || 0;
    const formationMinutes = Number(row.formationMinutes) || 0;
    const presenceMinutes = Number(row.productiveMinutes) || 0;
    const targetMinutes = targetMinutesForDate(row.date);
    const remainingMinutes = Math.max(0, targetMinutes - presenceMinutes);
    return {
        ...row,
        pauseMinutes,
        autreMinutes,
        formationMinutes,
        presenceMinutes,
        totalTrackedMinutes: presenceMinutes + pauseMinutes + autreMinutes + formationMinutes,
        targetMinutes,
        remainingMinutes,
        schedule: Array.isArray(row.schedule) ? row.schedule : []
    };
}

/**
 * Horaires RH : mêmes lignes que la prod (début → fin), sans produit / lancement.
 * - Présent 15:25 → 17:10 · Terminé
 * - Pause déjeuner 12:00 → 12:45 · Terminée
 * FIN utilise HeureFin (comme l'admin), pas seulement HeureDebut.
 */
function formatEventClock(value) {
    if (value == null || value === '') return null;
    if (Array.isArray(value)) return formatEventClock(value[0]);
    if (typeof value === 'string') {
        const m = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(value.trim());
        if (m) return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
        return null;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
    }
    return null;
}

function eventStartClock(ev) {
    return formatEventClock(ev?.HeureDebut) || formatEventClock(ev?.HeureFin);
}

function eventEndClock(ev) {
    return formatEventClock(ev?.HeureFin) || formatEventClock(ev?.HeureDebut);
}

function buildPunchScheduleByDate(events, pauseTypeRows = []) {
    const typeIndex = [];
    for (const row of pauseTypeRows || []) {
        typeIndex.push({
            date: toDateKey(row.DateCreation),
            lancement: String(row.LancementCode || '').trim(),
            heure: String(row.HeureDebut || '').slice(0, 8),
            label: getPauseTypeLabel(row.PauseTypeCode)
        });
    }
    const findPauseLabel = (dateKey, lancement, heureDebut, eventPauseTypeCode = null) => {
        const fromEvent = normalizePauseTypeCode(eventPauseTypeCode);
        if (fromEvent) return getPauseTypeLabel(fromEvent) || 'Pause';
        const h = String(heureDebut || '').slice(0, 8);
        const h5 = h.slice(0, 5);
        const lt = String(lancement || '').trim();
        const exact = typeIndex.find((t) => t.date === dateKey && t.lancement === lt && t.heure === h);
        if (exact?.label) return exact.label;
        const byMin = typeIndex.find((t) => t.date === dateKey && t.lancement === lt && String(t.heure || '').slice(0, 5) === h5);
        if (byMin?.label) return byMin.label;
        return typeIndex.find((t) => t.date === dateKey && t.lancement === lt)?.label || 'Pause';
    };

    // RH : une seule timeline par jour (sans produit) — tous les LT fusionnés
    const byDateEvents = new Map();
    for (const ev of events || []) {
        const dateKey = toDateKey(ev.DateCreation);
        if (!dateKey) continue;
        if (!byDateEvents.has(dateKey)) byDateEvents.set(dateKey, []);
        byDateEvents.get(dateKey).push(ev);
    }

    const byDate = new Map();
    const pushLine = (dateKey, line) => {
        if (!byDate.has(dateKey)) byDate.set(dateKey, []);
        byDate.get(dateKey).push(line);
    };

    for (const [dateKey, groupEventsRaw] of byDateEvents) {
        const groupEvents = [...groupEventsRaw].sort((a, b) => {
            const ta = eventStartClock(a) || eventEndClock(a) || '';
            const tb = eventStartClock(b) || eventEndClock(b) || '';
            if (ta !== tb) return ta.localeCompare(tb);
            return (a.NoEnreg || 0) - (b.NoEnreg || 0);
        });

        const debutIndices = [];
        for (let i = 0; i < groupEvents.length; i++) {
            if (String(groupEvents[i]?.Ident || '').toUpperCase() === 'DEBUT') debutIndices.push(i);
        }
        if (!debutIndices.length) continue;

        debutIndices.forEach((startIdx, idx) => {
            const endIdx = (idx + 1 < debutIndices.length)
                ? debutIndices[idx + 1] - 1
                : groupEvents.length - 1;
            const cycle = groupEvents.slice(startIdx, endIdx + 1);
            const debutEvent = cycle.find((e) => String(e.Ident || '').toUpperCase() === 'DEBUT');
            // FIN peut avoir HeureDebut NULL et seulement HeureFin
            const finEvent = [...cycle].reverse().find((e) => String(e.Ident || '').toUpperCase() === 'FIN');
            const pauseEvents = cycle.filter((e) => String(e.Ident || '').toUpperCase() === 'PAUSE');
            const repriseEvents = cycle.filter((e) => String(e.Ident || '').toUpperCase() === 'REPRISE');
            if (!debutEvent) return;

            let workStart = debutEvent;
            const usedReprises = new Set();

            if (!pauseEvents.length) {
                const from = eventStartClock(debutEvent);
                const to = finEvent ? eventEndClock(finEvent) : null;
                if (!from) return;
                pushLine(dateKey, {
                    from,
                    to,
                    label: 'Présent',
                    status: finEvent ? 'Terminé' : 'En cours',
                    kind: 'WORK',
                    ident: finEvent ? 'FIN' : 'DEBUT'
                });
                return;
            }

            for (let p = 0; p < pauseEvents.length; p++) {
                const pauseEvent = pauseEvents[p];
                const pauseFrom = eventStartClock(workStart);
                const pauseAt = eventStartClock(pauseEvent);
                const isLast = p === pauseEvents.length - 1;
                const repriseEvent = repriseEvents.find((r) => {
                    if (usedReprises.has(r.NoEnreg)) return false;
                    const rt = eventStartClock(r) || '';
                    return rt >= (pauseAt || '');
                }) || null;
                if (repriseEvent) usedReprises.add(repriseEvent.NoEnreg);

                if (pauseFrom && pauseAt) {
                    const openPause = isLast && !repriseEvent && !finEvent;
                    pushLine(dateKey, {
                        from: pauseFrom,
                        to: pauseAt,
                        label: 'Présent',
                        status: openPause ? 'En pause' : 'Terminé',
                        kind: 'WORK',
                        ident: 'DEBUT'
                    });
                }

                const pauseLabel = findPauseLabel(
                    dateKey,
                    pauseEvent.CodeLanctImprod,
                    String(pauseEvent.HeureDebut || '').slice(0, 8),
                    pauseEvent.PauseTypeCode
                );
                pushLine(dateKey, {
                    from: pauseAt,
                    to: repriseEvent ? eventStartClock(repriseEvent) : null,
                    label: pauseLabel,
                    status: repriseEvent ? 'Terminée' : 'En pause',
                    kind: 'PAUSE',
                    ident: 'PAUSE'
                });

                if (repriseEvent) workStart = repriseEvent;
            }

            if (finEvent) {
                const from = eventStartClock(workStart);
                const to = eventEndClock(finEvent);
                if (from) {
                    pushLine(dateKey, {
                        from,
                        to: to || from,
                        label: 'Présent',
                        status: 'Terminé',
                        kind: 'WORK',
                        ident: 'FIN'
                    });
                }
            } else {
                const lastIdent = String(cycle[cycle.length - 1]?.Ident || '').toUpperCase();
                if (lastIdent === 'REPRISE' || lastIdent === 'DEBUT') {
                    const from = eventStartClock(workStart);
                    if (from) {
                        pushLine(dateKey, {
                            from,
                            to: null,
                            label: 'Présent',
                            status: 'En cours',
                            kind: 'WORK',
                            ident: 'REPRISE'
                        });
                    }
                }
            }
        });
    }

    for (const [, lines] of byDate) {
        lines.sort((a, b) => {
            const fa = `${a.from || ''}-${a.to || '99:99'}`;
            const fb = `${b.from || ''}-${b.to || '99:99'}`;
            return fa.localeCompare(fb);
        });
    }
    return byDate;
}

/**
 * Construit les compteurs jour par jour (lundi → vendredi) à partir des événements historique + types de pause.
 * Compteur principal : reste à faire depuis 8h45 jusqu'à 0.
 */
function buildWeekCounters(events, pauseTypeRows, { weekStart, weekEnd } = {}) {
    const byDate = new Map();

    const ensureDay = (dateKey) => {
        if (!byDate.has(dateKey)) {
            byDate.set(dateKey, {
                date: dateKey,
                productiveMinutes: 0,
                pauseMinutes: 0,
                autreMinutes: 0,
                formationMinutes: 0,
                pauses: [],
                segments: []
            });
        }
        return byDate.get(dateKey);
    };

    const applyPauseMinutes = (day, typ, mins) => {
        const code = typ?.code || null;
        const actual = Math.max(0, Math.round(Number(mins) || 0));
        const counted = countedPauseMinutes(code, actual);

        if (code === 'AUTRE') {
            day.autreMinutes += counted;
        } else if (code === 'FORMATION') {
            day.formationMinutes += counted;
        } else {
            day.pauseMinutes += counted;
        }

        // DEJ : min 45 min déduites ; au-delà = durée réelle jusqu'au repointage.
        // Le productif a déjà exclu `actual` : on ajuste si actual < 45.
        if (code === 'DEJ') {
            day.productiveMinutes += (actual - counted);
            if (day.productiveMinutes < 0) day.productiveMinutes = 0;
        }

        return { countedMinutes: counted, actualMinutes: actual };
    };

    // Index types: operator|date|lancement|heureApprox
    const typeIndex = [];
    for (const row of pauseTypeRows || []) {
        typeIndex.push({
            date: toDateKey(row.DateCreation),
            lancement: String(row.LancementCode || '').trim(),
            heure: String(row.HeureDebut || '').slice(0, 8),
            code: normalizePauseTypeCode(row.PauseTypeCode),
            label: getPauseTypeLabel(row.PauseTypeCode)
        });
    }

    const findType = (dateKey, lancement, heureDebut, eventPauseTypeCode = null) => {
        const fromEvent = normalizePauseTypeCode(eventPauseTypeCode);
        if (fromEvent) {
            return { code: fromEvent, label: getPauseTypeLabel(fromEvent) };
        }
        const h = String(heureDebut || '').slice(0, 8);
        const h5 = h.slice(0, 5);
        const lt = String(lancement || '').trim();
        const exact = typeIndex.find((t) => t.date === dateKey && t.lancement === lt && t.heure === h);
        if (exact) return exact;
        const byMin = typeIndex.find((t) => t.date === dateKey && t.lancement === lt && String(t.heure || '').slice(0, 5) === h5);
        if (byMin) return byMin;
        return typeIndex.find((t) => t.date === dateKey && t.lancement === lt) || null;
    };

    // Timeline présence par jour (tous LT fusionnés) — comme le RH.
    // Évite les trous quand CodeRubrique/phase diffèrent entre DEBUT et FIN.
    const byDateEvents = new Map();
    for (const ev of events || []) {
        const dateKey = toDateKey(ev.DateCreation);
        if (!dateKey) continue;
        if (weekStart && dateKey < weekStart) continue;
        if (weekEnd && dateKey > weekEnd) continue;
        if (!byDateEvents.has(dateKey)) byDateEvents.set(dateKey, []);
        byDateEvents.get(dateKey).push(ev);
    }

    const { dateKey: todayKey, clock: nowClock } = parisNowParts();

    for (const [dateKey, listRaw] of byDateEvents) {
        const list = [...listRaw].sort((a, b) => {
            const ta = timeToMinutes(a.HeureDebut) ?? timeToMinutes(a.HeureFin) ?? 0;
            const tb = timeToMinutes(b.HeureDebut) ?? timeToMinutes(b.HeureFin) ?? 0;
            if (ta !== tb) return ta - tb;
            return (a.NoEnreg || 0) - (b.NoEnreg || 0);
        });

        let openWorkStart = null;
        let openPause = null;
        const day = ensureDay(dateKey);

        for (const ev of list) {
            const ident = String(ev.Ident || '').toUpperCase();

            if (ident === 'DEBUT' || ident === 'REPRISE') {
                if (openPause) {
                    const mins = minutesBetween(openPause.HeureDebut, ev.HeureDebut);
                    const typ = findType(
                        dateKey,
                        openPause.CodeLanctImprod,
                        openPause.HeureDebut,
                        openPause.PauseTypeCode
                    );
                    const applied = applyPauseMinutes(day, typ, mins);
                    day.pauses.push({
                        typeCode: typ?.code || null,
                        typeLabel: typ?.label || 'Pause',
                        minutes: applied.countedMinutes,
                        actualMinutes: applied.actualMinutes,
                        from: String(openPause.HeureDebut || '').slice(0, 8),
                        to: String(ev.HeureDebut || '').slice(0, 8)
                    });
                    openPause = null;
                }
                // Nouveau DEBUT alors qu'un travail était ouvert (FIN manquant) : clôturer avant
                if (ident === 'DEBUT' && openWorkStart) {
                    const mins = minutesBetween(openWorkStart, ev.HeureDebut);
                    if (mins > 0) {
                        day.productiveMinutes += mins;
                        day.segments.push({
                            from: String(openWorkStart || '').slice(0, 8),
                            to: String(ev.HeureDebut || '').slice(0, 8),
                            minutes: mins
                        });
                    }
                }
                openWorkStart = ev.HeureDebut;
            } else if (ident === 'PAUSE') {
                if (openWorkStart) {
                    const mins = minutesBetween(openWorkStart, ev.HeureDebut);
                    day.productiveMinutes += mins;
                    day.segments.push({
                        from: String(openWorkStart || '').slice(0, 8),
                        to: String(ev.HeureDebut || '').slice(0, 8),
                        minutes: mins
                    });
                    openWorkStart = null;
                }
                openPause = ev;
            } else if (ident === 'FIN') {
                if (openPause) {
                    const end = ev.HeureDebut || ev.HeureFin;
                    const mins = minutesBetween(openPause.HeureDebut, end);
                    const typ = findType(
                        dateKey,
                        openPause.CodeLanctImprod,
                        openPause.HeureDebut,
                        openPause.PauseTypeCode
                    );
                    const applied = applyPauseMinutes(day, typ, mins);
                    day.pauses.push({
                        typeCode: typ?.code || null,
                        typeLabel: typ?.label || 'Pause',
                        minutes: applied.countedMinutes,
                        actualMinutes: applied.actualMinutes,
                        from: String(openPause.HeureDebut || '').slice(0, 8),
                        to: String(end || '').slice(0, 8)
                    });
                    openPause = null;
                }
                if (openWorkStart) {
                    const end = ev.HeureFin || ev.HeureDebut;
                    const mins = minutesBetween(openWorkStart, end);
                    day.productiveMinutes += mins;
                    day.segments.push({
                        from: String(openWorkStart || '').slice(0, 8),
                        to: String(end || '').slice(0, 8),
                        minutes: mins
                    });
                    openWorkStart = null;
                }
            }
        }

        // Segment encore ouvert : compter jusqu'à maintenant (jour courant) pour un flux fiable
        if (dateKey === todayKey) {
            if (openWorkStart) {
                const mins = minutesBetween(openWorkStart, nowClock);
                if (mins > 0) {
                    day.productiveMinutes += mins;
                    day.segments.push({
                        from: String(openWorkStart || '').slice(0, 8),
                        to: String(nowClock).slice(0, 8),
                        minutes: mins,
                        open: true
                    });
                }
            } else if (openPause) {
                const mins = minutesBetween(openPause.HeureDebut, nowClock);
                const typ = findType(
                    dateKey,
                    openPause.CodeLanctImprod,
                    openPause.HeureDebut,
                    openPause.PauseTypeCode
                );
                const applied = applyPauseMinutes(day, typ, mins);
                day.pauses.push({
                    typeCode: typ?.code || null,
                    typeLabel: typ?.label || 'Pause',
                    minutes: applied.countedMinutes,
                    actualMinutes: applied.actualMinutes,
                    from: String(openPause.HeureDebut || '').slice(0, 8),
                    to: String(nowClock).slice(0, 8),
                    open: true
                });
            }
        }
    }

    // Lundi → vendredi uniquement (pas samedi / dimanche)
    const scheduleByDate = buildPunchScheduleByDate(events, pauseTypeRows);
    const days = [];
    if (weekStart) {
        const start = new Date(`${weekStart}T12:00:00`);
        for (let i = 0; i < 5; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const key = toDateKey(d);
            const row = byDate.get(key) || {
                date: key,
                productiveMinutes: 0,
                pauseMinutes: 0,
                autreMinutes: 0,
                formationMinutes: 0,
                pauses: [],
                segments: []
            };
            row.schedule = scheduleByDate.get(key) || [];
            days.push(enrichDayCounters(row));
        }
    } else {
        for (const row of byDate.values()) {
            const d = new Date(`${row.date}T12:00:00`);
            const dow = d.getDay(); // 0=dim … 6=sam
            if (dow === 0 || dow === 6) continue;
            row.schedule = scheduleByDate.get(row.date) || [];
            days.push(enrichDayCounters(row));
        }
        days.sort((a, b) => a.date.localeCompare(b.date));
    }

    return days;
}

function emptyTotals(targetMinutes = 0) {
    return {
        targetMinutes,
        presenceMinutes: 0,
        remainingMinutes: targetMinutes,
        pauseMinutes: 0,
        autreMinutes: 0,
        formationMinutes: 0
    };
}

function sumDayTotals(days, targetMinutes) {
    const totals = emptyTotals(targetMinutes);
    for (const day of days || []) {
        totals.presenceMinutes += Number(day.presenceMinutes) || 0;
        totals.remainingMinutes += Number(day.remainingMinutes) || 0;
        totals.pauseMinutes += Number(day.pauseMinutes) || 0;
        totals.autreMinutes += Number(day.autreMinutes) || 0;
        totals.formationMinutes += Number(day.formationMinutes) || 0;
    }
    return totals;
}

/**
 * Sépare clairement la semaine RH : Lundi→Jeudi vs Vendredi isolé.
 * Aucune notion payé / non payé.
 */
function splitWeekForRh(days = []) {
    const monThuDays = [];
    let fridayDay = null;
    for (const day of days) {
        const dow = new Date(`${day.date}T12:00:00`).getDay();
        if (dow >= 1 && dow <= 4) monThuDays.push(day);
        else if (dow === 5) fridayDay = day;
    }

    const monThuTargetTotal = monThuDays.length * DAY_TARGET_MINUTES;
    const fridayTotals = fridayDay
        ? {
            targetMinutes: FRIDAY_TARGET_MINUTES,
            presenceMinutes: Number(fridayDay.presenceMinutes) || 0,
            remainingMinutes: Number(fridayDay.remainingMinutes) || 0,
            pauseMinutes: Number(fridayDay.pauseMinutes) || 0,
            autreMinutes: Number(fridayDay.autreMinutes) || 0,
            formationMinutes: Number(fridayDay.formationMinutes) || 0
        }
        : emptyTotals(FRIDAY_TARGET_MINUTES);

    return {
        monThu: {
            label: 'Lundi → Jeudi',
            targetMinutesPerDay: DAY_TARGET_MINUTES,
            days: monThuDays,
            totals: sumDayTotals(monThuDays, monThuTargetTotal)
        },
        friday: {
            label: 'Vendredi (isolé)',
            targetMinutesPerDay: FRIDAY_TARGET_MINUTES,
            day: fridayDay,
            totals: fridayTotals
        }
    };
}

async function getPauseTypesForRange(dateStart, dateEnd, operatorCode = null) {
    try {
        await ensurePauseTypeLogTable();
        if (operatorCode) {
            return await getPauseTypesForOperator(operatorCode, dateStart, dateEnd);
        }
        return await executeQuery(
            `
            SELECT RequestId, OperatorCode, LancementCode, PauseTypeCode, DateCreation,
                   CONVERT(VARCHAR(8), HeureDebut, 108) AS HeureDebut
            FROM ${appDb}.[dbo].[AB_PAUSE_TYPE_LOG]
            WHERE DateCreation >= CAST(@dateStart AS DATE)
              AND DateCreation <= CAST(@dateEnd AS DATE)
            `,
            { dateStart, dateEnd }
        );
    } catch (e) {
        console.warn('PauseType log range read failed:', e.message);
        return [];
    }
}

async function getPauseTypesForOperator(operatorCode, dateStart, dateEnd) {
    try {
        await ensurePauseTypeLogTable();
        return await executeQuery(
            `
            SELECT RequestId, OperatorCode, LancementCode, PauseTypeCode, DateCreation,
                   CONVERT(VARCHAR(8), HeureDebut, 108) AS HeureDebut
            FROM ${appDb}.[dbo].[AB_PAUSE_TYPE_LOG]
            WHERE OperatorCode = @operatorCode
              AND DateCreation >= CAST(@dateStart AS DATE)
              AND DateCreation <= CAST(@dateEnd AS DATE)
            `,
            { operatorCode, dateStart, dateEnd }
        );
    } catch (e) {
        console.warn('PauseType log read failed:', e.message);
        return [];
    }
}

function getMondayOfWeek(refDate = new Date()) {
    const d = new Date(refDate);
    const day = d.getDay(); // 0 Sun
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return toDateKey(d);
}

function addDays(dateKey, n) {
    const d = new Date(`${dateKey}T12:00:00`);
    d.setDate(d.getDate() + n);
    return toDateKey(d);
}

module.exports = {
    PAUSE_TYPES,
    DAY_TARGET_MINUTES,
    FRIDAY_TARGET_MINUTES,
    targetMinutesForDate,
    ensurePauseTypeLogTable,
    ensureHistoriquePauseTypeColumn,
    savePauseType,
    buildWeekCounters,
    buildPunchScheduleByDate,
    splitWeekForRh,
    getPauseTypesForOperator,
    getPauseTypesForRange,
    getMondayOfWeek,
    addDays,
    todayKeyParis,
    parisNowParts,
    normalizePauseTypeCode,
    getPauseTypeLabel
};
