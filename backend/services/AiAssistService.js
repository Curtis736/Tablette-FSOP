/**
 * Assistance IA (Anthropic via AI SDK) — propose / explique, n'applique jamais hold/transfert.
 *
 * ENABLE_AI_ASSIST=true + ANTHROPIC_API_KEY requis.
 * Modèles: AI_MODEL_ASSIST (Sonnet) / AI_MODEL_FAST (Haiku).
 */

const { generateObject } = require('ai');
const { createAnthropic } = require('@ai-sdk/anthropic');
const { z } = require('zod');

const lineAssistSchema = z.object({
    summary: z.string().describe('1-2 phrases en français atelier'),
    issues: z.array(z.string()).describe('Problèmes détectés, courts'),
    recommendedAction: z.enum(['block', 'correct', 'transmit', 'release_hold', 'none']),
    actionLabel: z.string().describe('Libellé bouton FR court'),
    motif: z.string().describe('Motif court pour le correcteur (max ~120 car.)'),
    correctionHints: z.array(z.string()).describe('Pistes de correction concrètes'),
    confidence: z.number().min(0).max(1)
});

const supportSummarySchema = z.object({
    headline: z.string(),
    bullets: z.array(z.string()).max(12),
    priorityNote: z.string()
});

const opsDiagnoseSchema = z.object({
    diagnosis: z.string(),
    likelyCauses: z.array(z.string()).max(8),
    nextChecks: z.array(z.string()).max(8),
    severity: z.enum(['info', 'warning', 'critical'])
});

function isEnabled() {
    return String(process.env.ENABLE_AI_ASSIST || '').trim().toLowerCase() === 'true';
}

function requireApiKey() {
    const key = String(process.env.ANTHROPIC_API_KEY || '').trim();
    if (!key) {
        const err = new Error('ANTHROPIC_API_KEY manquant');
        err.code = 'AI_CONFIG';
        throw err;
    }
    return key;
}

function getAnthropic() {
    return createAnthropic({ apiKey: requireApiKey() });
}

function assistModelId() {
    return String(process.env.AI_MODEL_ASSIST || 'claude-sonnet-4-5').trim();
}

function fastModelId() {
    return String(process.env.AI_MODEL_FAST || 'claude-haiku-4-5').trim();
}

function sanitizeLinePayload(raw = {}) {
    return {
        TempsId: raw.TempsId ?? raw.tempsId ?? null,
        EventId: raw.EventId ?? raw.eventId ?? null,
        OperatorCode: raw.OperatorCode ?? raw.operatorCode ?? null,
        OperatorName: raw.OperatorName ?? raw.operatorName ?? null,
        LancementCode: raw.LancementCode ?? raw.lancementCode ?? null,
        LancementName: raw.LancementName ?? raw.lancementName ?? null,
        StepCode: raw.StepCode ?? raw.stepCode ?? raw.CodeEtape ?? null,
        StepLabel: raw.StepLabel ?? raw.stepLabel ?? raw.LibelleEtape ?? null,
        StartTime: raw.StartTime ?? raw.startTime ?? null,
        EndTime: raw.EndTime ?? raw.endTime ?? null,
        StatutTraitement: raw.StatutTraitement ?? raw.statutTraitement ?? null,
        Status: raw.Status ?? raw.status ?? null,
        StatusCode: raw.StatusCode ?? raw.statusCode ?? null,
        ProductiveDuration: raw.ProductiveDuration ?? raw.productiveDuration ?? null,
        PauseDuration: raw.PauseDuration ?? raw.pauseDuration ?? null,
        _isUnconsolidated: raw._isUnconsolidated === true || !raw.TempsId,
        _isPauseRow: raw._isPauseRow === true || raw.type === 'pause',
        knownIssues: Array.isArray(raw.knownIssues) ? raw.knownIssues.slice(0, 12) : [],
        multiOperatorsOnLt: raw.multiOperatorsOnLt ?? null
    };
}

class AiAssistService {
    static isEnabled() {
        return isEnabled();
    }

