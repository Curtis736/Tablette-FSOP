import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DurationCalculationService = require('../services/DurationCalculationService');
const { processLancementEventsWithPauses } = require('../routes/admin');

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

  it('subtracts paired pause time for ERP transfer (DEBUT-PAUSE-REPRISE-FIN)', () => {
    const events = [
      { Ident: 'DEBUT', DateCreation: '2026-03-25T08:00:00.000Z', HeureDebut: '08:00:00', CreatedAt: '2026-03-25T08:00:00.000Z' },
      { Ident: 'PAUSE', DateCreation: '2026-03-25T10:00:00.000Z', HeureDebut: '10:00:00', CreatedAt: '2026-03-25T10:00:00.000Z' },
      { Ident: 'REPRISE', DateCreation: '2026-03-25T10:30:00.000Z', HeureDebut: '10:30:00', CreatedAt: '2026-03-25T10:30:00.000Z' },
      { Ident: 'FIN', DateCreation: '2026-03-25T12:00:00.000Z', HeureFin: '12:00:00', CreatedAt: '2026-03-25T12:00:00.000Z' }
    ];

    const res = DurationCalculationService.calculateDurations(events);

    expect(res.totalDuration).toBe(240);
    expect(res.pauseDuration).toBe(30);
    expect(res.productiveDuration).toBe(210);
  });

  it('handles multiple pause/reprise pairs for productive duration', () => {
    const events = [
      { Ident: 'DEBUT', DateCreation: '2026-03-25T08:00:00.000Z', HeureDebut: '08:00:00' },
      { Ident: 'PAUSE', DateCreation: '2026-03-25T09:00:00.000Z', HeureDebut: '09:00:00' },
      { Ident: 'REPRISE', DateCreation: '2026-03-25T09:15:00.000Z', HeureDebut: '09:15:00' },
      { Ident: 'PAUSE', DateCreation: '2026-03-25T11:00:00.000Z', HeureDebut: '11:00:00' },
      { Ident: 'REPRISE', DateCreation: '2026-03-25T11:20:00.000Z', HeureDebut: '11:20:00' },
      { Ident: 'FIN', DateCreation: '2026-03-25T12:00:00.000Z', HeureFin: '12:00:00' }
    ];

    const res = DurationCalculationService.calculateDurations(events);

    expect(res.totalDuration).toBe(240);
    expect(res.pauseDuration).toBe(35);
    expect(res.productiveDuration).toBe(205);
  });
});

describe('processLancementEventsWithPauses pause rows', () => {
  const baseEvents = [
    {
      NoEnreg: 1,
      Ident: 'DEBUT',
      OperatorCode: 'OP001',
      CodeLanctImprod: 'LT1234567',
      Phase: 'PRODUCTION',
      CodeRubrique: 'OP001',
      HeureDebut: '08:00',
      DateCreation: '2026-03-25',
      CreatedAt: '2026-03-25T08:00:00.000Z',
      operatorName: 'Operateur Test',
      Article: 'Article test'
    },
    {
      NoEnreg: 2,
      Ident: 'PAUSE',
      OperatorCode: 'OP001',
      CodeLanctImprod: 'LT1234567',
      Phase: 'PRODUCTION',
      CodeRubrique: 'OP001',
      HeureDebut: '10:00',
      DateCreation: '2026-03-25',
      CreatedAt: '2026-03-25T10:00:00.000Z',
      operatorName: 'Operateur Test',
      Article: 'Article test'
    },
    {
      NoEnreg: 3,
      Ident: 'REPRISE',
      OperatorCode: 'OP001',
      CodeLanctImprod: 'LT1234567',
      Phase: 'PRODUCTION',
      CodeRubrique: 'OP001',
      HeureDebut: '10:30',
      DateCreation: '2026-03-25',
      CreatedAt: '2026-03-25T10:30:00.000Z',
      operatorName: 'Operateur Test',
      Article: 'Article test'
    },
    {
      NoEnreg: 4,
      Ident: 'FIN',
      OperatorCode: 'OP001',
      CodeLanctImprod: 'LT1234567',
      Phase: 'PRODUCTION',
      CodeRubrique: 'OP001',
      HeureFin: '12:00',
      DateCreation: '2026-03-25',
      CreatedAt: '2026-03-25T12:00:00.000Z',
      operatorName: 'Operateur Test',
      Article: 'Article test'
    }
  ];

  it('does not emit pause rows by default', () => {
    const items = processLancementEventsWithPauses(baseEvents);
    expect(items.filter((item) => item.type === 'pause')).toHaveLength(0);
    expect(items.filter((item) => item.type === 'lancement')).toHaveLength(1);
  });

  it('emits one pause row per PAUSE/REPRISE pair when includePauseRows is true', () => {
    const items = processLancementEventsWithPauses(baseEvents, { includePauseRows: true });
    const pauseRows = items.filter((item) => item._isPauseRow);

    expect(pauseRows).toHaveLength(1);
    expect(pauseRows[0].id).toBe('PAUSE-2');
    expect(pauseRows[0].startTime).toBe('10:00');
    expect(pauseRows[0].endTime).toBe('10:30');
    expect(pauseRows[0].statusCode).toBe('PAUSE_TERMINEE');
    expect(pauseRows[0].editable).toBe(false);
  });
});

