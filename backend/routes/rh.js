/**
 * Routes RH — accès séparé de l'admin production.
 * Vue temps : Lundi→Jeudi vs Vendredi isolé. Sans payé / non payé.
 * Liste complète des opérateurs avec nom / prénom (RESSOURC).
 */
const express = require('express');
const router = express.Router();
const { executeQuery, appDb } = require('../config/database');
const { authenticateRh } = require('../middleware/auth');
const PauseTypeService = require('../services/PauseTypeService');
const RhTimeService = require('../services/RhTimeService');
const { PAUSE_TYPES } = require('../constants/pauseTypes');
const ExcelJS = require('exceljs');
const { processLancementEventsWithPauses } = require('./admin');

router.use(authenticateRh);

/** HH:mm depuis un champ heure admin (HH:mm ou HH:mm:ss ou datetime). */
function toClock(value) {
    if (value == null || value === '' || value === '-') return null;
    const s = String(value);
    const m = s.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}

function scheduleLineParts(line) {
    if (!line) return null;
    const type = line.type || line.label
        || (String(line.kind || '').toUpperCase() === 'PAUSE' ? 'Pause' : 'Présent');
    const start = toClock(line.startTime || line.from) || '—';
    const end = toClock(line.endTime || line.to) || '—';
    return { type, start, end };
}

function dayScheduleLines(day) {
    return (Array.isArray(day?.schedule) ? day.schedule : [])
        .map(scheduleLineParts)
        .filter(Boolean);
}

function lineDateKey(value) {
    if (value == null || value === '') return '';
    if (typeof RhTimeService.toDateKey === 'function') {
        return RhTimeService.toDateKey(value);
    }
    if (typeof value === 'string') {
        const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
        if (iso) return iso[1];
    }
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mapClock(value) {
    if (value == null || value === '' || value === '-') return '—';
    return String(value);
}

function mapTimelineLine(line) {
    return {
        type: line.type || line.label || (String(line.kind || '').toUpperCase() === 'PAUSE' ? 'Pause' : 'Présent'),
        startTime: mapClock(line.startTime || line.from),
        endTime: mapClock(line.endTime || line.to),
        status: line.status || '',
        statusCode: line.statusCode || '',
        kind: line.kind || 'WORK'
    };
}

function clockToMinutes(clock) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(clock || '').trim());
    if (!m) return null;
    return (Number(m[1]) * 60) + Number(m[2]);
}

/**
 * RH : fusionne les présences continues entre lancements (changement de LT).
 * On ne coupe que s'il y a une vraie pause / un trou > maxGapMinutes.
 */
function mergeRhPresenceLines(lines, maxGapMinutes = 2) {
    if (!Array.isArray(lines) || lines.length < 2) return lines || [];
    const sorted = [...lines].sort((a, b) =>
        String(a.startTime || '').localeCompare(String(b.startTime || ''))
    );
    const out = [];
    for (const raw of sorted) {
        const line = { ...raw };
        const kind = String(line.kind || '').toUpperCase();
        const prev = out[out.length - 1];
        const prevKind = String(prev?.kind || '').toUpperCase();
        const prevIsOpenPause = /en pause/i.test(String(prev?.status || ''))
            || (prevKind !== 'PAUSE' && /pause/i.test(String(prev?.type || '')) && !/présent/i.test(String(prev?.type || '')));

        if (!prev || kind === 'PAUSE' || prevKind === 'PAUSE' || prevIsOpenPause) {
            out.push(line);
            continue;
        }

        const prevEnd = clockToMinutes(prev.endTime);
        const nextStart = clockToMinutes(line.startTime);
        if (prevEnd == null || nextStart == null) {
            out.push(line);
            continue;
        }

        const gap = nextStart - prevEnd;
        if (gap < 0 || gap > maxGapMinutes) {
            out.push(line);
            continue;
        }

        // Coller les deux segments Présent (ex. FIN LT1 puis DEBUT LT2)
        const nextEnd = clockToMinutes(line.endTime);
        if (line.endTime === '—' || nextEnd == null) {
            prev.endTime = '—';
            prev.status = line.status || 'En cours';
        } else if (nextEnd >= prevEnd) {
            prev.endTime = line.endTime;
            if (/en cours/i.test(String(line.status || ''))) {
                prev.status = line.status;
            }
        }
        prev.type = 'Présent';
        prev.kind = 'WORK';
    }
    return out;
}

