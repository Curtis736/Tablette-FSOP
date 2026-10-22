/**
 * Banque d'heures mensuelle + corrections RH.
 * Règles :
 * - Lun→Jeu : surplus (> 8h45) → banque ; déficit affiché seulement (pas de pioche auto)
 * - Vendredi (fermeture 13h, cible 5h) : tout le temps fait → HS banque (journée isolée)
 * - Jour sans présence (0) : ni déficit ni HS (évite de gonfler le mois)
 */
const { executeQuery, executeNonQuery, appDb, assertRhWritesAllowed } = require('../config/database');
const PauseTypeService = require('./PauseTypeService');

let tableReady = false;

/** Plafond d'une journée (24h) pour éviter les saisies absurdes. */
const MAX_DAY_MINUTES = 24 * 60;

/** Normalise une date SQL/JS en YYYY-MM-DD (évite String(Date).slice → "Tue Sep 08"). */
function toDateKey(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string') {
        const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
        if (iso) return iso[1];
    }
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatMinutesHm(mins) {
    const t = Math.max(0, Math.round(Number(mins) || 0));
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function clampDayMinutes(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return NaN;
    return Math.min(MAX_DAY_MINUTES, Math.max(0, n));
}

async function ensureCorrectionsTable() {
    if (tableReady) return;
    try {
        assertRhWritesAllowed();
    } catch (e) {
        // Lecture OK sur la base partagée en DEV ; pas de CREATE/ALTER
        if (String(e.message || '').startsWith('RH_SHARED_DB_WRITE_BLOCKED')) {
            tableReady = true;
            return;
        }
        throw e;
    }
    await executeNonQuery(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AB_RH_CORRECTIONS')
        BEGIN
            CREATE TABLE ${appDb}.[dbo].[AB_RH_CORRECTIONS] (
                Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                OperatorCode NVARCHAR(50) NOT NULL,
                WorkDate DATE NOT NULL,
                Kind NVARCHAR(20) NOT NULL,
                DeltaMinutes INT NOT NULL,
                Comment NVARCHAR(500) NULL,
                Status NVARCHAR(20) NOT NULL CONSTRAINT DF_AB_RH_CORRECTIONS_Status DEFAULT ('VALIDATED'),
                CreatedBy NVARCHAR(80) NULL,
                CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AB_RH_CORRECTIONS_CreatedAt DEFAULT SYSUTCDATETIME(),
                ValidatedBy NVARCHAR(80) NULL,
                ValidatedAt DATETIME2 NULL
            );
            CREATE INDEX IX_AB_RH_CORRECTIONS_Operator_Date
                ON ${appDb}.[dbo].[AB_RH_CORRECTIONS] (OperatorCode, WorkDate);
        END
    `);
    tableReady = true;
}

function monthBounds(yearMonth) {
    const ym = String(yearMonth || '').slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    if (!y || !m) {
        const now = new Date();
        const yy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        return monthBounds(`${yy}-${mm}`);
    }
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = new Date(y, m, 0); // last day of month
    const end = `${y}-${String(m).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    return { yearMonth: `${y}-${String(m).padStart(2, '0')}`, start, end };
}

function annotateDayForBank(day) {
    const presence = Number(day.presenceMinutes) || 0;
    const target = Number(day.targetMinutes) || PauseTypeService.targetMinutesForDate(day.date);
    const dow = new Date(`${day.date}T12:00:00`).getDay();
    // Pas de déficit / HS sur un jour sans présence (sinon le mois entier gonfle artificiellement)
    if (presence <= 0) {
        return {
            ...day,
            targetMinutes: target,
            bankKind: dow === 5 ? 'FRIDAY_HS' : (dow >= 1 && dow <= 4 ? 'MON_THU' : 'OFF'),
            surplusMinutes: 0,
            deficitMinutes: 0,
            bankCreditMinutes: 0
        };
    }
    if (dow === 5) {
        return {
            ...day,
            targetMinutes: target,
            bankKind: 'FRIDAY_HS',
            surplusMinutes: 0,
            // Info vs cible 5h (ne réduit pas la banque)
            deficitMinutes: Math.max(0, target - presence),
            bankCreditMinutes: presence // fermeture 13h : tout le temps fait = HS
        };
    }
    if (dow >= 1 && dow <= 4) {
        return {
            ...day,
            targetMinutes: target,
            bankKind: 'MON_THU',
            surplusMinutes: Math.max(0, presence - target),
            deficitMinutes: Math.max(0, target - presence),
            bankCreditMinutes: Math.max(0, presence - target)
        };
    }
    return {
        ...day,
        targetMinutes: target,
        bankKind: 'OFF',
        surplusMinutes: 0,
        deficitMinutes: 0,
        bankCreditMinutes: 0
    };
}

function applyPresenceCorrections(days, corrections) {
    const byDate = new Map();
    for (const c of corrections || []) {
        const kind = String(c.kind || c.Kind || '').toUpperCase();
        const status = String(c.status || c.Status || '').toUpperCase();
        if (kind !== 'DAY_PRESENCE') continue;
        if (status !== 'VALIDATED') continue;
        const key = toDateKey(c.workDate || c.WorkDate);
        if (!key) continue;
        byDate.set(key, (byDate.get(key) || 0) + (Number(c.deltaMinutes ?? c.DeltaMinutes) || 0));
    }
    return (days || []).map((day) => {
        const rawPresenceMinutes = day.rawPresenceMinutes != null
            ? Number(day.rawPresenceMinutes) || 0
            : (Number(day.presenceMinutes) || 0);
        const delta = byDate.get(day.date) || 0;
        const presenceMinutes = Math.max(0, Math.min(MAX_DAY_MINUTES, rawPresenceMinutes + delta));
        const targetMinutes = Number(day.targetMinutes) || PauseTypeService.targetMinutesForDate(day.date);
        return annotateDayForBank({
            ...day,
            rawPresenceMinutes,
            presenceMinutes,
            remainingMinutes: Math.max(0, targetMinutes - presenceMinutes),
            correctionMinutes: delta
        });
    });
}

function sumBankCredits(days) {
    let monThuSurplus = 0;
    let fridayHs = 0;
    let monThuDeficit = 0;
    let fridayDeficit = 0;
    for (const day of days || []) {
        const d = annotateDayForBank(day);
        if (d.bankKind === 'MON_THU') {
            monThuSurplus += d.bankCreditMinutes;
            monThuDeficit += d.deficitMinutes;
        } else if (d.bankKind === 'FRIDAY_HS') {
            fridayHs += d.bankCreditMinutes;
            fridayDeficit += d.deficitMinutes;
        }
    }
    return {
        monThuSurplusMinutes: monThuSurplus,
        fridayHsMinutes: fridayHs,
        monThuDeficitMinutes: monThuDeficit,
        fridayDeficitMinutes: fridayDeficit,
        // Conservé pour compat : déficit info global (lun–jeu + ven vs cible)
        deficitInfoMinutes: monThuDeficit + fridayDeficit,
        autoBankMinutes: monThuSurplus + fridayHs
    };
}

async function listCorrections({ operatorCode, dateStart, dateEnd, status = null }) {
    await ensureCorrectionsTable();
    const rows = await executeQuery(
        `
        SELECT Id, OperatorCode,
               CONVERT(VARCHAR(10), WorkDate, 23) AS WorkDate,
               Kind, DeltaMinutes, Comment, Status,
               CreatedBy, CreatedAt, ValidatedBy, ValidatedAt
        FROM ${appDb}.[dbo].[AB_RH_CORRECTIONS]
        WHERE (@operatorCode = '' OR OperatorCode = @operatorCode)
          AND WorkDate >= CAST(@dateStart AS DATE)
          AND WorkDate <= CAST(@dateEnd AS DATE)
          AND (@status = '' OR Status = @status)
        ORDER BY WorkDate DESC, Id DESC
        `,
        {
            operatorCode: operatorCode || '',
            dateStart,
            dateEnd,
            status: status || ''
        }
    );
    return (rows || []).map((r) => ({
        id: r.Id,
        operatorCode: r.OperatorCode,
        workDate: toDateKey(r.WorkDate),
        kind: r.Kind,
        deltaMinutes: Number(r.DeltaMinutes) || 0,
        comment: r.Comment || '',
        status: r.Status,
        createdBy: r.CreatedBy || null,
        createdAt: r.CreatedAt,
        validatedBy: r.ValidatedBy || null,
        validatedAt: r.ValidatedAt || null
    }));
}

/** Rejette les DAY_PRESENCE VALIDATED du même jour (évite le cumul de deltas). */
async function rejectValidatedDayPresence({ operatorCode, workDate, validatedBy, reason = 'remplacée' }) {
    assertRhWritesAllowed();
    await executeNonQuery(
        `
        UPDATE ${appDb}.[dbo].[AB_RH_CORRECTIONS]
        SET Status = 'REJECTED',
            ValidatedBy = @validatedBy,
            ValidatedAt = SYSUTCDATETIME(),
            Comment = LEFT(
                CASE
                    WHEN Comment IS NULL OR LTRIM(RTRIM(Comment)) = N'' THEN N'[${reason}]'
                    WHEN Comment LIKE N'%[${reason}]%' THEN Comment
                    ELSE Comment + N' [${reason}]'
                END,
                500
            )
        WHERE OperatorCode = @operatorCode
          AND WorkDate = CAST(@workDate AS DATE)
          AND Kind = 'DAY_PRESENCE'
          AND Status = 'VALIDATED'
        `,
        { operatorCode, workDate, validatedBy: validatedBy || 'rh' }
    );
}

async function createCorrection({
    operatorCode,
    workDate,
    kind,
    deltaMinutes,
    comment,
    createdBy,
    status = 'VALIDATED'
}) {
    assertRhWritesAllowed();
    await ensureCorrectionsTable();
    const code = String(operatorCode || '').trim();
    const date = toDateKey(workDate);
    const k = String(kind || '').toUpperCase();
    if (!code || !date) {
        throw new Error('INVALID_CORRECTION');
    }
    if (k !== 'DAY_PRESENCE' && k !== 'BANK') {
        throw new Error('INVALID_CORRECTION_KIND');
    }
    const delta = Math.round(Number(deltaMinutes));
    if (!Number.isFinite(delta) || delta === 0) {
        throw new Error('INVALID_DELTA');
    }
    // DAY_PRESENCE : une seule correction validée active par jour
    if (k === 'DAY_PRESENCE' && String(status || '').toUpperCase() === 'VALIDATED') {
        await rejectValidatedDayPresence({
            operatorCode: code,
            workDate: date,
            validatedBy: createdBy || 'rh',
            reason: 'remplacée'
        });
    }
    const st = String(status || 'VALIDATED').toUpperCase();
    const validatedBy = st === 'VALIDATED' ? (createdBy || 'rh') : null;
    await executeNonQuery(
        `
        INSERT INTO ${appDb}.[dbo].[AB_RH_CORRECTIONS]
            (OperatorCode, WorkDate, Kind, DeltaMinutes, Comment, Status, CreatedBy, ValidatedBy, ValidatedAt)
        VALUES
            (@operatorCode, CAST(@workDate AS DATE), @kind, @deltaMinutes, @comment, @status, @createdBy,
             @validatedBy, CASE WHEN @status = 'VALIDATED' THEN SYSUTCDATETIME() ELSE NULL END)
        `,
        {
            operatorCode: code,
            workDate: date,
            kind: k,
            deltaMinutes: delta,
            comment: comment ? String(comment).slice(0, 500) : null,
            status: st,
            createdBy: createdBy || 'rh',
            validatedBy
        }
    );
    return true;
}

async function setCorrectionStatus(id, status, validatedBy) {
    assertRhWritesAllowed();
    await ensureCorrectionsTable();
    const st = String(status || '').toUpperCase();
    if (!['PENDING', 'VALIDATED', 'REJECTED'].includes(st)) {
        throw new Error('INVALID_STATUS');
    }
    await executeNonQuery(
        `
        UPDATE ${appDb}.[dbo].[AB_RH_CORRECTIONS]
        SET Status = @status,
            ValidatedBy = @validatedBy,
            ValidatedAt = SYSUTCDATETIME()
        WHERE Id = @id
        `,
        { id, status: st, validatedBy: validatedBy || 'rh' }
    );
    return true;
}

/**
 * Fixe le temps fait d'un jour (valeur absolue en minutes).
 * Remplace les corrections DAY_PRESENCE validées existantes pour ce jour.
 * rawPresenceMinutes doit idéalement venir du serveur (pointages), pas du client.
 */
async function setDayPresenceAbsolute({
    operatorCode,
    workDate,
    presenceMinutes,
    rawPresenceMinutes,
    comment,
    createdBy
}) {
    assertRhWritesAllowed();
    await ensureCorrectionsTable();
    const code = String(operatorCode || '').trim();
    const date = toDateKey(workDate);
    const desired = clampDayMinutes(presenceMinutes);
    const raw = clampDayMinutes(rawPresenceMinutes ?? 0);
    if (!code || !date || !Number.isFinite(desired) || !Number.isFinite(raw)) {
        throw new Error('INVALID_DAY_PRESENCE');
    }
    // Week-end : autorisé pour correction, mais hors banque auto
    const dow = new Date(`${date}T12:00:00`).getDay();
    const delta = desired - raw;

    await rejectValidatedDayPresence({
        operatorCode: code,
        workDate: date,
        validatedBy: createdBy || 'rh',
        reason: 'remplacée'
    });

    if (delta !== 0) {
        await createCorrection({
            operatorCode: code,
            workDate: date,
            kind: 'DAY_PRESENCE',
            deltaMinutes: delta,
            comment: comment || `Temps fait fixé à ${formatMinutesHm(desired)} (pointé ${formatMinutesHm(raw)})`,
            createdBy: createdBy || 'rh',
            status: 'VALIDATED'
        });
    }

    const annotated = annotateDayForBank({
        date,
        presenceMinutes: desired,
        rawPresenceMinutes: raw,
        targetMinutes: PauseTypeService.targetMinutesForDate(date),
        remainingMinutes: Math.max(0, PauseTypeService.targetMinutesForDate(date) - desired),
        correctionMinutes: delta
    });

    return {
        operatorCode: code,
        workDate: date,
        presenceMinutes: desired,
        rawPresenceMinutes: raw,
        deltaMinutes: delta,
        cleared: delta === 0,
        dayOfWeek: dow,
        bankKind: annotated.bankKind,
        bankCreditMinutes: annotated.bankCreditMinutes,
        surplusMinutes: annotated.surplusMinutes,
        deficitMinutes: annotated.deficitMinutes,
        remainingMinutes: annotated.remainingMinutes
    };
}

function bankAdjustmentsFromCorrections(corrections, yearMonth) {
    let bankDelta = 0;
    for (const c of corrections || []) {
        if (String(c.status || c.Status).toUpperCase() !== 'VALIDATED') continue;
        const kind = String(c.kind || c.Kind).toUpperCase();
        const workDate = toDateKey(c.workDate || c.WorkDate);
        if (!workDate.startsWith(yearMonth)) continue;
        if (kind === 'BANK') {
            bankDelta += Number(c.deltaMinutes ?? c.DeltaMinutes) || 0;
        }
    }
    return bankDelta;
}

/**
 * Construit le résumé mensuel banque pour un opérateur à partir des jours enrichis + corrections.
 */
function buildMonthBankSummary(days, corrections, yearMonth) {
    const annotated = applyPresenceCorrections(days, corrections);
    const auto = sumBankCredits(annotated);
    const bankManual = bankAdjustmentsFromCorrections(
        (corrections || []).map((c) => ({
            kind: c.Kind || c.kind,
            status: c.Status || c.status,
            workDate: c.WorkDate || c.workDate,
            deltaMinutes: c.DeltaMinutes ?? c.deltaMinutes
        })),
        yearMonth
    );
    return {
        yearMonth,
        days: annotated,
        monThuSurplusMinutes: auto.monThuSurplusMinutes,
        fridayHsMinutes: auto.fridayHsMinutes,
        monThuDeficitMinutes: auto.monThuDeficitMinutes,
        fridayDeficitMinutes: auto.fridayDeficitMinutes,
        deficitInfoMinutes: auto.deficitInfoMinutes,
        bankManualMinutes: bankManual,
        bankTotalMinutes: Math.max(0, auto.autoBankMinutes + bankManual),
        rules: {
            monThu: 'Surplus au-delà de 8h45 → HS ; déficit affiché seulement',
            friday: 'Tout le temps fait du vendredi → HS (fermeture 13h) ; jour à 0 = 0 HS'
        }
    };
}

module.exports = {
    ensureCorrectionsTable,
    monthBounds,
    toDateKey,
    formatMinutesHm,
    clampDayMinutes,
    MAX_DAY_MINUTES,
    annotateDayForBank,
    applyPresenceCorrections,
    sumBankCredits,
    listCorrections,
    createCorrection,
    setCorrectionStatus,
    setDayPresenceAbsolute,
    buildMonthBankSummary
};
