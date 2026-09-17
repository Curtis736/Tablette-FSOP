import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Garantit que la vue SILOG reste 1 ligne = 1 TempsId (pas d'agrégat par LT/jour).
 * Aligné sur la granularité UI admin.
 */
describe('V_REMONTE_TEMPS granularity', () => {
  it('exposes one row per TempsId with durations (no GROUP BY)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sqlPath = join(here, '../sql/migration_create_vue_remontee_temps.sql');
    const sql = readFileSync(sqlPath, 'utf8');

    expect(sql).toMatch(/CREATE\s+VIEW\s+\[dbo\]\.\[V_REMONTE_TEMPS\]/i);
    expect(sql).toMatch(/TempsId/);
    expect(sql).toMatch(/StartTime/);
    expect(sql).toMatch(/EndTime/);
    expect(sql).toMatch(/ProductiveDuration/);
    expect(sql).toMatch(/TotalDuration/);
    expect(sql).toMatch(/PauseDuration/);
    expect(sql).not.toMatch(/GROUP\s+BY/i);
    expect(sql).toMatch(/StatutTraitement\s*=\s*'O'/);
  });
});