/**
 * Horaires RH : Type / Début / Fin (sans produit).
 * Source principale = timeline PauseTypeService (fiable).
 * Complément éventuel via le moteur lignes prod.
 */
function buildRhLinesForDay(events, pauseTypeRows, dateKey, scheduleByDate) {
    const timeline = (scheduleByDate || PauseTypeService.buildPunchScheduleByDate(events, pauseTypeRows)).get(dateKey) || [];
    if (timeline.length) {
        return mergeRhPresenceLines(timeline.map(mapTimelineLine));
    }

    // Fallback : segments prod si la timeline est vide mais qu'il y a des events
    if (!events?.length) return [];
    let workItems = [];
    try {
        workItems = processLancementEventsWithPauses(events, { includeWorkSegments: true }) || [];
    } catch (e) {
        console.warn('RH lines fallback prod:', e.message);
        return [];
    }

    const lines = [];
    for (const it of workItems) {
        const d = lineDateKey(it.dateCreation);
        if (d && d !== dateKey) continue;
        lines.push({
            type: it._isPauseRow || it.type === 'pause' ? 'Pause' : 'Présent',
            startTime: toClock(it.startTime) || '—',
            endTime: toClock(it.endTime) || '—',
            status: it.status || it.statusLabel || '',
            statusCode: it.statusCode || it.generalStatus || '',
            kind: (it._isPauseRow || it.type === 'pause') ? 'PAUSE' : 'WORK'
        });
    }
    lines.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
    return mergeRhPresenceLines(lines);
}

function attachRhLinesToBlocks(blocks, events, pauseTypeRows) {
    const scheduleByDate = PauseTypeService.buildPunchScheduleByDate(events, pauseTypeRows);
    const attach = (day) => {
        if (!day?.date) return day;
        const lines = buildRhLinesForDay(events, pauseTypeRows, day.date, scheduleByDate);
        // Ne pas écraser une timeline déjà présente si le rebuild est vide
        const prev = Array.isArray(day.schedule) ? day.schedule : [];
        const schedule = lines.length ? lines : prev.map(mapTimelineLine);
        return { ...day, schedule };
    };
    return {
        ...blocks,
        monThu: {
            ...blocks.monThu,
            days: (blocks.monThu?.days || []).map(attach)
        },
        friday: {
            ...blocks.friday,
            day: blocks.friday?.day ? attach(blocks.friday.day) : null
        }
    };
}

/**
 * Designation1 SILOG est souvent "NOM Prénom" (nom en majuscules).
 * Sinon on suppose "Prénom Nom".
 */
function splitOperatorName(fullName) {
    const raw = String(fullName || '').trim().replace(/\s+/g, ' ');
    if (!raw) {
        return { nom: '', prenom: '', displayName: '' };
    }
    const parts = raw.split(' ');
    if (parts.length === 1) {
        return { nom: parts[0], prenom: '', displayName: parts[0] };
    }
    const first = parts[0];
    const isAllCapsNom = first === first.toUpperCase() && /[A-ZÀ-Ü]/.test(first);
    if (isAllCapsNom) {
        const prenom = parts.slice(1).join(' ');
        return {
            nom: first,
            prenom,
            displayName: `${prenom} ${first}`.trim()
        };
    }
    const nom = parts[parts.length - 1];
    const prenom = parts.slice(0, -1).join(' ');
    return { nom, prenom, displayName: raw };
}

