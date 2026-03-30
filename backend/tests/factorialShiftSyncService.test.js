import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let lastClockOutAt = null;

const mockExecuteQuery = vi.fn();
const mockExecuteNonQuery = vi.fn();

vi.mock('../config/database', () => {
  return {
    executeQuery: (...args) => mockExecuteQuery(...args),
    executeNonQuery: (...args) => mockExecuteNonQuery(...args),
  };
});

const FactorialService = require('../services/FactorialService.js');
const FactorialShiftSyncService = require('../services/FactorialShiftSyncService');

describe('FactorialShiftSyncService', () => {
  beforeEach(() => {
    lastClockOutAt = null;
    mockExecuteQuery.mockReset();
    mockExecuteNonQuery.mockReset();

    // Sample shift payloads (heuristic keys)
    const openShift = {
      id: 'SHIFT_1',
      employee_id: 'E1',
      clock_in_at: '2026-03-24T08:00:00+01:00'
      // no clock_out_at in open shifts
    };

    const closedShift = {
      id: 'SHIFT_1',
      employee_id: 'E1',
      clock_in_at: '2026-03-24T08:00:00+01:00',
      clock_out_at: '2026-03-24T16:00:00+01:00'
    };

    vi.spyOn(FactorialService, 'getOpenShifts').mockResolvedValue({ success: true, shifts: [openShift] });
    vi.spyOn(FactorialService, 'getShifts').mockResolvedValue({ success: true, shifts: [closedShift] });

    vi.spyOn(FactorialService, 'hasRequiredConfig').mockReturnValue(true);
    vi.spyOn(FactorialService, 'isEnabled').mockReturnValue(true);

    // Poll state / existence check mocks
    mockExecuteQuery.mockImplementation(function (query, params) {
      if (String(query).includes('FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_POLL_STATE]')) {
        if (!lastClockOutAt) return [];
        const anyEmpId = params ? Object.values(params).find(Boolean) : 'E1';
        return [{
          FactorialEmployeeId: anyEmpId,
          LastProcessedClockInAt: null,
          LastProcessedClockOutAt: lastClockOutAt,
          LastProcessedShiftId: 'SHIFT_1'
        }];
      }

      // Existence check: on la laisse vide, on teste l'idempotence via poll_state (isNewByState)
      if (String(query).includes('FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_CLOCK_EVENTS]')) {
        return [];
      }

      // Query MAX(IN) update - return a valid Date
      if (String(query).includes('SELECT FactorialEmployeeId, MAX(')) {
        const firstEmpKey = Object.keys(params)[0];
        const empId = params[firstEmpKey];
        return [{ FactorialEmployeeId: empId, MaxInAt: new Date('2026-03-24T08:00:00+01:00') }];
      }

      return [];
    });

    mockExecuteNonQuery.mockImplementation(function (query, params) {
      const q = String(query);
      if (q.includes('AB_FACTORIAL_CLOCK_EVENTS') && q.includes('INSERT')) {
        const p = params || {};
        const key = `${p.FactorialEmployeeId}|${p.ShiftId}|${p.EventType}`;
        // no-op: le test d'idempotence passe par poll_state (lastClockOutAt)
        void key;
      }
      return { rowsAffected: 1 };
    });
  });

  it('parses IN and OUT events from shifts', async () => {
    const shift = {
      id: 'SHIFT_X',
      employee_id: 'E99',
      clock_in_at: '2026-03-24T08:00:00+01:00',
      clock_out_at: '2026-03-24T16:00:00+01:00'
    };

    const events = FactorialShiftSyncService._buildEventTypeEventsForShift(shift);
    expect(events).toHaveLength(2);
    const inEvt = events.find(e => e.EventType === 'IN');
    const outEvt = events.find(e => e.EventType === 'OUT');
    expect(inEvt.FactorialEmployeeId).toBe('E99');
    expect(inEvt.ShiftId).toBe('SHIFT_X');
    expect(outEvt.EventAt).toBeInstanceOf(Date);
  });

  it('is idempotent within same sync: deduplicates identical shift events', async () => {
    const factorialEmployeeIds = ['E1'];

    const openShiftDup = {
      id: 'SHIFT_1',
      employee_id: 'E1',
      clock_in_at: '2026-03-24T08:00:00+01:00'
    };

    const closedShiftDup = {
      id: 'SHIFT_1',
      employee_id: 'E1',
      clock_in_at: '2026-03-24T08:00:00+01:00',
      clock_out_at: '2026-03-24T16:00:00+01:00'
    };

    // Deux occurrences identiques côté API => le sync doit produire 1 seule insertion OUT (dédup in-memory)
    FactorialService.getOpenShifts.mockResolvedValue({ success: true, shifts: [openShiftDup, openShiftDup] });
    FactorialService.getShifts.mockResolvedValue({ success: true, shifts: [closedShiftDup, closedShiftDup] });

    const run = await FactorialShiftSyncService.sync({ factorialEmployeeIds, lookbackDays: 2, rawRetentionDays: 30 });
    expect(run.insertedOutEvents).toHaveLength(1);
  });

  it('returns success false when both Factorial API calls fail', async () => {
    FactorialService.getOpenShifts.mockResolvedValue({
      success: false,
      reason: 'timeout',
      error: 'network'
    });
    FactorialService.getShifts.mockResolvedValue({
      success: false,
      reason: 'server_error',
      error: 'timeout'
    });

    const run = await FactorialShiftSyncService.sync({ factorialEmployeeIds: ['E1'], lookbackDays: 2 });
    expect(run.success).toBe(false);
    expect(run.reason).toBe('factorial_api_failed');
    expect(run.apiErrors).toEqual({
      openShifts: 'network',
      shifts: 'timeout'
    });
  });
});