    static status() {
        return {
            enabled: isEnabled(),
            hasApiKey: Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim()),
            assistModel: assistModelId(),
            fastModel: fastModelId()
        };
    }

    /**
     * Analyse une ligne monitoring / hold et propose une action.
     */
    static async analyzeMonitoringLine(rawLine, { context = 'monitoring' } = {}) {
        if (!isEnabled()) {
            const err = new Error('Assistance IA désactivée (ENABLE_AI_ASSIST!=true)');
            err.code = 'AI_DISABLED';
            throw err;
        }

        const line = sanitizeLinePayload(rawLine);
        const anthropic = getAnthropic();
        const model = anthropic(assistModelId());

        const system = [
            'Tu es un assistant atelier SEDI (tablette temps / SILOG).',
            'Tu expliques en français simple, phrases courtes.',
            'Tu ne inventes pas de données absentes du JSON.',
            'Règles métier:',
            '- StatutTraitement A = bloquée (hors auto 20h / transfert batch).',
            '- StatutTraitement T = déjà transmise SILOG (ne pas modifier).',
            '- StatutTraitement O = validée, prête à transmettre.',
            '- NULL = pas encore validée.',
            '- Sans TempsId (non consolidée) : pas de blocage/transfert possible → recommande correct ou attendre consolidation.',
            'recommendedAction:',
            '- block = mettre en A le temps de corriger',
            '- correct = éditer heures / LT / pause',
            '- transmit = envoyer cette ligne seule vers SILOG',
            '- release_hold = débloquer A sans envoyer',
            '- none = rien à faire',
            'Si la ligne est déjà en A, priorise release_hold+correct ou transmit selon le contexte.'
        ].join('\n');

        const { object } = await generateObject({
            model,
            schema: lineAssistSchema,
            system,
            prompt: JSON.stringify({
                context,
                line,
                ask: 'Diagnostique et propose UNE action principale + motif court.'
            })
        });

        return {
            success: true,
            data: object,
            meta: {
                model: assistModelId(),
                tempsId: line.TempsId,
                context
            }
        };
    }

    /**
     * Résumé atelier d'écarts Support Tech / Éditions (payload déjà calculé).
     */
    static async summarizeSupportTech(payload = {}) {
        if (!isEnabled()) {
            const err = new Error('Assistance IA désactivée (ENABLE_AI_ASSIST!=true)');
            err.code = 'AI_DISABLED';
            throw err;
        }

        const anthropic = getAnthropic();
        const model = anthropic(fastModelId());
        const compact = {
            period: payload.period || null,
            alertCount: payload.alertCount ?? payload.alerteCount ?? null,
            rows: Array.isArray(payload.rows) ? payload.rows.slice(0, 40) : [],
            highlights: payload.highlights || null
        };

        const { object } = await generateObject({
            model,
            schema: supportSummarySchema,
            system: [
                'Tu résumes des écarts coûts/temps atelier SEDI pour un mail ou un écran.',
                'Français atelier, sans jargon LLM.',
                'Focus: écarts >15 %, alertes ≥500 € si présents.',
                'Pas d’inventer de montants absents du JSON.'
            ].join('\n'),
            prompt: JSON.stringify(compact)
        });

        return { success: true, data: object, meta: { model: fastModelId() } };
    }

    /**
     * Digère logs / symptômes ops (maintenance).
     */
    static async diagnoseOps({ symptoms = '', logs = '', context = '' } = {}) {
        if (!isEnabled()) {
            const err = new Error('Assistance IA désactivée (ENABLE_AI_ASSIST!=true)');
            err.code = 'AI_DISABLED';
            throw err;
        }

        const anthropic = getAnthropic();
        const model = anthropic(fastModelId());
        const clippedLogs = String(logs || '').slice(0, 12000);

        const { object } = await generateObject({
            model,
            schema: opsDiagnoseSchema,
            system: [
                'Tu es un runbook assistant pour la VM FSOP (Docker: sedi-tablette-backend/frontend/redis, CIFS mounts, nginx).',
                'Propose des checks concrets (docker ps, compose, montages /mnt/partage_*, redis, health /api/health).',
                'Ne propose pas de commandes destructrices (rm -rf, volume prune) sauf si explicitement nécessaire et avec avertissement.'
            ].join('\n'),
            prompt: JSON.stringify({ context, symptoms, logs: clippedLogs })
        });

        return { success: true, data: object, meta: { model: fastModelId() } };
    }
}

module.exports = AiAssistService;
