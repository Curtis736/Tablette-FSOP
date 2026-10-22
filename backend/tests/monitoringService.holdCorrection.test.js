import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('MonitoringService.correctRecord et lignes bloquées (A)', () => {
  let db;
  let MonitoringService;
  let nonQuery;

  const loadWithStatus = (statut) => {
    db = require('../config/database');
    vi.spyOn(db, 'executeQuery').mockImplementation(async (sql) => {
      if (sql.includes('SELECT TempsId, StatutTraitement')) {
        return [{ TempsId: 580, StatutTraitement: statut }];
      }
      return [{
        TempsId: 580,
        DateCreation: new Date('2026-10-20T00:00:00.000Z'),
        OperatorCode: '887',
        LancementCode: 'LT2600660',
        Phase: '010',
        CodeRubrique: 'Connect'
      }];
    });
    nonQuery = vi.spyOn(db, 'executeNonQuery').mockResolvedValue({ rowsAffected: 1 });
    // MonitoringService déstructure executeQuery au chargement : recharger après les spies.
    delete require.cache[require.resolve('../services/MonitoringService')];
    MonitoringService = require('../services/MonitoringService');
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[require.resolve('../services/MonitoringService')];
  });

  it('garde une ligne bloquée en A après correction (pas de départ à 20h)', async () => {
    loadWithStatus('A');
    const result = await MonitoringService.correctRecord(580, { ProductiveDuration: 25 });

    expect(result.success).toBe(true);
    const updateSql = nonQuery.mock.calls[0][0];
    expect(updateSql).toContain('ProductiveDuration = @productiveDuration');
    expect(updateSql).not.toContain('StatutTraitement = NULL');
  });

  it('remet une ligne validée (O) à NULL après correction', async () => {
    loadWithStatus('O');
    await MonitoringService.correctRecord(580, { ProductiveDuration: 25 });

    expect(nonQuery.mock.calls[0][0]).toContain('StatutTraitement = NULL');
  });
});
