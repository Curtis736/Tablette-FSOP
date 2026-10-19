/**
 * Watchdog prod : DB + templates/CIFS + pipeline SILOG (O stale) + holds (A) + dernier EDI_JOB.
 * Envoie une alerte Teams/email par code (cooldown indépendant).
 *
 * Usage: node scripts/proactive-watchdog.js
 * Exit: 0 OK | 1 WARNING | 2 FATAL
 */

const fs = require('fs/promises');
const path = require('path');
const { executeQuery } = require('../config/database');
const ReliabilityAlertService = require('../services/ReliabilityAlertService');

const nowIso = new Date().toISOString();

function toInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function pathAccessible(p, label) {
    if (!p) {
        return { ok: false, reason: `${label}_ENV_MISSING`, details: `${label} not set` };
    }
    try {
        await fs.access(p);
        return { ok: true, path: p };
    } catch (error) {
        return {
            ok: false,
            reason: `${label}_INACCESSIBLE`,
            details: error.message,
            path: p
        };
    }
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

/** Traçabilité / CIFS côté conteneur (TRACEABILITY_DIR). */
async function checkTraceabilityMount() {
    const dir =
        process.env.TRACEABILITY_DIR ||
        process.env.SERVICES_CONTAINER_PATH ||
        '/mnt/services/Tracabilite';
    return pathAccessible(dir, 'TRACEABILITY');
}

/**
 * Stale O = en attente SILOG trop longtemps (file transfert / EDI).
 * Lancements soldés exclus.
 */
async function checkSilogPipeline() {
    const staleHours = toInt(process.env.SILOG_STALE_THRESHOLD_HOURS, 24);
    const backlogWarn = toInt(process.env.SILOG_BACKLOG_O_WARN, 40);
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
        if (nbO >= backlogWarn) {
            warnings.push(`SILOG_BACKLOG_O:${nbO}>=${backlogWarn}`);
        }
        if (nbStaleOSoldes > 0) {
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
                staleHours,
                backlogWarn
            }
        };
    } catch (error) {
        return { ok: false, reason: 'SILOG_PIPELINE_QUERY_ERROR', details: error.message };
    }
}

/** Lignes bloquées (A) trop longtemps. */
async function checkHoldStale() {
    const holdHours = toInt(process.env.HOLD_STALE_HOURS, 2);
    try {
        const rows = await executeQuery(
            `
            SELECT
                COUNT(*) AS NbHold,
                SUM(CASE WHEN DATEDIFF(HOUR, ISNULL(t.DateCreation, GETDATE()), GETDATE()) > @holdHours
                         THEN 1 ELSE 0 END) AS NbHoldStale,
                MIN(t.TempsId) AS SampleTempsId
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t WITH (NOLOCK)
            WHERE t.StatutTraitement = 'A'
            `,
            { holdHours }
        );
        const nbHold = Number(rows?.[0]?.NbHold || 0);
        const nbHoldStale = Number(rows?.[0]?.NbHoldStale || 0);
        const sampleTempsId = rows?.[0]?.SampleTempsId ?? null;

        const warnings = [];
        if (nbHoldStale > 0) {
            warnings.push(`HOLD_STALE:${nbHoldStale}>${holdHours}h (total A=${nbHold})`);
        }

        // Fin de journée atelier : encore des A après l'heure configurée
        const afterHour = toInt(process.env.HOLD_ALERT_AFTER_HOUR, 19);
        const parisHour = Number.parseInt(
            new Intl.DateTimeFormat('fr-FR', {
                timeZone: 'Europe/Paris',
                hour: 'numeric',
                hour12: false
            }).format(new Date()),
            10
        );
        if (Number.isFinite(parisHour) && parisHour >= afterHour && nbHold > 0) {
            warnings.push(`HOLD_AFTER_HOUR:${nbHold}_A_apres_${afterHour}h`);
        }

        return {
            ok: warnings.length === 0,
            warnings,
            counts: { nbHold, nbHoldStale, holdHours, afterHour, sampleTempsId }
        };
    } catch (error) {
        return { ok: false, reason: 'HOLD_QUERY_ERROR', details: error.message };
    }
}

