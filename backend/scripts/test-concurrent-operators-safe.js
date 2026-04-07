#!/usr/bin/env node
/* eslint-disable no-console */
const axios = require('axios');

function parseArgs(argv) {
  const out = {
    baseUrl: process.env.API_URL || 'http://localhost:3001/api',
    lancement: '',
    lancementPrefix: '26',
    codeOperation: '',
    autoCodeOperation: true,
    limit: 500,
    maxOperators: 0,
    concurrency: 40,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base-url') out.baseUrl = String(argv[++i] || out.baseUrl);
    else if (a === '--lancement') out.lancement = String(argv[++i] || '');
    else if (a === '--lancement-prefix') out.lancementPrefix = String(argv[++i] || '26');
    else if (a === '--code-operation') out.codeOperation = String(argv[++i] || '');
    else if (a === '--no-auto-code-operation') out.autoCodeOperation = false;
    else if (a === '--limit') out.limit = Math.max(1, parseInt(argv[++i] || '500', 10) || 500);
    else if (a === '--max-operators') out.maxOperators = Math.max(0, parseInt(argv[++i] || '0', 10) || 0);
    else if (a === '--concurrency') out.concurrency = Math.max(1, parseInt(argv[++i] || '40', 10) || 40);
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

async function mapWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const myIndex = index++;
      results[myIndex] = await worker(items[myIndex], myIndex);
    }
  });
  await Promise.all(runners);
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(err, fallbackMs = 3000) {
  const seconds = Number(err?.response?.data?.retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 30 * 60 * 1000);
  }
  return fallbackMs;
}

