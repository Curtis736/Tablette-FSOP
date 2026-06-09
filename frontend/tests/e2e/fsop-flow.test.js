import { describe, it, expect, beforeEach, vi } from 'vitest';
import ApiService from '../../services/ApiService.js';
import {
  buildOfflineCacheKey,
  readOfflineCache,
  writeOfflineCache,
  clearOfflineApiCache
} from '../../utils/OfflineApiCache.js';

describe('FSOP flow (frontend e2e)', () => {
  let service;
  let mockFetch;

  beforeEach(() => {
    clearOfflineApiCache();
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    delete window.location;
    window.location = {
      protocol: 'http:',
      hostname: 'fsop.sedi-ati.com',
      host: 'fsop.sedi-ati.com',
      port: '',
      search: ''
    };

    global.localStorage = {
      store: {},
      getItem(key) { return this.store[key] ?? null; },
      setItem(key, value) { this.store[key] = String(value); },
      removeItem(key) { delete this.store[key]; }
    };

    service = new ApiService();
    service.setCurrentOperatorContext('OP001', 'session-test-1');
  });

  it('loads FSOP templates then lots then structure data (happy path)', async () => {
    const templates = {
      count: 1,
      templates: [{ code: 'F469', designation: 'Test FSOP', processus: 'P1' }]
    };
    const lots = {
      success: true,
      uniqueLots: ['LOT-A'],
      items: [{ CodeLot: 'LOT-A' }]
    };
    const loadData = {
      success: true,
      structure: { sections: [] },
      formData: { placeholders: {} }
    };

    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => templates })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => lots })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => loadData });

    const templatesRes = await service.get('/fsop/templates');
    const lotsRes = await service.getFsopLots('LT2500133');
    const dataRes = await service.loadFsopData('LT2500133', 'F469', '23.199', 'OP001');

    expect(templatesRes.count).toBe(1);
    expect(lotsRes.uniqueLots).toContain('LOT-A');
    expect(dataRes.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('falls back to offline cache for FSOP templates when backend is down', async () => {
    const cached = {
      count: 1,
      templates: [{ code: 'F469', designation: 'Cache', processus: 'P1' }],
      _fromOfflineCache: undefined
    };
    const key = buildOfflineCacheKey('/fsop/templates');
    writeOfflineCache(key, { count: 1, templates: cached.templates });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'BACKEND_UNAVAILABLE' })
    });

    const res = await service.get('/fsop/templates');
    expect(res.count).toBe(1);
    expect(res.templates[0].code).toBe('F469');
    expect(res._fromOfflineCache).toBe(true);
    expect(readOfflineCache(key)).not.toBeNull();
  });

  it('propagates save errors when backend is unavailable (writes not cached)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'BACKEND_UNAVAILABLE', message: 'API down' })
    });

    await expect(service.post('/fsop/save', {
      launchNumber: 'LT2500133',
      templateCode: 'F469',
      serialNumber: '23.199',
      operatorId: 'OP001',
      formData: {}
    })).rejects.toMatchObject({
      errorCode: 'BACKEND_UNAVAILABLE'
    });
  });
});
