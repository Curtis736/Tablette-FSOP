#!/usr/bin/env node
/* eslint-disable no-console */
const axios = require('axios');

function parseArgs(argv) {
  const out = {
    baseUrl: process.env.API_URL || 'http://localhost:3001/api',
    lancement: '',
    lancementPrefix: '26',
    codeOperation: '',
    limit: 500,
    concurrency: 40,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base-url') out.baseUrl = String(argv[++i] || out.baseUrl);
    else if (a === '--lancement') out.lancement = String(argv[++i] || '');
    else if (a === '--lancement-prefix') out.lancementPrefix = String(argv[++i] || '26');
    else if (a === '--code-operation') out.codeOperation = String(argv[++i] || '');
    else if (a === '--limit') out.limit = Math.max(1, parseInt(argv[++i] || '500', 10) || 500);
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
  const candidates = codes.filter((c) => !activeSet.has(c));

  console.log(`[INFO] Exclus (deja actifs): ${activeSet.size}`);
  console.log(`[INFO] Candidats testables: ${candidates.length}`);

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

  if (cfg.dryRun) {
    console.log('[DRY-RUN] Aucun login/start envoye.');
    process.exit(0);
  }

  const results = await mapWithConcurrency(
    candidates,
    async (code) => {
      const out = { code, login: 'KO', start: 'SKIP', error: '' };
      try {
        await client.post('/operators/login', { code });
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
    cfg.concurrency
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
  const msg = e?.message || e?.code || JSON.stringify(e);
  const status = e?.response?.status ? ` status=${e.response.status}` : '';
  const data = e?.response?.data ? ` data=${JSON.stringify(e.response.data)}` : '';
  console.error(`[FATAL]${status} ${msg}${data}`);
  process.exit(99);
});
