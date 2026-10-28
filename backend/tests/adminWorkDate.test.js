import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeAdminWorkDate } = require('../routes/admin');

describe('normalizeAdminWorkDate', () => {
  it('accepte une date passee et aujourd hui', () => {
    expect(normalizeAdminWorkDate('2020-01-15')).toBe('2020-01-15');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(normalizeAdminWorkDate(today)).toBe(today);
  });

  it('refuse une date future ou un format invalide', () => {
    expect(normalizeAdminWorkDate('2999-01-01')).toBe(false);
    expect(normalizeAdminWorkDate('27/10/2026')).toBe(false);
    expect(normalizeAdminWorkDate('2026-02-31')).toBe(false);
  });

  it('laisse vide quand aucune date n est fournie', () => {
    expect(normalizeAdminWorkDate('')).toBe(null);
    expect(normalizeAdminWorkDate(null)).toBe(null);
  });
});
