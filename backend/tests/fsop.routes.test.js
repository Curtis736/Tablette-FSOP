import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import { buildFsopApp, startServer, closeServer, httpRequest } from './helpers/fsopHttpTest.js';
import {
  LAUNCH,
  TEMPLATE,
  SERIAL,
  OPERATOR,
  createFsopFilesystemLayout,
  cleanupTempDir,
  activeSessionQueryResult
} from './helpers/fsopFixtures.js';

const require = createRequire(import.meta.url);

describe.sequential('FSOP routes (unit)', () => {
  let server;
  let tempBase;
  let db;

  function mockActiveSession() {
    if (!vi.isMockFunction(db.executeQuery)) {
      vi.spyOn(db, 'executeQuery');
    }
    db.executeQuery.mockImplementation(async (query) => {
      if (String(query).includes('ABSESSIONS_OPERATEURS')) {
        return activeSessionQueryResult();
      }
      return [];
    });
  }

  beforeAll(async () => {
    db = require('../config/database');
    tempBase = await fs.mkdtemp(path.join(os.tmpdir(), 'fsop-route-'));
    const layout = await createFsopFilesystemLayout(tempBase);

    process.env.TRACEABILITY_DIR = layout.traceRoot;
    process.env.FSOP_TEMPLATES_DIR = layout.templatesDir;
    process.env.FSOP_TEMPLATES_XLSX_PATH = layout.templatesXlsx;

    mockActiveSession();
    const fsopRouter = require('../routes/fsop');
    const app = buildFsopApp(fsopRouter);
    server = await startServer(app);
  });

  beforeEach(() => {
    mockActiveSession();
  });

  afterAll(async () => {
    await closeServer(server);
    await cleanupTempDir(tempBase);
    delete process.env.TRACEABILITY_DIR;
    delete process.env.FSOP_TEMPLATES_DIR;
    delete process.env.FSOP_TEMPLATES_XLSX_PATH;
  });

  it('GET /templates returns parsed templates when Excel is available', async () => {
    const res = await httpRequest(server, 'GET', '/api/fsop/templates');
    expect(res.status).toBe(200);
    expect(res.data.count).toBeGreaterThanOrEqual(1);
    expect(res.data.templates.some((t) => t.code === TEMPLATE)).toBe(true);
  });

  it('GET /lots/:launchNumber rejects invalid launch number', async () => {
    const res = await httpRequest(server, 'GET', '/api/fsop/lots/INVALID');
    expect(res.status).toBe(400);
    expect(res.data.error).toBe('INVALID_LAUNCH_NUMBER');
  });

  it('POST /open returns 400 for invalid template code', async () => {
    const res = await httpRequest(server, 'POST', '/api/fsop/open', {
      body: {
        launchNumber: LAUNCH,
        templateCode: 'BAD',
        serialNumber: SERIAL,
        operatorId: OPERATOR
      },
      headers: { 'x-operator-code': OPERATOR }
    });

    expect(res.status).toBe(400);
    expect(res.data.error).toBe('INPUT_INVALID');
  });

  it('POST /save returns 400 for invalid serial number', async () => {
    const res = await httpRequest(server, 'POST', '/api/fsop/save', {
      body: {
        launchNumber: LAUNCH,
        templateCode: TEMPLATE,
        serialNumber: '../evil',
        operatorId: OPERATOR,
        formData: {}
      },
      headers: { 'x-operator-code': OPERATOR }
    });

    expect(res.status).toBe(400);
    expect(res.data.error).toBe('INPUT_INVALID');
  });

  it('POST /open returns 401 without operator', async () => {
    const res = await httpRequest(server, 'POST', '/api/fsop/open', {
      body: {
        launchNumber: LAUNCH,
        templateCode: TEMPLATE,
        serialNumber: SERIAL
      }
    });
    expect(res.status).toBe(401);
    expect(res.data.error).toBe('OPERATOR_REQUIRED');
  });

  it('POST /open returns 401 when session is inactive', async () => {
    db.executeQuery.mockImplementation(async () => []);

    const res = await httpRequest(server, 'POST', '/api/fsop/open', {
      body: {
        launchNumber: LAUNCH,
        templateCode: TEMPLATE,
        serialNumber: SERIAL,
        operatorId: OPERATOR
      },
      headers: { 'x-operator-code': OPERATOR }
    });

    expect(res.status).toBe(401);
    expect(res.data.error).toBe('SESSION_REQUIRED');
  });
});
