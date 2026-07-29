/**
 * Tests unitaires — ReliabilityAlertService (cooldown + canaux).
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('ReliabilityAlertService', () => {
    let ReliabilityAlertService;
    let tmpDir;

    beforeEach(async () => {
        vi.resetModules();
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsop-alert-'));
        process.env.ALERT_COOLDOWN_PATH = path.join(tmpDir, 'cooldown.json');
        process.env.ALERT_COOLDOWN_MINUTES = '60';
        process.env.ALERTS_ENABLED = 'true';
        delete process.env.TEAMS_WEBHOOK_URL;
        delete process.env.ALERT_TEAMS_WEBHOOK;
        delete process.env.SMTP_HOST;
        delete process.env.SMTP_USER;
        process.env.EMAIL_DISABLED = 'true';
        ReliabilityAlertService = require('../services/ReliabilityAlertService');
    });

    afterEach(async () => {
        try {
            await fs.rm(tmpDir, { recursive: true, force: true });
        } catch (_) {
            // ignore
        }
    });

    test('cooldown bloque le 2e envoi du même code', async () => {
        const r1 = await ReliabilityAlertService.sendAlert({
            code: 'TEST_CODE',
            title: 't1',
            body: 'b1'
        });
        expect(r1.reason).not.toBe('cooldown');

        const r2 = await ReliabilityAlertService.sendAlert({
            code: 'TEST_CODE',
            title: 't2',
            body: 'b2'
        });
        expect(r2.skipped).toBe(true);
        expect(r2.reason).toBe('cooldown');
    });

    test('force contourne le cooldown', async () => {
        await ReliabilityAlertService.sendAlert({ code: 'FORCE', title: 'a', body: 'b' });
        const r = await ReliabilityAlertService.sendAlert({
            code: 'FORCE',
            title: 'a2',
            body: 'b2',
            force: true
        });
        expect(r.reason).not.toBe('cooldown');
    });
});
