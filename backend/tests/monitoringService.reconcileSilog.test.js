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
