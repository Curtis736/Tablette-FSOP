const fs = require('fs/promises');
const { executeQuery } = require('../config/database');

const nowIso = new Date().toISOString();

function toInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function checkDb() {
    try {
        const rows = await executeQuery('SELECT 1 AS ok');
        const ok = Array.isArray(rows) && rows[0] && rows[0].ok === 1;
        return ok ? { ok: true } : { ok: false, reason: 'DB_UNEXPECTED_RESPONSE' };
    } catch (error) {
        return { ok: false, reason: 'DB_TIMEOUT_OR_ERROR', details: error.message };
    }
}

async function checkTemplates() {
    const dir = process.env.FSOP_TEMPLATES_DIR || '';
    const xlsx = process.env.FSOP_TEMPLATES_XLSX_PATH || '';
    if (!dir || !xlsx) {
        return {
            ok: false,
            reason: 'FSOP_ENV_MISSING',
            details: 'FSOP_TEMPLATES_DIR or FSOP_TEMPLATES_XLSX_PATH missing'
        };
    }

    try {
        await fs.access(dir);
        await fs.access(xlsx);
        return { ok: true, dir, xlsx };
    } catch (error) {
        return {
            ok: false,
            reason: 'FSOP_TEMPLATES_INACCESSIBLE',
            details: error.message,
            dir,
            xlsx
        };
    }
}

async function checkSilogPipeline() {
    const staleHours = toInt(process.env.SILOG_STALE_THRESHOLD_HOURS, 24);
    try {
        const rows = await executeQuery(
            `
            SELECT
                SUM(CASE WHEN StatutTraitement IS NULL THEN 1 ELSE 0 END) AS NbNull,
                SUM(CASE WHEN StatutTraitement = 'O' THEN 1 ELSE 0 END) AS NbO,
                SUM(CASE WHEN StatutTraitement = 'T' THEN 1 ELSE 0 END) AS NbT,
                SUM(CASE WHEN StatutTraitement = 'O'
                          AND DATEDIFF(HOUR, DateCreation, GETDATE()) > @staleHours
                         THEN 1 ELSE 0 END) AS NbStaleO
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            `,
            { staleHours }
        );

        const summary = rows?.[0] || {};
        const nbNull = Number(summary.NbNull || 0);
        const nbO = Number(summary.NbO || 0);
        const nbT = Number(summary.NbT || 0);
        const nbStaleO = Number(summary.NbStaleO || 0);

        const warnings = [];
        if (nbStaleO > 0) {
            warnings.push(`SILOG_STALE_O:${nbStaleO}>${staleHours}h`);
        }
        if (nbNull > 0 && nbO === 0 && nbT === 0) {
            warnings.push('ALL_NULL_NO_VALIDATION');
        }

        return {
            ok: warnings.length === 0,
            warnings,
            counts: { null: nbNull, o: nbO, t: nbT, staleO: nbStaleO, staleHours }
        };
    } catch (error) {
        return { ok: false, reason: 'SILOG_PIPELINE_QUERY_ERROR', details: error.message };
    }
}

async function main() {
    const db = await checkDb();
    const templates = await checkTemplates();
    const silog = await checkSilogPipeline();

    const report = {
        ts: nowIso,
        health: db.ok && templates.ok && silog.ok ? 'OK' : 'WARNING',
        checks: { db, templates, silog }
    };

    if (report.health === 'OK') {
        console.log(`[WATCHDOG][OK] ${nowIso}`);
        process.exit(0);
    }

    console.error(`[WATCHDOG][WARNING] ${JSON.stringify(report)}`);
    process.exit(1);
}

main().catch((error) => {
    console.error(`[WATCHDOG][FATAL] ${error.message}`);
    process.exit(2);
});
