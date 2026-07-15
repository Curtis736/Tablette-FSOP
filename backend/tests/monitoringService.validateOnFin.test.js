import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('MonitoringService.validateTempsIdForSilog', () => {
    let db;
    let MonitoringService;

    beforeEach(() => {
        vi.resetModules();
        process.env.AUTO_VALIDATE_ON_FIN = 'true';
        db = require('../config/database');
        MonitoringService = require('../services/MonitoringService');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.AUTO_VALIDATE_ON_FIN;
    });

    it('passes NULL → O for eligible TempsId', async () => {
        vi.spyOn(db, 'executeQuery').mockResolvedValue([
            { TempsId: 42, StatutTraitement: null, EndTime: '10:00:00', ProductiveDuration: 30 }
        ]);
        const updateSpy = vi.spyOn(db, 'executeNonQuery').mockResolvedValue({ rowsAffected: 1 });

        const res = await MonitoringService.validateTempsIdForSilog(42);

        expect(res.validated).toBe(true);
        expect(res.tempsId).toBe(42);
        expect(updateSpy).toHaveBeenCalledOnce();
    });

    it('is idempotent when already O', async () => {
        vi.spyOn(db, 'executeQuery').mockResolvedValue([
            { TempsId: 42, StatutTraitement: 'O', EndTime: '10:00:00', ProductiveDuration: 30 }
        ]);
        const updateSpy = vi.spyOn(db, 'executeNonQuery');

        const res = await MonitoringService.validateTempsIdForSilog(42);

        expect(res.validated).toBe(false);
        expect(res.reason).toBe('already_validated');
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('does nothing when AUTO_VALIDATE_ON_FIN=false', async () => {
        process.env.AUTO_VALIDATE_ON_FIN = 'false';
        const querySpy = vi.spyOn(db, 'executeQuery');
        const updateSpy = vi.spyOn(db, 'executeNonQuery');

        const res = await MonitoringService.validateTempsIdForSilog(42);

        expect(res.validated).toBe(false);
        expect(res.reason).toBe('disabled');
        expect(querySpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
    });
});