async function loadAllOperatorsDirectory() {
    const preferred = `
        SELECT
            v.CodeOperateur AS OperatorCode,
            v.NomOperateur AS FullName,
            r.Designation1,
            r.Designation2
        FROM ${appDb}.[dbo].[V_RESSOURC] v
        LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON v.CodeOperateur = r.Coderessource
        WHERE (
            r.Typeressource IS NULL
            OR r.Typeressource IN ('OP', 'OPERATEUR', 'O')
            OR LTRIM(RTRIM(CAST(r.Typeressource AS NVARCHAR(20)))) = ''
        )
        ORDER BY v.NomOperateur, v.CodeOperateur
    `;
    const fallback = `
        SELECT
            r.Coderessource AS OperatorCode,
            r.Designation1 AS FullName,
            r.Designation1,
            r.Designation2
        FROM [SEDI_ERP].[dbo].[RESSOURC] r
        WHERE r.Typeressource IN ('OP', 'OPERATEUR', 'O')
           OR r.Typeressource IS NULL
        ORDER BY r.Designation1, r.Coderessource
    `;

    let rows = [];
    try {
        rows = await executeQuery(preferred);
    } catch (e) {
        console.warn('RH: V_RESSOURC indisponible, fallback RESSOURC:', e.message);
        rows = await executeQuery(fallback);
    }

    return (rows || []).map((row) => {
        const code = String(row.OperatorCode || '').trim();
        const full =
            String(row.FullName || row.Designation1 || '').trim()
            || (row.Designation2 ? String(row.Designation2).trim() : '')
            || code;
        const parts = splitOperatorName(full);
        // Si Designation2 existe et Designation1 est un seul mot, Designation2 = prénom
        if (!parts.prenom && row.Designation2) {
            const d2 = String(row.Designation2).trim();
            if (d2 && d2.toLowerCase() !== full.toLowerCase()) {
                parts.prenom = d2;
                parts.displayName = `${d2} ${parts.nom || full}`.trim();
            }
        }
        return {
            operatorCode: code,
            nom: parts.nom || full,
            prenom: parts.prenom || '',
            operatorName: parts.displayName || full || code,
            fullName: full
        };
    }).filter((o) => o.operatorCode);
}

async function loadEventsBetween(dateStart, dateEnd, operatorCode = '') {
    await PauseTypeService.ensureHistoriquePauseTypeColumn();
    return executeQuery(
        `
        SELECT
            h.NoEnreg,
            h.Ident,
            h.CodeLanctImprod,
            COALESCE(h.Phase, 'PRODUCTION') as Phase,
            h.OperatorCode,
            h.CodeRubrique,
            h.Statut,
            CONVERT(VARCHAR(8), h.HeureDebut, 108) AS HeureDebut,
            CONVERT(VARCHAR(8), h.HeureFin, 108) AS HeureFin,
            h.DateCreation,
            h.CreatedAt,
            h.PauseTypeCode
        FROM ${appDb}.[dbo].[ABHISTORIQUE_OPERATEURS] AS h
        WHERE CAST(h.DateCreation AS DATE) >= CAST(@dateStart AS DATE)
          AND CAST(h.DateCreation AS DATE) <= CAST(@dateEnd AS DATE)
          AND (@operatorCode = '' OR h.OperatorCode = @operatorCode)
        ORDER BY h.OperatorCode ASC, h.DateCreation ASC, h.NoEnreg ASC
        `,
        { dateStart, dateEnd, operatorCode: operatorCode || '' }
    );
}

