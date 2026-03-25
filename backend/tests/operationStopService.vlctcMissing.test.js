import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('OperationStopService - consolidation skipped (VLCTC_MISSING)', () => {
  it('does not throw and returns success=true when consolidation is skipped', async () => {
    const db = require('../config/database');
    const ConsolidationService = require('../services/ConsolidationService');

    const executeInTransactionSpy = vi
      .spyOn(db, 'executeInTransaction')
      .mockImplementation(async (cb) => {
        const tx = {
          executeQuery: vi.fn().mockResolvedValue([{ Ident: 'DEBUT', Statut: 'EN_COURS' }]),
          executeNonQuery: vi.fn().mockResolvedValue({ rowsAffected: 1 })
        };
        return await cb(tx);
      });

    const consolidateSpy = vi
      .spyOn(ConsolidationService, 'consolidateOperation')
      .mockResolvedValue({
        success: false,
        skipped: true,
        skipReason: 'VLCTC_MISSING',
        message: 'ignored'
      });

    const OperationStopService = require('../services/OperationStopService');

    const res = await OperationStopService.stopOperation({
      operatorId: '931',
      lancementCode: 'LT2600123',
      phase: 'P',
      codeRubrique: 'R',
      currentTime: '10:00:00',
      currentDate: '2026-03-25'
    });

    expect(res).toBeTruthy();
    expect(res.consolidation).toBeTruthy();
    expect(res.consolidation.skipped).toBe(true);
    expect(res.consolidation.skipReason).toBe('VLCTC_MISSING');
    expect(res.consolidation.success).toBe(true);

    executeInTransactionSpy.mockRestore();
    consolidateSpy.mockRestore();
  });
});

