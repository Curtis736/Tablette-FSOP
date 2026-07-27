import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ConsolidationService = require('../services/ConsolidationService');

describe('ConsolidationService - ERP keys resolution', () => {
  const baseEvents = [
    {
      Ident: 'DEBUT',
      Phase: 'PRODUCTION',
      CodeRubrique: '931',
      DateCreation: '2026-07-27',
      CreatedAt: '2026-07-27T08:00:00',
      HeureDebut: '08:00:00',
      NoEnreg: 1
    },
    {
      Ident: 'FIN',
      Phase: 'PRODUCTION',
      CodeRubrique: '931',
      DateCreation: '2026-07-27',
      CreatedAt: '2026-07-27T09:00:00',
      HeureFin: '09:00:00',
      NoEnreg: 2
    }
  ];

  function makeDb(handler) {
    return {
      executeQuery: vi.fn(handler),
      executeNonQuery: vi.fn().mockResolvedValue({ rowsAffected: 0 })
    };
  }

  it('skips consolidation (VLCTC_MISSING) instead of inserting NULL when ERP has no keys', async () => {
    const db = makeDb(async (query) => {
      if (query.includes('ABHISTORIQUE_OPERATEURS')) return baseEvents;
      if (query.includes('V_LCTC') || query.includes('[LCTC]')) return [];
      return [];
    });

    const res = await ConsolidationService.consolidateOperation('931', 'LT2600999', {
      autoFix: true,
      skipSilogValidate: true,
      db
    });

    expect(res.skipped).toBe(true);
    expect(res.skipReason).toBe('VLCTC_MISSING');
    expect(res.tempsId).toBeNull();
    const insertCalls = db.executeQuery.mock.calls.filter(([q]) =>
      String(q).includes('INSERT') && String(q).includes('ABTEMPS')
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('uses LCTC keys when V_LCTC is empty but LCTC has the launch', async () => {
    const db = makeDb(async (query) => {
      if (query.includes('ABHISTORIQUE_OPERATEURS')) return baseEvents;
      if (query.includes('V_LCTC')) return [];
      if (query.includes('[SEDI_ERP].[dbo].[LCTC]')) {
        return [{ Phase: '010', CodeRubrique: 'ConnectS' }];
      }
      if (query.includes('ABTEMPS_OPERATEURS') && query.includes('SELECT')) return [];
      if (query.includes('INSERT') && query.includes('ABTEMPS_OPERATEURS')) {
        return [{ TempsId: 777 }];
      }
      return [];
    });

    const res = await ConsolidationService.consolidateOperation('931', 'LT2600999', {
      autoFix: true,
      skipSilogValidate: true,
      db
    });

    expect(res.success).toBe(true);
    expect(res.skipped).toBeFalsy();
    expect(res.tempsId).toBe(777);
  });

  it('prefers options.phase/codeRubrique when they are real ERP keys', async () => {
    const erpEvents = [
      { ...baseEvents[0], Phase: '010', CodeRubrique: 'ConnectS' },
      { ...baseEvents[1], Phase: '010', CodeRubrique: 'ConnectS' }
    ];
    const db = makeDb(async (query) => {
      if (query.includes('ABHISTORIQUE_OPERATEURS')) return erpEvents;
      if (query.includes('ABTEMPS_OPERATEURS') && query.includes('SELECT')) return [];
      if (query.includes('INSERT') && query.includes('ABTEMPS_OPERATEURS')) {
        return [{ TempsId: 888 }];
      }
      return [];
    });

    const res = await ConsolidationService.consolidateOperation('931', 'LT2600999', {
      autoFix: true,
      skipSilogValidate: true,
      phase: '010',
      codeRubrique: 'ConnectS',
      db
    });

    expect(res.success).toBe(true);
    expect(res.tempsId).toBe(888);
    // No ERP lookup needed when options already provide keys matching events
    const erpLookups = db.executeQuery.mock.calls.filter(([q]) =>
      String(q).includes('V_LCTC') || String(q).includes('[LCTC]')
    );
    expect(erpLookups).toHaveLength(0);
  });
});
