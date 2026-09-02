import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildFsopApp, startServer, closeServer, httpRequest } from './helpers/fsopHttpTest.js';
import {
  LAUNCH,
  TEMPLATE,
  SERIAL,
  OPERATOR,
  createTempFsopEnv,
  cleanupTempDir,
  activeSessionQueryResult,
  lotsQueryResult
} from './helpers/fsopFixtures.js';

const require = createRequire(import.meta.url);

describe.sequential('FSOP flow (e2e)', () => {
  let server;
  let env;
  let db;

  function mockDb() {
    if (!vi.isMockFunction(db.executeQuery)) {
      vi.spyOn(db, 'executeQuery');
    }
    db.executeQuery.mockImplementation(async (query) => {
      if (String(query).includes('ABSESSIONS_OPERATEURS')) {
        return activeSessionQueryResult();
      }
      if (String(query).includes('LCTC')) {
        return lotsQueryResult();
      }
      return [];
    });
  }

  beforeAll(async () => {
    db = require('../config/database');
    env = await createTempFsopEnv();

    process.env.TRACEABILITY_DIR = env.traceRoot;
    process.env.FSOP_TEMPLATES_DIR = env.templatesDir;
    process.env.FSOP_TEMPLATES_XLSX_PATH = env.templatesXlsx;
    process.env.FSOP_SEARCH_DEPTH = '3';

    mockDb();
    const fsopRouter = require('../routes/fsop');
    const app = buildFsopApp(fsopRouter);
    server = await startServer(app);
  });

  beforeEach(() => {
    mockDb();
  });

  afterAll(async () => {
    await closeServer(server);
    await cleanupTempDir(env?.baseDir);
    delete process.env.TRACEABILITY_DIR;
    delete process.env.FSOP_TEMPLATES_DIR;
    delete process.env.FSOP_TEMPLATES_XLSX_PATH;
    delete process.env.FSOP_SEARCH_DEPTH;
  });

  it('lists FSOP templates from real Excel file', async () => {
    const res = await httpRequest(server, 'GET', '/api/fsop/templates');
    expect(res.status).toBe(200);
    expect(res.data.count).toBeGreaterThanOrEqual(1);
    expect(res.data.templates.some((t) => t.code === TEMPLATE)).toBe(true);
  });

  it('returns lots for a valid launch number', async () => {
    const res = await httpRequest(server, 'GET', `/api/fsop/lots/${LAUNCH}`);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(Array.isArray(res.data.uniqueLots)).toBe(true);
    expect(res.data.uniqueLots.length).toBeGreaterThanOrEqual(1);
  });

  it('opens a FSOP document (copy template + inject LT/SN)', async () => {
    const res = await httpRequest(server, 'POST', '/api/fsop/open', {
      body: {
        launchNumber: LAUNCH,
        templateCode: TEMPLATE,
        serialNumber: SERIAL,
        operatorId: OPERATOR
      },
      headers: { 'x-operator-code': OPERATOR }
    });

    expect(res.status).toBe(200);
    expect(Buffer.isBuffer(res.data)).toBe(true);
    expect(res.data.length).toBeGreaterThan(100);

    const destName = `FSOP_${TEMPLATE}_${SERIAL}_${LAUNCH}.docx`;
    const destPath = path.join(env.fsopDir, destName);
    const stat = await fs.stat(destPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('saves FSOP form data and writes JSON sidecar', async () => {
    const res = await httpRequest(server, 'POST', '/api/fsop/save', {
      body: {
        launchNumber: LAUNCH,
        templateCode: TEMPLATE,
        serialNumber: SERIAL,
        operatorId: OPERATOR,
        formData: {
          placeholders: { '{{LT}}': LAUNCH, '{{SN}}': SERIAL },
          tables: {},
          passFail: {},
          checkboxes: {}
        }
      },
      headers: { 'x-operator-code': OPERATOR }
    });

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.fileName).toBe(`FSOP_${TEMPLATE}_${SERIAL}_${LAUNCH}.docx`);

    const jsonPath = path.join(
      env.fsopDir,
      `FSOP_${TEMPLATE}_${SERIAL}_${LAUNCH}.json`
    );
    const jsonRaw = await fs.readFile(jsonPath, 'utf8');
    const jsonData = JSON.parse(jsonRaw);
    expect(jsonData.launchNumber).toBe(LAUNCH);
    expect(jsonData.templateCode).toBe(TEMPLATE);
    expect(jsonData.serialNumber).toBe(SERIAL);
  });
});
