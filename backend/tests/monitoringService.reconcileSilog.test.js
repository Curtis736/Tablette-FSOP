import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('MonitoringService.reconcileSameKeyCyclesForSilog', () => {
  let db;
  let MonitoringService;

  beforeEach(() => {
    vi.resetModules();
    db = require('../config/database');
    MonitoringService = require('../services/MonitoringService');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates existing ETEMPS duration to sum of same-key cycles', async () => {
    const seeds = [
      {
        TempsId: 444,
        OperatorCode: '009',
        LancementCode: 'LT2601054',
        Phase: '010',
        CodeRubrique: 'Connect',
        StartTime: new Date('2026-09-22T13:51:44'),
        EndTime: new Date('2026-09-22T13:55:57'),
        DateCreation: '2026-09-22',
        StatutTraitement: 'T',
        TotalDuration: 4,
        PauseDuration: 0,
        ProductiveDuration: 4,
        EventsCount: 2
      }
    ];
    const siblings = [
      { ...seeds[0] },
      {
        TempsId: 445,
        OperatorCode: '009',
        LancementCode: 'LT2601054',
        Phase: '010',
        CodeRubrique: 'Connect',
        StartTime: new Date('2026-09-22T14:17:32'),
        EndTime: new Date('2026-09-22T14:35:12'),
        DateCreation: '2026-09-22',
        StatutTraitement: 'T',
        TotalDuration: 18,
        PauseDuration: 0,
        ProductiveDuration: 18,
        EventsCount: 2
      },
      {
        TempsId: 446,
        OperatorCode: '009',
        LancementCode: 'LT2601054',
        Phase: '010',
        CodeRubrique: 'Connect',
        StartTime: new Date('2026-09-22T14:35:21'),
        EndTime: new Date('2026-09-22T15:31:39'),
        DateCreation: '2026-09-22',
        StatutTraitement: 'T',
        TotalDuration: 56,
        PauseDuration: 0,
        ProductiveDuration: 56,
        EventsCount: 2
      }
    ];

    vi.spyOn(db, 'executeQuery').mockImplementation(async (query) => {
      if (String(query).includes('FROM [SEDI_ERP].[dbo].[ETEMPS]')) {
        return [
          {
            NoEnregistrement: 248150,
            DureeExecution: 0.06666667,
            MinutesExecuto: 4,
            VarNumUtil2: 444,
            HeureDebutExecuto: 0,
            MinuteDebutExecuto: 0,
            HeureFinExecuto: 0,
            MinuteFinExecuto: 0
          }
        ];
      }
      if (String(query).includes('ORDER BY t.StartTime')) {
        return siblings;
      }
      return seeds;
    });
    const nonQuery = vi.spyOn(db, 'executeNonQuery').mockResolvedValue({ rowsAffected: 1 });

    const result = await MonitoringService.reconcileSameKeyCyclesForSilog([444, 445, 446]);

    expect(result.etempsRepaired).toEqual([248150]);
    const updateCall = nonQuery.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE [SEDI_ERP].[dbo].[ETEMPS]')
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[1].dureeH).toBeCloseTo(1.3, 5);
    expect(updateCall[1].minutes).toBe(78);
  });

  it('merges pending siblings into one primary when ETEMPS is empty', async () => {
    const row = (id, start, end, mins) => ({
      TempsId: id,
      OperatorCode: '009',
      LancementCode: 'LT2601054',
      Phase: '010',
      CodeRubrique: 'Connect',
      StartTime: new Date(`2026-09-22T${start}`),
      EndTime: new Date(`2026-09-22T${end}`),
      DateCreation: '2026-09-22',
      StatutTraitement: null,
      TotalDuration: mins,
      PauseDuration: 0,
      ProductiveDuration: mins,
      EventsCount: 2
    });
    const siblings = [
      row(501, '10:00:00', '10:10:00', 10),
      row(502, '11:00:00', '11:20:00', 20)
    ];

    vi.spyOn(db, 'executeQuery').mockImplementation(async (query) => {
      if (String(query).includes('FROM [SEDI_ERP].[dbo].[ETEMPS]')) return [];
      if (String(query).includes('ORDER BY t.StartTime')) return siblings;
      return siblings;
    });
    const nonQuery = vi.spyOn(db, 'executeNonQuery').mockResolvedValue({ rowsAffected: 1 });

    const result = await MonitoringService.reconcileSameKeyCyclesForSilog([501, 502]);

    expect(result.primaryIds).toEqual([501]);
    expect(result.mergedAwayIds).toEqual([502]);
    const mergeUpdate = nonQuery.mock.calls.find((c) =>
      String(c[0]).includes('ProductiveDuration = @prod')
    );
    expect(mergeUpdate[1].prod).toBe(30);
    expect(mergeUpdate[1].tempsId).toBe(501);
  });
});
