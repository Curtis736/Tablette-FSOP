#!/usr/bin/env node
/**
 * CLI maintenance : digère symptômes / logs via Haiku (AI_MODEL_FAST).
 *
 * Usage:
 *   ENABLE_AI_ASSIST=true ANTHROPIC_API_KEY=... node scripts/ai-ops-diagnose.js \
 *     --symptoms "backend unhealthy" --logs-file /var/log/sedi-watchdog.log
 */
require('dotenv').config();
const fs = require('node:fs');
const AiAssistService = require('../services/AiAssistService');

function argValue(flag) {
    const i = process.argv.indexOf(flag);
    if (i === -1) return null;
    return process.argv[i + 1] || null;
}

async function main() {
    const symptoms = argValue('--symptoms') || '';
    const context = argValue('--context') || 'fsop-prod';
    const logsFile = argValue('--logs-file');
    let logs = argValue('--logs') || '';
    if (logsFile) {
        logs = fs.readFileSync(logsFile, 'utf8');
    }
    if (!symptoms && !logs) {
        console.error('Fournir --symptoms et/ou --logs / --logs-file');
        process.exit(1);
    }
    const result = await AiAssistService.diagnoseOps({ symptoms, logs, context });
    console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