/** Dernier échec EDI_JOB enregistré par EdiJobService. */
async function checkEdiLastFailure() {
    const statusPath =
        process.env.EDI_LAST_STATUS_PATH ||
        path.join(process.env.SILOG_DAILY_GUARD_PATH ? path.dirname(process.env.SILOG_DAILY_GUARD_PATH) : '/app/logs', 'edi-last-status.json');
    const maxAgeHours = toInt(process.env.EDI_FAILURE_ALERT_HOURS, 6);
    try {
        const raw = await fs.readFile(statusPath, 'utf8');
        const data = JSON.parse(raw);
        if (data?.ok === true) {
            return { ok: true, statusPath, last: data };
        }
        const at = data?.at ? Date.parse(data.at) : 0;
        const ageH = at ? (Date.now() - at) / 3600000 : Infinity;
        if (ageH <= maxAgeHours) {
            return {
                ok: false,
                reason: 'EDI_JOB_RECENT_FAILURE',
                details: data?.error || data?.message || 'échec EDI',
                ageHours: Math.round(ageH * 10) / 10,
                last: data,
                statusPath
            };
        }
        return { ok: true, statusPath, staleFailureIgnored: true, last: data };
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { ok: true, statusPath, note: 'no_status_file' };
        }
        return { ok: false, reason: 'EDI_STATUS_READ_ERROR', details: error.message };
    }
}

async function emitAlerts(checks) {
    const alerts = [];

    if (!checks.db.ok) {
        alerts.push({
            code: 'WATCHDOG_DB',
            title: 'Watchdog — base SQL injoignable',
            body: `${nowIso}\nDB: ${checks.db.reason || 'KO'} ${checks.db.details || ''}`,
            severity: 'critical'
        });
    }
    if (!checks.templates.ok) {
        alerts.push({
            code: 'WATCHDOG_TEMPLATES',
            title: 'Watchdog — templates FSOP inaccessibles (CIFS ?)',
            body:
                `${nowIso}\nTemplates: ${checks.templates.reason || 'KO'}\n` +
                `${checks.templates.details || ''}\n` +
                `dir=${checks.templates.dir || ''} xlsx=${checks.templates.xlsx || ''}\n` +
                `Vérifier: mount | grep partage ; docker/prod/scripts/ensure-cifs-mounts.sh`,
            severity: 'critical'
        });
    }
    if (!checks.traceability.ok) {
        alerts.push({
            code: 'WATCHDOG_CIFS_TRACEABILITY',
            title: 'Watchdog — traçabilité / CIFS inaccessible',
            body:
                `${nowIso}\n${checks.traceability.reason || 'KO'}\n` +
                `${checks.traceability.details || ''}\npath=${checks.traceability.path || ''}\n` +
                `Runbook: docs/ops/RUNBOOK_INCIDENT_RAPIDE.md (montages CIFS)`,
            severity: 'critical'
        });
    }
    if (!checks.silog.ok) {
        alerts.push({
            code: 'WATCHDOG_SILOG_STALE',
            title: 'Watchdog — file transfert / EDI (O en retard)',
            body:
                `${nowIso}\nSILOG: ${(checks.silog.warnings || [checks.silog.reason]).join('; ')}\n` +
                `counts=${JSON.stringify(checks.silog.counts || {})}\n` +
                `Action: admin → Transfert, ou EDI_JOB ; exclure lancements soldés.`,
            severity: 'warning'
        });
    }
    if (!checks.hold.ok) {
        alerts.push({
            code: 'WATCHDOG_HOLD_STALE',
            title: 'Watchdog — lignes bloquées (A) trop longtemps',
            body:
                `${nowIso}\nHold: ${(checks.hold.warnings || [checks.hold.reason]).join('; ')}\n` +
                `counts=${JSON.stringify(checks.hold.counts || {})}\n` +
                `Action: admin → débloquer / corriger / avion (transfert seule ligne).`,
            severity: 'warning'
        });
    }
    if (!checks.edi.ok) {
        alerts.push({
            code: 'WATCHDOG_EDI_FAILURE',
            title: 'Watchdog — dernier EDI_JOB en échec',
            body:
                `${nowIso}\n${checks.edi.reason || 'EDI_KO'}: ${checks.edi.details || ''}\n` +
                `âge≈${checks.edi.ageHours ?? '?'}h\n` +
                `last=${JSON.stringify(checks.edi.last || {})}`,
            severity: 'warning'
        });
    }

    for (const a of alerts) {
        await ReliabilityAlertService.sendAlert(a);
    }
    return alerts;
}

async function main() {
    const db = await checkDb();
    const templates = await checkTemplates();
    const traceability = await checkTraceabilityMount();
    const silog = await checkSilogPipeline();
    const hold = await checkHoldStale();
    const edi = await checkEdiLastFailure();

    const checks = { db, templates, traceability, silog, hold, edi };
    const allOk = Object.values(checks).every((c) => c && c.ok);

    const report = {
        ts: nowIso,
        health: allOk ? 'OK' : 'WARNING',
        checks
    };

    if (allOk) {
        console.log(`[WATCHDOG][OK] ${nowIso}`);
        process.exit(0);
    }

    console.error(`[WATCHDOG][WARNING] ${JSON.stringify(report)}`);
    await emitAlerts(checks);
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
