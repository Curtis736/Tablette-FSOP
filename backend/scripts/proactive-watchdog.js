/**
 * Watchdog prod : DB + templates FSOP + pipeline SILOG (O stale hors lancements soldés).
 * Envoie une alerte Teams/email si WARNING (via ReliabilityAlertService).
 *
 * Usage: node scripts/proactive-watchdog.js
 * Exit: 0 OK | 1 WARNING | 2 FATAL
 */

const fs = require('fs/promises');
const { executeQuery } = require('../config/database');
const ReliabilityAlertService = require('../services/ReliabilityAlertService');

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

/**
 * Stale O = en attente SILOG trop longtemps.
 * Les lancements soldés (LCTE.LancementSolde <> 'N') sont exclus de l'alerte
 * (EDI ne peut pas les intégrer — faux positif sinon).
 */
async function checkSilogPipeline() {
    const staleHours = toInt(process.env.SILOG_STALE_THRESHOLD_HOURS, 24);
    const erpDb = process.env.DB_ERP_DATABASE || 'SEDI_ERP';
    try {
        const rows = await executeQuery(
            `
            SELECT
                SUM(CASE WHEN t.StatutTraitement IS NULL THEN 1 ELSE 0 END) AS NbNull,
                SUM(CASE WHEN t.StatutTraitement = 'O' THEN 1 ELSE 0 END) AS NbO,
                SUM(CASE WHEN t.StatutTraitement = 'T' THEN 1 ELSE 0 END) AS NbT,
                SUM(CASE WHEN t.StatutTraitement = 'O'
                          AND DATEDIFF(HOUR, t.DateCreation, GETDATE()) > @staleHours
                         THEN 1 ELSE 0 END) AS NbStaleO,
                SUM(CASE WHEN t.StatutTraitement = 'O'
                          AND DATEDIFF(HOUR, t.DateCreation, GETDATE()) > @staleHours
                          AND ISNULL(E.LancementSolde, 'O') = 'N'
                         THEN 1 ELSE 0 END) AS NbStaleOActionable,
                SUM(CASE WHEN t.StatutTraitement = 'O'
                          AND DATEDIFF(HOUR, t.DateCreation, GETDATE()) > @staleHours
                          AND ISNULL(E.LancementSolde, 'O') <> 'N'
                         THEN 1 ELSE 0 END) AS NbStaleOSoldes
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
            LEFT JOIN [${erpDb}].[dbo].[LCTE] E ON E.CodeLancement = t.LancementCode
            `,
            { staleHours }
        );

        const summary = rows?.[0] || {};
        const nbNull = Number(summary.NbNull || 0);
        const nbO = Number(summary.NbO || 0);
        const nbT = Number(summary.NbT || 0);
        const nbStaleO = Number(summary.NbStaleO || 0);
        const nbStaleOActionable = Number(summary.NbStaleOActionable || 0);
        const nbStaleOSoldes = Number(summary.NbStaleOSoldes || 0);

        const warnings = [];
        if (nbStaleOActionable > 0) {
            warnings.push(
                `SILOG_STALE_O_ACTIONABLE:${nbStaleOActionable}>${staleHours}h (hors soldés)`
            );
        }
        if (nbStaleOSoldes > 0) {
            // Info seulement — ne fait pas échouer le watchdog (pas d'alerte spam)
            console.log(
                `[WATCHDOG][INFO] ${nbStaleOSoldes} O stale sur lancements soldés (ignorés pour alerte)`
            );
        }
        if (nbNull > 0 && nbO === 0 && nbT === 0) {
            warnings.push('ALL_NULL_NO_VALIDATION');
        }

        return {
            ok: warnings.length === 0,
            warnings,
            counts: {
                null: nbNull,
                o: nbO,
                t: nbT,
                staleO: nbStaleO,
                staleOActionable: nbStaleOActionable,
                staleOSoldes: nbStaleOSoldes,
                staleHours
            }
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

    const parts = [];
    if (!db.ok) parts.push(`DB: ${db.reason || 'KO'} ${db.details || ''}`);
    if (!templates.ok) parts.push(`Templates: ${templates.reason || 'KO'} ${templates.details || ''}`);
    if (!silog.ok) {
        parts.push(
            `SILOG: ${(silog.warnings || [silog.reason]).join('; ')} ` +
                `counts=${JSON.stringify(silog.counts || {})}`
        );
    }

    const code = !db.ok
        ? 'WATCHDOG_DB'
        : !templates.ok
          ? 'WATCHDOG_TEMPLATES'
          : 'WATCHDOG_SILOG_STALE';

    await ReliabilityAlertService.sendAlert({
        code,
        title: `Watchdog WARNING — ${code}`,
        body: `Horodatage: ${nowIso}\n\n${parts.join('\n')}\n\nRunbook: backend/docs/RUNBOOK_INCIDENT_RAPIDE.md`,
        severity: !db.ok ? 'critical' : 'warning'
    });

    process.exit(1);
}

main().catch(async (error) => {
    console.error(`[WATCHDOG][FATAL] ${error.message}`);
    try {
        await ReliabilityAlertService.sendAlert({
            code: 'WATCHDOG_FATAL',
            title: 'Watchdog FATAL',
            body: `${nowIso}\n${error.message}`,
            severity: 'critical'
        });
    } catch (_) {
        // ignore
    }
    process.exit(2);
});
