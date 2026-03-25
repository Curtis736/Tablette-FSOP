import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axios = require('axios');
const FactorialService = require('../services/factorialService');

describe('FactorialService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.FACTORIAL_API_BASE_URL = 'https://api.factorialhr.com';
    process.env.FACTORIAL_API_TOKEN = 'token-test';
    process.env.FACTORIAL_STATUS_ENDPOINT_TEMPLATE = '/employees/{operatorId}/attendance?date={date}';
    process.env.FACTORIAL_API_TIMEOUT_MS = '5000';
  });

  it('builds URL from template placeholders', () => {
    const url = FactorialService._buildStatusUrl('OP-001', '2026-03-24');
    expect(url).toBe('https://api.factorialhr.com/employees/OP-001/attendance?date=2026-03-24');
  });

  it('returns depointed=true for explicit clocked_out payload', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: { clocked_out: true } });
    const result = await FactorialService.getOperatorDepointedStatus('OP-001', '2026-03-24');
    expect(result.success).toBe(true);
    expect(result.depointed).toBe(true);
    expect(result.reason).toBe('ok');
  });

  it('extracts nested array payload and parses status', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: { data: [{ status: 'clocked_in' }] } });
    const result = await FactorialService.getOperatorDepointedStatus('OP-001', '2026-03-24');
    expect(result.success).toBe(true);
    expect(result.depointed).toBe(false);
  });

  it('returns request_failed when API call throws', async () => {
    vi.spyOn(axios, 'get').mockRejectedValueOnce(new Error('network down'));
    const result = await FactorialService.getOperatorDepointedStatus('OP-001', '2026-03-24');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('request_failed');
    expect(result.skipped).toBe(true);
  });
});
