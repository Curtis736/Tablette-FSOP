import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildOfflineCacheKey,
  readOfflineCache,
  writeOfflineCache,
  clearOfflineApiCache
} from '../../utils/OfflineApiCache.js';

function installMemoryLocalStorage() {
  const store = {};
  global.localStorage = {
    store,
    get length() { return Object.keys(store).length; },
    key(index) { return Object.keys(store)[index] ?? null; },
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    clear() { Object.keys(store).forEach((k) => delete store[k]); }
  };
}

describe('OfflineApiCache', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    clearOfflineApiCache();
  });

  it('builds stable cache keys', () => {
    expect(buildOfflineCacheKey('/fsop/templates')).toBe('GET:/fsop/templates');
    expect(buildOfflineCacheKey('/fsop/lots/LT2500133', { method: 'get' }))
      .toBe('GET:/fsop/lots/LT2500133');
  });

  it('writes and reads cached GET payloads', () => {
    const key = buildOfflineCacheKey('/fsop/templates');
    const payload = { count: 2, templates: [{ code: 'F469' }] };

    writeOfflineCache(key, payload);
    expect(readOfflineCache(key)).toEqual(payload);
  });

  it('expires entries after TTL', () => {
    const key = buildOfflineCacheKey('/fsop/templates');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    writeOfflineCache(key, { ok: true }, 1000);
    expect(readOfflineCache(key, 1000)).toEqual({ ok: true });

    Date.now.mockReturnValue(now + 1001);
    expect(readOfflineCache(key, 1000)).toBeNull();
    vi.restoreAllMocks();
  });

  it('clears all offline cache entries', () => {
    writeOfflineCache('GET:/a', { a: 1 });
    writeOfflineCache('GET:/b', { b: 2 });
    clearOfflineApiCache();
    expect(readOfflineCache('GET:/a')).toBeNull();
    expect(readOfflineCache('GET:/b')).toBeNull();
  });
});
