import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ConsolidationService = require('../services/ConsolidationService');

describe('ConsolidationService - same-day cycles', () => {
  const cycle2Events = [
    {
      Ident: 'DEBUT',
      Phase: '010',
      CodeRubrique: 'ConnectS',
      DateCreation: '2026-09-16',
      CreatedAt: '2026-09-16T09:15:17',
      HeureDebut: '09:15:17',
      NoEnreg: 1503
    },
    {
      Ident: 'FIN',
      Phase: '010',
      CodeRubrique: 'ConnectS',
      DateCreation: '2026-09-16',
      CreatedAt: '2026-09-16T09:48:23',
      HeureFin: '09:48:23',
      NoEnreg: 1506
    }
  ];

  // Historique avec un 1er cycle déjà consolidé + le 2e à consolider (latest)
  const twoCyclesHistory = [
    {
      Ident: 'DEBUT',
      Phase: '010',
      CodeRubrique: 'ConnectS',
      DateCreation: '2026-09-16',
      CreatedAt: '2026-09-16T09:12:30',
      HeureDebut: '09:12:30',
      NoEnreg: 1501
    },
    {
      Ident: 'FIN',
      Phase: '010',
      CodeRubrique: 'ConnectS',
      DateCreation: '2026-09-16',
      CreatedAt: '2026-09-16T09:15:07',
      HeureFin: '09:15:07',
      NoEnreg: 1502
    },
    ...cycle2Events
  ];

  function makeDb(handler) {
    return {
      executeQuery: vi.fn(handler),
      executeNonQuery: vi.fn().mockResolvedValue({ rowsAffected: 0 })
    };
  }

  it('inserts a 2nd same-day cycle even if another ABTEMPS exists for that day', async () => {
    const db = makeDb(async (query, params) => {
      if (query.includes('ABHISTORIQUE_OPERATEURS')) return twoCyclesHistory;
      if (query.includes('ABTEMPS_OPERATEURS') && query.includes('StartTime = @startTime') && query.includes('SELECT')) {
        // Pas de ligne pour CE StartTime (09:15) — même si 09:12 existe déjà
        return [];
      }
      if (query.includes('DateCreation = @dateCreation') && query.includes('SELECT')) {
        // Ancien comportement trop large : une ligne du même jour existe
        return [{ TempsId: 429 }];
      }
      if (query.includes('INSERT') && query.includes('ABTEMPS_OPERATEURS')) {
        return [{ TempsId: 434 }];
      }
      return [];
    });

    const res = await ConsolidationService.consolidateOperation('865', 'LT2600401', {
      autoFix: true,
      skipSilogValidate: true,
      phase: '010',
      codeRubrique: 'ConnectS',
      db
    });

    expect(res.success).toBe(true);
    expect(res.alreadyExists).toBeFalsy();
    expect(res.tempsId).toBe(434);
    expect(res.warnings || []).not.toContain('Opération déjà consolidée');

    const inserts = db.executeQuery.mock.calls.filter(([q]) =>
      String(q).includes('INSERT') && String(q).includes('ABTEMPS')
    );
    expect(inserts).toHaveLength(1);

    // Ne doit plus interroger / bloquer sur DateCreation seule
    const dateOnlyDupChecks = db.executeQuery.mock.calls.filter(([q]) => {
      const s = String(q);
      return s.includes('DateCreation = @dateCreation')
        && s.includes('SELECT')
        && !s.includes('StartTime');
    });
    expect(dateOnlyDupChecks).toHaveLength(0);
  });

  it('skips only when StartTime already matches (idempotent)', async () => {
    const db = makeDb(async (query) => {
      if (query.includes('ABHISTORIQUE_OPERATEURS')) return cycle2Events;
      if (query.includes('ABTEMPS_OPERATEURS') && query.includes('StartTime = @startTime') && query.includes('SELECT')) {
        return [{ TempsId: 434 }];
      }
      if (query.includes('INSERT') && query.includes('ABTEMPS_OPERATEURS')) {
        return [{ TempsId: 999 }];
      }
      return [];
    });

    const res = await ConsolidationService.consolidateOperation('865', 'LT2600401', {
      autoFix: true,
      skipSilogValidate: true,
      phase: '010',
      codeRubrique: 'ConnectS',
      db
    });

    expect(res.success).toBe(true);
    expect(res.alreadyExists).toBe(true);
    expect(res.tempsId).toBe(434);
    const inserts = db.executeQuery.mock.calls.filter(([q]) =>
      String(q).includes('INSERT') && String(q).includes('ABTEMPS')
    );
    expect(inserts).toHaveLength(0);
  });
});
