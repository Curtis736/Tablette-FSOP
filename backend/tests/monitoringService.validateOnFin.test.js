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

    // Le contrôle SILOG interroge successivement : la ligne allégée, la ligne complète,
    // puis l'existence de la combinaison dans SEDI_ERP.LCTC.
    const mockQueries = ({ record, lctcExists }) => {
        vi.spyOn(db, 'executeQuery').mockImplementation(async (query) => {
            if (query.includes('FROM [SEDI_ERP].[dbo].[LCTC]')) {
                return [{ ok: lctcExists ? 1 : 0 }];
            }
            return [record];
        });
    };

    const eligibleRecord = {
        TempsId: 42,
        StatutTraitement: null,
        EndTime: '10:00:00',
        StartTime: '09:30:00',
        ProductiveDuration: 30,
        OperatorCode: '931',
        LancementCode: 'LT2600123',
        Phase: '010',
        CodeRubrique: 'RUB1'
    };

    it('passes NULL → O for eligible TempsId', async () => {
        mockQueries({ record: eligibleRecord, lctcExists: true });
        const updateSpy = vi.spyOn(db, 'executeNonQuery').mockResolvedValue({ rowsAffected: 1 });

        const res = await MonitoringService.validateTempsIdForSilog(42);

        expect(res.validated).toBe(true);
        expect(res.tempsId).toBe(42);
        expect(updateSpy).toHaveBeenCalledOnce();
    });

    it('refuses validation when Phase/CodeRubrique are unresolved', async () => {
        mockQueries({
            record: { ...eligibleRecord, Phase: null, CodeRubrique: null },
            lctcExists: false
        });
        const updateSpy = vi.spyOn(db, 'executeNonQuery').mockResolvedValue({ rowsAffected: 1 });

        const res = await MonitoringService.validateTempsIdForSilog(42);

        expect(res.validated).toBe(false);
        expect(res.reason).toBe('validation_failed');
        expect(res.errors).toEqual(
            expect.arrayContaining(['Phase manquante', 'CodeRubrique manquant'])
        );
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('refuses validation when the LCTC combination does not exist', async () => {
        mockQueries({ record: eligibleRecord, lctcExists: false });
        const updateSpy = vi.spyOn(db, 'executeNonQuery').mockResolvedValue({ rowsAffected: 1 });

        const res = await MonitoringService.validateTempsIdForSilog(42);

        expect(res.validated).toBe(false);
        expect(res.reason).toBe('validation_failed');
        expect(updateSpy).not.toHaveBeenCalled();
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