describe('processLancementEventsWithPauses work segments (SILOG)', () => {
  const baseEvents = [
    {
      NoEnreg: 1,
      Ident: 'DEBUT',
      OperatorCode: '922',
      CodeLanctImprod: 'LT2500721',
      Phase: '010',
      CodeRubrique: 'CONNECTA',
      HeureDebut: '07:28',
      DateCreation: '2026-07-08',
      CreatedAt: '2026-07-08T07:28:00.000Z',
      operatorName: 'Papy SHOMBE',
      Article: 'Article test'
    },
    {
      NoEnreg: 2,
      Ident: 'PAUSE',
      OperatorCode: '922',
      CodeLanctImprod: 'LT2500721',
      Phase: '010',
      CodeRubrique: 'CONNECTA',
      HeureDebut: '12:00',
      DateCreation: '2026-07-08',
      CreatedAt: '2026-07-08T12:00:00.000Z',
      operatorName: 'Papy SHOMBE',
      Article: 'Article test'
    },
    {
      NoEnreg: 3,
      Ident: 'REPRISE',
      OperatorCode: '922',
      CodeLanctImprod: 'LT2500721',
      Phase: '010',
      CodeRubrique: 'CONNECTA',
      HeureDebut: '12:05',
      DateCreation: '2026-07-08',
      CreatedAt: '2026-07-08T12:05:00.000Z',
      operatorName: 'Papy SHOMBE',
      Article: 'Article test'
    },
    {
      NoEnreg: 4,
      Ident: 'FIN',
      OperatorCode: '922',
      CodeLanctImprod: 'LT2500721',
      Phase: '010',
      CodeRubrique: 'CONNECTA',
      HeureFin: '13:05',
      DateCreation: '2026-07-08',
      CreatedAt: '2026-07-08T13:05:00.000Z',
      operatorName: 'Papy SHOMBE',
      Article: 'Article test'
    }
  ];

  it('emits productive segments instead of full cycle + pause rows', () => {
    const items = processLancementEventsWithPauses(baseEvents, { includeWorkSegments: true });
    expect(items.filter((i) => i._isPauseRow)).toHaveLength(0);
    expect(items.filter((i) => i._isWorkSegment)).toHaveLength(2);
    expect(items[0].startTime).toBe('07:28');
    expect(items[0].endTime).toBe('12:00');
    expect(items[0].statusCode).toBe('TERMINE');
    expect(items[1].startTime).toBe('12:05');
    expect(items[1].endTime).toBe('13:05');
    expect(items[1].statusCode).toBe('TERMINE');
  });

  it('emits open segment when cycle ends on REPRISE without FIN', () => {
    const openEvents = baseEvents.filter((e) => e.Ident !== 'FIN');
    const items = processLancementEventsWithPauses(openEvents, { includeWorkSegments: true });
    expect(items).toHaveLength(2);
    expect(items[1].startTime).toBe('12:05');
    expect(items[1].endTime).toBeNull();
    expect(items[1].statusCode).toBe('EN_COURS');
  });

  it('marks the last segment as "En pause" when operator is currently paused', () => {
    // Cycle qui s'arrête sur une PAUSE non reprise et sans FIN.
    const pausedEvents = baseEvents.filter((e) => e.Ident === 'DEBUT' || e.Ident === 'PAUSE');
    const items = processLancementEventsWithPauses(pausedEvents, { includeWorkSegments: true });
    expect(items.filter((i) => i._isWorkSegment)).toHaveLength(1);
    expect(items[0].startTime).toBe('07:28');
    expect(items[0].endTime).toBe('12:00');
    expect(items[0].statusCode).toBe('EN_PAUSE');
    expect(items[0].status).toBe('En pause');
  });
});
