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

  it('keeps each TempsId as its own line (no merge, no ETEMPS update)', async () => {
    const query = vi.spyOn(db, 'executeQuery');
    const nonQuery = vi.spyOn(db, 'executeNonQuery');

    const result = await MonitoringService.reconcileSameKeyCyclesForSilog([444, 445, 446]);

    expect(result.primaryIds).toEqual([444, 445, 446]);
    expect(result.mergedAwayIds).toEqual([]);
    expect(result.etempsRepaired).toEqual([]);
    expect(result.details[0].mode).toBe('passthrough-distinct-lines');
    expect(query).not.toHaveBeenCalled();
    expect(nonQuery).not.toHaveBeenCalled();
  });

  it('keeps a yesterday correction on the record day, not today', () => {
    const dateCreation = new Date('2026-10-20T00:00:00.000Z');
    expect(MonitoringService._toDateOnly(dateCreation)).toBe('2026-10-20');
    const fromTime = MonitoringService._clockOnRecordDay(dateCreation, '17:25');
    const fromTodayDatetime = MonitoringService._clockOnRecordDay(dateCreation, '2026-10-21T17:25:00');
    expect(fromTime).toEqual({ date: '2026-10-20', hms: '17:25:00' });
    expect(fromTodayDatetime).toEqual({ date: '2026-10-20', hms: '17:25:00' });
  });

  it('reads SQL wall-clock hours in UTC so Paris does not shift 16:55 to 18:55', () => {
    const start = new Date('2026-10-20T16:55:40.000Z');
    const end = MonitoringService._parseTimeParts('17:25');
    const startParts = MonitoringService._wallClockParts(start);
    expect(startParts).toEqual({ hh: 16, mm: 55, ss: 40 });
    expect(MonitoringService._minutesBetweenTimes(startParts, end)).toBe(30);
  });

  it('deduplicates ids and ignores invalid values', async () => {
    const result = await MonitoringService.reconcileSameKeyCyclesForSilog([501, 501, 0, 'x', 502]);
    expect(result.primaryIds).toEqual([501, 502]);
    expect(result.mergedAwayIds).toEqual([]);
  });

  it('never merges two different operators on the same LT', async () => {
    const result = await MonitoringService.reconcileSameKeyCyclesForSilog([601, 602]);
    expect(result.primaryIds).toEqual([601, 602]);
    expect(result.mergedAwayIds).toEqual([]);
  });

  it('returns empty result for an empty list', async () => {
    const result = await MonitoringService.reconcileSameKeyCyclesForSilog([]);
    expect(result).toEqual({
      primaryIds: [],
      mergedAwayIds: [],
      etempsRepaired: [],
      details: []
    });
  });
});
