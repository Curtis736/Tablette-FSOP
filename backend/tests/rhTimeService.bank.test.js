import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database', () => ({
    executeQuery: vi.fn(),
    executeNonQuery: vi.fn(),
    appDb: '[SEDI_APP_DEV]',
    appDatabaseName: 'SEDI_APP_DEV',
    assertRhWritesAllowed: vi.fn()
}));

vi.mock('../services/PauseTypeService', () => ({
    DAY_TARGET_MINUTES: 525,
    FRIDAY_TARGET_MINUTES: 300,
    targetMinutesForDate: (dateKey) => {
        const d = new Date(`${dateKey}T12:00:00`);
        return d.getDay() === 5 ? 300 : 525;
    }
}));

const RhTimeService = require('../services/RhTimeService');

describe('RhTimeService banque HS', () => {
    it('lun–jeu : surplus au-delà de 8h45 → HS', () => {
        const d = RhTimeService.annotateDayForBank({
            date: '2026-09-15', // mardi
            presenceMinutes: 525 + 30,
            targetMinutes: 525
        });
        expect(d.bankKind).toBe('MON_THU');
        expect(d.bankCreditMinutes).toBe(30);
        expect(d.surplusMinutes).toBe(30);
        expect(d.deficitMinutes).toBe(0);
    });

    it('lun–jeu : sous 8h45 → 0 HS + déficit info', () => {
        const d = RhTimeService.annotateDayForBank({
            date: '2026-09-16', // mercredi
            presenceMinutes: 400,
            targetMinutes: 525
        });
        expect(d.bankCreditMinutes).toBe(0);
        expect(d.deficitMinutes).toBe(125);
    });

    it('lun–jeu : 0 présence → ni déficit ni HS', () => {
        const d = RhTimeService.annotateDayForBank({
            date: '2026-09-16',
            presenceMinutes: 0,
            targetMinutes: 525
        });
        expect(d.bankCreditMinutes).toBe(0);
        expect(d.deficitMinutes).toBe(0);
    });

    it('vendredi : tout le temps fait = HS', () => {
        const d = RhTimeService.annotateDayForBank({
            date: '2026-09-18', // vendredi
            presenceMinutes: 240,
            targetMinutes: 300
        });
        expect(d.bankKind).toBe('FRIDAY_HS');
        expect(d.bankCreditMinutes).toBe(240);
        expect(d.deficitMinutes).toBe(60);
    });

    it('vendredi : 0 présence → 0 HS', () => {
        const d = RhTimeService.annotateDayForBank({
            date: '2026-09-18',
            presenceMinutes: 0,
            targetMinutes: 300
        });
        expect(d.bankCreditMinutes).toBe(0);
        expect(d.deficitMinutes).toBe(0);
    });

    it('sumBankCredits agrège lun–jeu + vendredi', () => {
        const sum = RhTimeService.sumBankCredits([
            { date: '2026-09-15', presenceMinutes: 555, targetMinutes: 525 },
            { date: '2026-09-16', presenceMinutes: 525, targetMinutes: 525 },
            { date: '2026-09-18', presenceMinutes: 300, targetMinutes: 300 }
        ]);
        expect(sum.monThuSurplusMinutes).toBe(30);
        expect(sum.fridayHsMinutes).toBe(300);
        expect(sum.autoBankMinutes).toBe(330);
    });

    it('applyPresenceCorrections applique le delta sur le raw', () => {
        const days = RhTimeService.applyPresenceCorrections(
            [{ date: '2026-09-15', presenceMinutes: 72, rawPresenceMinutes: 72, targetMinutes: 525 }],
            [{ kind: 'DAY_PRESENCE', status: 'VALIDATED', workDate: '2026-09-15', deltaMinutes: 453 }]
        );
        expect(days[0].presenceMinutes).toBe(525);
        expect(days[0].remainingMinutes).toBe(0);
        expect(days[0].correctionMinutes).toBe(453);
        expect(days[0].bankCreditMinutes).toBe(0);
    });

    it('clampDayMinutes borne 0..1440', () => {
        expect(RhTimeService.clampDayMinutes(-5)).toBe(0);
        expect(RhTimeService.clampDayMinutes(2000)).toBe(1440);
        expect(RhTimeService.clampDayMinutes(90.6)).toBe(91);
    });
});