async function loginWithRetry(client, code, maxAttempts = 3) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      await client.post('/operators/login', { code });
      return { ok: true };
    } catch (e) {
      const status = Number(e?.response?.status || 0);
      if (status === 429 && attempt < maxAttempts) {
        const waitMs = parseRetryAfterMs(e, 3000);
        await sleep(waitMs);
        continue;
      }
      return { ok: false, status, error: e };
    }
  }
  return { ok: false, status: 0, error: new Error('LOGIN_RETRY_EXHAUSTED') };
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const isAutoLancement = !cfg.lancement;

  const client = axios.create({
    baseURL: cfg.baseUrl,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' }
  });

  console.log(`[INFO] Base URL: ${cfg.baseUrl}`);

  const operatorsResp = await client.get('/operators', { params: { limit: cfg.limit } });
  const operators = Array.isArray(operatorsResp.data) ? operatorsResp.data : [];
  const codes = operators
    .map((o) => String(o.code || o.id || '').trim())
    .filter((c) => c.length > 0);

  if (codes.length === 0) {
    console.error('[ERR] Aucun operateur recupere');
    process.exit(2);
  }

  console.log(`[INFO] Operateurs recuperes: ${codes.length}`);

  const activeCheck = await mapWithConcurrency(
    codes,
    async (code) => {
      try {
        const r = await client.get(`/operators/current/${encodeURIComponent(code)}`);
        const currentData = r?.data?.data || null;
        return {
          code,
          isActive: Boolean(currentData),
          lancementCode: currentData?.lancementCode || currentData?.CodeLanctImprod || null
        };
      } catch (e) {
        return { code, isActive: true, reason: `check_failed:${e.message}` };
      }
    },
    cfg.concurrency
  );

  const activeSet = new Set(activeCheck.filter((x) => x.isActive).map((x) => x.code));
  const activeLancements = new Set(
    activeCheck
      .filter((x) => x.isActive && x.lancementCode)
      .map((x) => String(x.lancementCode).trim())
      .filter((x) => x.length > 0)
  );
  const candidatesAll = codes.filter((c) => !activeSet.has(c));
  const candidates = cfg.maxOperators > 0 ? candidatesAll.slice(0, cfg.maxOperators) : candidatesAll;

  console.log(`[INFO] Exclus (deja actifs): ${activeSet.size}`);
  console.log(`[INFO] Candidats testables: ${candidates.length}${cfg.maxOperators > 0 ? ` (cap=${cfg.maxOperators})` : ''}`);

  if (isAutoLancement) {
    const launchResp = await client.get('/lancements', { params: { search: cfg.lancementPrefix, limit: 500 } });
    const rows = Array.isArray(launchResp.data) ? launchResp.data : [];
    const launchCodes = Array.from(new Set(
      rows
        .map((r) => String(r.CodeLancement || r.codeLancement || r.CodeLanctImprod || '').trim())
        .filter((c) => c.startsWith(cfg.lancementPrefix))
    ));
    const available = launchCodes.filter((c) => !activeLancements.has(c));
    if (available.length === 0) {
      console.error(`[ERR] Aucun lancement disponible prefixe ${cfg.lancementPrefix} (hors actifs).`);
      process.exit(4);
    }
    cfg.lancement = available[0];
    console.log(`[INFO] Lancement auto-selectionne: ${cfg.lancement}`);
    console.log(`[INFO] Lancements exclus (actifs): ${activeLancements.size}`);
  } else {
    console.log(`[INFO] Lancement cible: ${cfg.lancement}`);
  }

  if (!cfg.codeOperation && cfg.autoCodeOperation) {
    try {
      const stepsResp = await client.get(`/operators/steps/${encodeURIComponent(cfg.lancement)}`);
      const uniqueOps = stepsResp?.data?.uniqueOperations || [];
      if (Array.isArray(uniqueOps) && uniqueOps.length > 0) {
        cfg.codeOperation = String(uniqueOps[0]).trim();
        console.log(`[INFO] CodeOperation auto-selectionne: ${cfg.codeOperation}`);
      } else {
        console.log('[INFO] Aucun CodeOperation detecte automatiquement (fallback sans codeOperation).');
      }
    } catch (e) {
      console.log(`[WARN] Impossible d'auto-resoudre codeOperation: ${e.message}`);
    }
  }

  if (cfg.dryRun) {
    console.log('[DRY-RUN] Aucun login/start envoye.');
    process.exit(0);
  }

  const effectiveConcurrency = Math.max(1, Math.min(cfg.concurrency, 5));
  console.log(`[INFO] Concurrency effective: ${effectiveConcurrency}`);

  const results = await mapWithConcurrency(
    candidates,
    async (code) => {
      const out = { code, login: 'KO', start: 'SKIP', error: '' };
      const loginRes = await loginWithRetry(client, code, 3);
      if (!loginRes.ok) {
        out.error = `login:${loginRes.status || 'ERR'}:${loginRes.error?.message || 'FAILED'}`;
        return out;
      }
      try {
        out.login = 'OK';
      } catch (e) {
        out.error = `login:${e?.response?.status || 'ERR'}:${e.message}`;
        return out;
      }

      try {
        const payload = { operatorId: code, lancementCode: cfg.lancement };
        if (cfg.codeOperation) payload.codeOperation = cfg.codeOperation;
        await client.post('/operators/start', payload);
        out.start = 'OK';
      } catch (e) {
        out.start = 'KO';
        out.error = `start:${e?.response?.status || 'ERR'}:${e.message}`;
      }
      return out;
    },
    effectiveConcurrency
  );

  const ok = results.filter((r) => r.login === 'OK' && r.start === 'OK').length;
  const loginKo = results.filter((r) => r.login !== 'OK').length;
  const startKo = results.filter((r) => r.login === 'OK' && r.start !== 'OK').length;
  const errors = results.filter((r) => r.error).slice(0, 20);

  console.log('\n=== RESULTATS ===');
  console.log(JSON.stringify({
    totalOperators: codes.length,
    excludedActive: activeSet.size,
    tested: candidates.length,
    successStart: ok,
    failedLogin: loginKo,
    failedStart: startKo
  }, null, 2));

  if (errors.length > 0) {
    console.log('\n=== ERREURS (max 20) ===');
    for (const e of errors) console.log(`${e.code} -> ${e.error}`);
  }

  process.exit(startKo > 0 || loginKo > 0 ? 3 : 0);
}

main().catch((e) => {
  if (Number(e?.response?.status || 0) === 429) {
    const retryAfter = Number(e?.response?.data?.retryAfter || 0);
    const sec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 'quelques';
    console.error(`[FATAL] Rate limit login atteint. Réessaie dans ${sec} secondes.`);
    process.exit(98);
  }
  const msg = e?.message || e?.code || JSON.stringify(e);
  const status = e?.response?.status ? ` status=${e.response.status}` : '';
  const data = e?.response?.data ? ` data=${JSON.stringify(e.response.data)}` : '';
  console.error(`[FATAL]${status} ${msg}${data}`);
  process.exit(99);
});
