const {
    getPauseTypesForOperator,
    isPauseTypeAllowedForOperator,
    usesShortPause10
} = require('../constants/pauseTypes');

describe('pauseTypes catalog', () => {
    const wednesday = new Date('2026-10-28T10:00:00+01:00'); // mercredi
    const friday = new Date('2026-10-30T10:00:00+01:00'); // vendredi

    it('semaine : pause courte 20 min pour un opérateur standard', () => {
        const types = getPauseTypesForOperator({
            operatorCode: '592',
            operatorName: "M'PASSI MADJUKI Edith",
            at: wednesday
        });
        const codes = types.map((t) => t.code);
        expect(codes).toContain('P20_PAYEE');
        expect(codes).not.toContain('P10');
        expect(codes).toEqual(expect.arrayContaining(['DEJ', 'AUTRE', 'FORMATION']));
    });

    it('semaine : Hassan / Joséphine / Maria → pause courte 10 min', () => {
        expect(usesShortPause10({ operatorCode: '929', operatorName: 'Hassane OUHSSAINE', at: wednesday })).toBe(true);
        expect(usesShortPause10({ operatorCode: '528', operatorName: 'HUYGHE Josephine', at: wednesday })).toBe(true);
        expect(usesShortPause10({ operatorCode: '319', operatorName: 'CHESSEBEUF Maria', at: wednesday })).toBe(true);
        expect(usesShortPause10({ operatorName: 'Mariama CONDE', at: wednesday })).toBe(false);

        const types = getPauseTypesForOperator({ operatorCode: '319', operatorName: 'CHESSEBEUF Maria', at: wednesday });
        expect(types.map((t) => t.code)).toContain('P10');
        expect(types.map((t) => t.code)).not.toContain('P20_PAYEE');
    });

    it('vendredi : pause courte 10 min pour tout le monde', () => {
        const types = getPauseTypesForOperator({
            operatorCode: '592',
            operatorName: "M'PASSI MADJUKI Edith",
            at: friday
        });
        expect(types.map((t) => t.code)).toContain('P10');
        expect(types.map((t) => t.code)).not.toContain('P20_PAYEE');
        expect(isPauseTypeAllowedForOperator('P20_PAYEE', { operatorCode: '592', at: friday })).toBe(false);
        expect(isPauseTypeAllowedForOperator('P10', { operatorCode: '592', at: friday })).toBe(true);
        expect(isPauseTypeAllowedForOperator('DEJ', { operatorCode: '592', at: friday })).toBe(true);
    });
});
