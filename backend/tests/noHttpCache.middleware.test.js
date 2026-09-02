import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { noHttpCacheDefaults } = require('../middleware/noHttpCache.js');

describe('noHttpCacheDefaults', () => {
  it('applique no-store sur /api/*', () => {
    const headers = {};
    const res = { setHeader: (k, v) => { headers[k] = v; } };
    const next = vi.fn();
    noHttpCacheDefaults({ path: '/api/health' }, res, next);
    expect(headers['Cache-Control']).toContain('no-store');
    expect(headers['Pragma']).toBe('no-cache');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('applique sur / et /metrics', () => {
    for (const path of ['/', '/metrics']) {
      const headers = {};
      const res = { setHeader: (k, v) => { headers[k] = v; } };
      noHttpCacheDefaults({ path }, res, vi.fn());
      expect(headers['Cache-Control']).toContain('no-store');
    }
  });

  it('does not set headers for arbitrary static paths', () => {
    const headers = {};
    const res = { setHeader: (k, v) => { headers[k] = v; } };
    noHttpCacheDefaults({ path: '/favicon.ico' }, res, vi.fn());
    expect(headers['Cache-Control']).toBeUndefined();
  });
});