async function buildOperatorPeriodDays(operatorCode, dateStart, dateEnd) {
    const events = await loadEventsBetween(dateStart, dateEnd, operatorCode);
    const pauseTypes = await PauseTypeService.getPauseTypesForRange(dateStart, dateEnd, operatorCode);
    // Remplir tous les jours ouvrés (lun→ven) même sans pointage,
    // sinon les corrections RH (édition Temps fait) n'apparaissent pas dans les HS du mois.
    const byDate = new Map();
    let weekStart = PauseTypeService.getMondayOfWeek(new Date(`${dateStart}T12:00:00`));
    while (weekStart <= dateEnd) {
        const weekEnd = PauseTypeService.addDays(weekStart, 6);
        const weekDays = PauseTypeService.buildWeekCounters(events, pauseTypes, {
            weekStart,
            weekEnd
        });
        for (const day of weekDays) {
            if (day.date >= dateStart && day.date <= dateEnd) {
                byDate.set(day.date, day);
            }
        }
        weekStart = PauseTypeService.addDays(weekStart, 7);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function withBankOnBlocks(blocks, corrections) {
    // Présence brute (avant corrections) pour édition RH jour par jour
    const withRaw = (days) => (days || []).map((d) => ({
        ...d,
        rawPresenceMinutes: Number(d.presenceMinutes) || 0
    }));
    const monThuDays = RhTimeService.applyPresenceCorrections(withRaw(blocks.monThu?.days), corrections);
    const fridayDayRaw = blocks.friday?.day
        ? [{ ...blocks.friday.day, rawPresenceMinutes: Number(blocks.friday.day.presenceMinutes) || 0 }]
        : [];
    const fridayDays = RhTimeService.applyPresenceCorrections(fridayDayRaw, corrections);
    const fridayDay = fridayDays[0] || null;
    const weekDays = [...monThuDays, ...(fridayDay ? [fridayDay] : [])];
    const bank = RhTimeService.sumBankCredits(weekDays);
    return {
        monThu: {
            ...blocks.monThu,
            days: monThuDays,
            totals: {
                ...(blocks.monThu?.totals || {}),
                presenceMinutes: monThuDays.reduce((s, d) => s + (Number(d.presenceMinutes) || 0), 0),
                remainingMinutes: monThuDays.reduce((s, d) => s + (Number(d.remainingMinutes) || 0), 0),
                surplusMinutes: monThuDays.reduce((s, d) => s + (d.surplusMinutes || 0), 0),
                deficitMinutes: monThuDays.reduce((s, d) => s + (d.deficitMinutes || 0), 0),
                bankCreditMinutes: monThuDays.reduce((s, d) => s + (d.bankCreditMinutes || 0), 0)
            }
        },
        friday: {
            ...blocks.friday,
            day: fridayDay,
            totals: {
                ...(blocks.friday?.totals || {}),
                surplusMinutes: fridayDay?.surplusMinutes || 0,
                deficitMinutes: fridayDay?.deficitMinutes || 0,
                bankCreditMinutes: fridayDay?.bankCreditMinutes || 0,
                presenceMinutes: fridayDay?.presenceMinutes || 0,
                remainingMinutes: fridayDay?.remainingMinutes || 0
            }
        },
        weekBank: bank
    };
}

// GET /api/rh/week?weekStart=YYYY-MM-DD&operatorCode=
router.get('/week', async (req, res) => {
    try {
        const weekStart = req.query.weekStart
            ? String(req.query.weekStart).slice(0, 10)
            : PauseTypeService.getMondayOfWeek(new Date());
        const weekEnd = PauseTypeService.addDays(weekStart, 6);
        const fridayDate = PauseTypeService.addDays(weekStart, 4);
        const filterOperator = req.query.operatorCode
            ? String(req.query.operatorCode).trim()
            : '';

        const directory = await loadAllOperatorsDirectory();
        const byCode = new Map(directory.map((o) => [o.operatorCode, o]));

        const eventsQuery = `
            SELECT
                h.NoEnreg,
                h.Ident,
                h.CodeLanctImprod,
                COALESCE(h.Phase, 'PRODUCTION') as Phase,
                h.OperatorCode,
                h.CodeRubrique,
                h.Statut,
                CONVERT(VARCHAR(8), h.HeureDebut, 108) AS HeureDebut,
                CONVERT(VARCHAR(8), h.HeureFin, 108) AS HeureFin,
                h.DateCreation,
                h.CreatedAt,
                h.PauseTypeCode
            FROM ${appDb}.[dbo].[ABHISTORIQUE_OPERATEURS] AS h
            WHERE CAST(h.DateCreation AS DATE) >= CAST(@weekStart AS DATE)
              AND CAST(h.DateCreation AS DATE) <= CAST(@weekEnd AS DATE)
              AND (@operatorCode = '' OR h.OperatorCode = @operatorCode)
            ORDER BY h.OperatorCode ASC, h.DateCreation ASC, h.NoEnreg ASC
        `;
        await PauseTypeService.ensureHistoriquePauseTypeColumn();
        const events = await executeQuery(eventsQuery, {
            weekStart,
            weekEnd,
            operatorCode: filterOperator
        });

        const pauseTypes = await PauseTypeService.getPauseTypesForRange(
            weekStart,
            weekEnd,
            filterOperator || null
        );

        const eventsByOperator = new Map();
        for (const ev of events || []) {
            const code = String(ev.OperatorCode || '').trim();
            if (!code) continue;
            if (!eventsByOperator.has(code)) eventsByOperator.set(code, []);
            eventsByOperator.get(code).push(ev);
            // Opérateur présent dans l'historique mais absent du référentiel
            if (!byCode.has(code)) {
                byCode.set(code, {
                    operatorCode: code,
                    nom: code,
                    prenom: '',
                    operatorName: code,
                    fullName: code
                });
            }
        }

        let codes = filterOperator
            ? [filterOperator]
            : [...byCode.keys()];

        if (filterOperator && !byCode.has(filterOperator)) {
            byCode.set(filterOperator, {
                operatorCode: filterOperator,
                nom: filterOperator,
                prenom: '',
                operatorName: filterOperator,
                fullName: filterOperator
            });
        }

        const yearMonth = String(weekStart).slice(0, 7);
        const corrections = await RhTimeService.listCorrections({
            operatorCode: filterOperator,
            dateStart: weekStart,
            dateEnd: weekEnd
        });

        const operators = [];
        for (const operatorCode of codes) {
            const meta = byCode.get(operatorCode) || {
                operatorCode,
                nom: operatorCode,
                prenom: '',
                operatorName: operatorCode,
                fullName: operatorCode
            };
            const opEvents = eventsByOperator.get(operatorCode) || [];
            const opPauseRows = (pauseTypes || []).filter(
                (p) => String(p.OperatorCode || '').trim() === operatorCode
            );
            const days = PauseTypeService.buildWeekCounters(opEvents, opPauseRows, {
                weekStart,
                weekEnd
            });
            const blocks = PauseTypeService.splitWeekForRh(days);
            const opCorrections = corrections.filter((c) => c.operatorCode === operatorCode);
            const withBank = withBankOnBlocks(blocks, opCorrections.map((c) => ({
                Kind: c.kind,
                Status: c.status,
                WorkDate: c.workDate,
                DeltaMinutes: c.deltaMinutes
            })));
            const withLines = attachRhLinesToBlocks(withBank, opEvents, opPauseRows);
            operators.push({
                ...meta,
                ...withLines,
                corrections: opCorrections
            });
        }

        operators.sort((a, b) => {
            const an = `${a.nom} ${a.prenom}`.trim().toLowerCase();
            const bn = `${b.nom} ${b.prenom}`.trim().toLowerCase();
            if (an !== bn) return an.localeCompare(bn, 'fr');
            return String(a.operatorCode).localeCompare(String(b.operatorCode), 'fr');
        });

        res.json({
            success: true,
            data: {
                weekStart,
                weekEnd,
                fridayDate,
                yearMonth,
                rules: {
                    monThuTargetMinutes: PauseTypeService.DAY_TARGET_MINUTES,
                    fridayTargetMinutes: PauseTypeService.FRIDAY_TARGET_MINUTES,
                    note: 'Lun–jeu : surplus > 8h45 → HS. Vendredi (fermeture 13h) : tout le temps fait → HS. Déficit affiché seulement.'
                },
                pauseTypes: PAUSE_TYPES,
                operators
            }
        });
    } catch (error) {
        console.error('Erreur RH /week:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Erreur chargement semaine RH'
        });
    }
});

// GET /api/rh/operators — annuaire complet (filtre)
router.get('/operators', async (_req, res) => {
    try {
        const directory = await loadAllOperatorsDirectory();
        directory.sort((a, b) => {
            const an = `${a.nom} ${a.prenom}`.trim().toLowerCase();
            const bn = `${b.nom} ${b.prenom}`.trim().toLowerCase();
            if (an !== bn) return an.localeCompare(bn, 'fr');
            return String(a.operatorCode).localeCompare(String(b.operatorCode), 'fr');
        });
        res.json({
            success: true,
            data: directory.map((o) => ({
                code: o.operatorCode,
                nom: o.nom,
                prenom: o.prenom,
                label: o.prenom
                    ? `${o.prenom} ${o.nom} (${o.operatorCode})`
                    : `${o.operatorName || o.nom} (${o.operatorCode})`
            }))
        });
    } catch (error) {
        console.error('Erreur RH /operators:', error);
        res.status(500).json({ success: false, error: error.message || 'Erreur liste opérateurs' });
    }
});

// GET /api/rh/month?yearMonth=YYYY-MM&operatorCode=
router.get('/month', async (req, res) => {
    try {
        const { yearMonth, start, end } = RhTimeService.monthBounds(req.query.yearMonth);
        const filterOperator = req.query.operatorCode ? String(req.query.operatorCode).trim() : '';
        const directory = await loadAllOperatorsDirectory();
        const byCode = new Map(directory.map((o) => [o.operatorCode, o]));
        const events = await loadEventsBetween(start, end, filterOperator);
        const eventCodes = [...new Set((events || []).map((e) => String(e.OperatorCode || '').trim()).filter(Boolean))];
        for (const code of eventCodes) {
            if (!byCode.has(code)) {
                byCode.set(code, {
                    operatorCode: code,
                    nom: code,
                    prenom: '',
                    operatorName: code,
                    fullName: code
                });
            }
        }
        const codes = filterOperator ? [filterOperator] : [...byCode.keys()];
        const allCorrections = await RhTimeService.listCorrections({
            operatorCode: filterOperator,
            dateStart: start,
            dateEnd: end
        });

        const operators = [];
        for (const operatorCode of codes) {
            const meta = byCode.get(operatorCode) || {
                operatorCode,
                nom: operatorCode,
                prenom: '',
                operatorName: operatorCode,
                fullName: operatorCode
            };
            const days = await buildOperatorPeriodDays(operatorCode, start, end);
            const opCorrections = allCorrections.filter((c) => c.operatorCode === operatorCode);
            const bank = RhTimeService.buildMonthBankSummary(
                days,
                opCorrections.map((c) => ({
                    Kind: c.kind,
                    Status: c.status,
                    WorkDate: c.workDate,
                    DeltaMinutes: c.deltaMinutes
                })),
                yearMonth
            );
            operators.push({
                ...meta,
                month: bank,
                corrections: opCorrections
            });
        }

        operators.sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
        res.json({
            success: true,
            data: {
                yearMonth,
                start,
                end,
                rules: {
                    monThu: 'Surplus au-delà de 8h45 → heures supp',
                    friday: 'Vendredi fermeture 13h : tout le temps fait → HS',
                    deficit: 'Déficit affiché seulement (pas de retrait auto)'
                },
                operators
            }
        });
    } catch (error) {
        console.error('Erreur RH /month:', error);
        res.status(500).json({ success: false, error: error.message || 'Erreur heures supp' });
    }
});

// GET /api/rh/corrections
router.get('/corrections', async (req, res) => {
    try {
        const yearMonth = req.query.yearMonth
            ? String(req.query.yearMonth).slice(0, 7)
            : RhTimeService.monthBounds().yearMonth;
        const { start, end } = RhTimeService.monthBounds(yearMonth);
        const rows = await RhTimeService.listCorrections({
            operatorCode: req.query.operatorCode ? String(req.query.operatorCode).trim() : '',
            dateStart: start,
            dateEnd: end,
            status: req.query.status ? String(req.query.status).trim() : ''
        });
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Erreur RH /corrections:', error);
        res.status(500).json({ success: false, error: error.message || 'Erreur corrections' });
    }
});

// POST /api/rh/corrections
router.post('/corrections', async (req, res) => {
    try {
        const body = req.body || {};
        await RhTimeService.createCorrection({
            operatorCode: String(body.operatorCode || '').trim(),
            workDate: String(body.workDate || '').slice(0, 10),
            kind: body.kind,
            deltaMinutes: body.deltaMinutes,
            comment: body.comment,
            createdBy: req.rh?.username || 'rh',
            status: body.status || 'VALIDATED'
        });
        res.json({ success: true, message: 'Correction enregistrée' });
    } catch (error) {
        console.error('Erreur création correction RH:', error);
        const code = error.message === 'INVALID_CORRECTION_KIND' || error.message === 'INVALID_DELTA' ? 400 : 500;
        res.status(code).json({ success: false, error: error.message || 'Erreur création correction' });
    }
});

// POST /api/rh/corrections/:id/status
router.post('/corrections/:id/status', async (req, res) => {
    try {
        const id = Number(req.params.id);
        await RhTimeService.setCorrectionStatus(id, req.body?.status, req.rh?.username || 'rh');
        res.json({ success: true, message: 'Statut mis à jour' });
    } catch (error) {
        console.error('Erreur statut correction RH:', error);
        res.status(400).json({ success: false, error: error.message || 'Erreur statut' });
    }
});

// POST /api/rh/days/presence — fixer le temps fait d'un jour (édition jour par jour)
router.post('/days/presence', async (req, res) => {
    try {
        const body = req.body || {};
        const operatorCode = String(body.operatorCode || '').trim();
        const workDate = RhTimeService.toDateKey(body.workDate);
        if (!operatorCode || !workDate) {
            return res.status(400).json({ success: false, error: 'INVALID_DAY_PRESENCE' });
        }

        // Toujours recalculer le pointé serveur (ne pas faire confiance au data-raw client)
        let serverRaw = 0;
        try {
            const weekStart = PauseTypeService.getMondayOfWeek(new Date(`${workDate}T12:00:00`));
            const weekEnd = PauseTypeService.addDays(weekStart, 6);
            const events = await loadEventsBetween(weekStart, weekEnd, operatorCode);
            const pauseTypes = await PauseTypeService.getPauseTypesForRange(weekStart, weekEnd, operatorCode);
            const days = PauseTypeService.buildWeekCounters(events, pauseTypes, { weekStart, weekEnd });
            const day = (days || []).find((d) => d.date === workDate);
            serverRaw = Number(day?.presenceMinutes) || 0;
        } catch (e) {
            console.warn('RH raw presence fallback client:', e.message);
            serverRaw = Math.max(0, Math.round(Number(body.rawPresenceMinutes) || 0));
        }

        const result = await RhTimeService.setDayPresenceAbsolute({
            operatorCode,
            workDate,
            presenceMinutes: body.presenceMinutes,
            rawPresenceMinutes: serverRaw,
            comment: body.comment,
            createdBy: req.rh?.username || 'rh'
        });
        res.json({
            success: true,
            data: result,
            message: result.cleared
                ? 'Correction retirée — temps = pointages'
                : `Jour mis à jour → ${RhTimeService.formatMinutesHm(result.presenceMinutes)} (HS ${RhTimeService.formatMinutesHm(result.bankCreditMinutes)})`
        });
    } catch (error) {
        console.error('Erreur édition jour RH:', error);
        const code = error.message === 'INVALID_DAY_PRESENCE' ? 400 : 500;
        res.status(code).json({ success: false, error: error.message || 'Erreur édition jour' });
    }
});

// GET /api/rh/export.xlsx?yearMonth=&operatorCode=
router.get('/export.xlsx', async (req, res) => {
    try {
        const { yearMonth, start, end } = RhTimeService.monthBounds(req.query.yearMonth);
        const filterOperator = req.query.operatorCode ? String(req.query.operatorCode).trim() : '';
        const directory = await loadAllOperatorsDirectory();
        const byCode = new Map(directory.map((o) => [o.operatorCode, o]));
        const codes = filterOperator ? [filterOperator] : directory.map((o) => o.operatorCode);
        const allCorrections = await RhTimeService.listCorrections({
            operatorCode: filterOperator,
            dateStart: start,
            dateEnd: end
        });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SEDI RH';
        const sheetBank = workbook.addWorksheet('Heures supp');
        const sheetDays = workbook.addWorksheet('Jour par jour');
        const sheetCorr = workbook.addWorksheet('Corrections');

        sheetBank.columns = [
            { header: 'Code', key: 'code', width: 12 },
            { header: 'Nom', key: 'nom', width: 18 },
            { header: 'Prénom', key: 'prenom', width: 18 },
            { header: 'Surplus lun-jeu (min)', key: 'surplus', width: 18 },
            { header: 'Vendredi HS (min)', key: 'friday', width: 16 },
            { header: 'Déficit info (min)', key: 'deficit', width: 16 },
            { header: 'Corr. HS (min)', key: 'manual', width: 16 },
            { header: 'Heures supp (min)', key: 'total', width: 16 },
            { header: 'Heures supp (hh:mm)', key: 'totalFmt', width: 16 }
        ];
        sheetDays.columns = [
            { header: 'Date', key: 'date', width: 12 },
            { header: 'Jour', key: 'weekday', width: 10 },
            { header: 'Opérateur', key: 'name', width: 26 },
            { header: 'Code', key: 'code', width: 10 },
            { header: 'Type', key: 'type', width: 16 },
            { header: 'Début', key: 'start', width: 9 },
            { header: 'Fin', key: 'end', width: 9 },
            { header: 'Fait jour', key: 'presence', width: 10 },
            { header: 'HS jour', key: 'credit', width: 10 }
        ];
        const dayRows = [];
        sheetCorr.columns = [
            { header: 'Id', key: 'id', width: 8 },
            { header: 'Code', key: 'code', width: 12 },
            { header: 'Date', key: 'date', width: 12 },
            { header: 'Kind', key: 'kind', width: 14 },
            { header: 'Delta', key: 'delta', width: 10 },
            { header: 'Statut', key: 'status', width: 12 },
            { header: 'Commentaire', key: 'comment', width: 40 }
        ];

        const fmt = (mins) => {
            const t = Math.round(Number(mins) || 0);
            const sign = t < 0 ? '-' : '';
            const abs = Math.abs(t);
            return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
        };

        for (const operatorCode of codes) {
            const meta = byCode.get(operatorCode) || { nom: operatorCode, prenom: '', operatorCode };
            const days = await buildOperatorPeriodDays(operatorCode, start, end);
            const opCorrections = allCorrections.filter((c) => c.operatorCode === operatorCode);
            const bank = RhTimeService.buildMonthBankSummary(
                days,
                opCorrections.map((c) => ({
                    Kind: c.kind,
                    Status: c.status,
                    WorkDate: c.workDate,
                    DeltaMinutes: c.deltaMinutes
                })),
                yearMonth
            );
            sheetBank.addRow({
                code: operatorCode,
                nom: meta.nom,
                prenom: meta.prenom,
                surplus: bank.monThuSurplusMinutes,
                friday: bank.fridayHsMinutes,
                deficit: bank.monThuDeficitMinutes,
                manual: bank.bankManualMinutes,
                total: bank.bankTotalMinutes,
                totalFmt: fmt(bank.bankTotalMinutes)
            });
            const name = meta.prenom ? `${meta.prenom} ${meta.nom}` : (meta.nom || operatorCode);
            for (const day of bank.days || []) {
                const lines = dayScheduleLines(day);
                if (!lines.length && !(Number(day.presenceMinutes) > 0)) continue;
                dayRows.push({ date: day.date, name, code: operatorCode, day, lines });
            }
        }

        dayRows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'fr'));
        let currentDate = null;
        for (const r of dayRows) {
            if (r.date !== currentDate) {
                currentDate = r.date;
                const weekday = new Date(`${r.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' });
                const header = sheetDays.addRow({ date: r.date, weekday });
                header.font = { bold: true };
                header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            }
            const lines = r.lines.length ? r.lines : [{ type: 'Correction RH', start: '—', end: '—' }];
            lines.forEach((line, i) => {
                sheetDays.addRow({
                    name: i === 0 ? r.name : '',
                    code: i === 0 ? r.code : '',
                    type: line.type,
                    start: line.start,
                    end: line.end,
                    presence: i === 0 ? fmt(r.day.presenceMinutes) : '',
                    credit: i === 0 && Number(r.day.bankCreditMinutes) > 0 ? fmt(r.day.bankCreditMinutes) : ''
                });
            });
        }
        for (const c of allCorrections) {
            sheetCorr.addRow({
                id: c.id,
                code: c.operatorCode,
                date: c.workDate,
                kind: c.kind,
                delta: fmt(c.deltaMinutes),
                status: c.status,
                comment: c.comment
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="rh-temps-${yearMonth}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Erreur export RH:', error);
        res.status(500).json({ success: false, error: error.message || 'Erreur export' });
    }
});

module.exports = router;
