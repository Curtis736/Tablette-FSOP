import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DurationCalculationService = require('../services/DurationCalculationService');

describe('DurationCalculationService', () => {
  it('caps open pause at FIN when operation is finished', () => {
    const events = [
      { Ident: 'DEBUT', DateCreation: '2026-03-25T08:00:00.000Z', HeureDebut: '08:00:00' },
      { Ident: 'PAUSE', DateCreation: '2026-03-25T09:00:00.000Z', HeureDebut: '09:00:00' },
      // No REPRISE
      { Ident: 'FIN', DateCreation: '2026-03-25T10:00:00.000Z', HeureFin: '10:00:00' }
    ];

    const res = DurationCalculationService.calculateDurations(events);

    // Total: 2h = 120min. Pause ouverte: 1h (09->10) = 60min.
    expect(res.totalDuration).toBe(120);
    expect(res.pauseDuration).toBe(60);
    expect(res.productiveDuration).toBe(60);
  });
});

