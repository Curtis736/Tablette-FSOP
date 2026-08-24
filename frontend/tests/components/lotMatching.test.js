import { describe, expect, it } from 'vitest';
import {
    normalizeFsopLotKey,
    matchLotByParenRef,
    collectLotsForVoieCell,
    parseSavedVoies,
    sourceMatchesComponent
} from '../../components/fsopForm/lotMatching.js';

describe('lotMatching', () => {
    it('normalizes keys and matches parenthesis references', () => {
        expect(normalizeFsopLotKey('30632-10 14')).toBe('306321014');
        expect(matchLotByParenRef('30632-10 14', '30632 10 14')).toBe(true);
        expect(matchLotByParenRef('', 'x')).toBe(false);
    });

    it('collects lots from matching lines then items fallback', () => {
        const lines = [{
            codeOperation: 'MO 1',
            codeRubrique: '306321014',
            lots: ['L1', '']
        }];
        const lots = collectLotsForVoieCell(
            lines,
            [],
            ['FB'],
            [{ raw: '30632-10 14' }],
            'Queusot (30632-10 14)',
            'MO 1'
        );
        expect(lots).toEqual(['L1']);
    });

    it('falls back to items then uniqueLots', () => {
        const fromItems = collectLotsForVoieCell(
            [],
            [{ codeRubrique: 'ABC', lots: ['X'] }],
            ['FB'],
            [],
            'ABC',
            ''
        );
        expect(fromItems).toEqual(['X']);
        const fromUnique = collectLotsForVoieCell([], [], ['FB'], [], 'nope', '');
        expect(fromUnique).toEqual(['FB']);
    });

    it('parses saved multi-voie lots', () => {
        const saved = parseSavedVoies('Voie 940 : A\nVoie Ligne : B\nVoie 1310 : C');
        expect(saved).toEqual({ '940': 'A', Ligne: 'B', '1310': 'C' });
        expect(parseSavedVoies('')).toEqual({});
    });

    it('ignores lines with a different operation code', () => {
        const lots = collectLotsForVoieCell(
            [{ codeOperation: 'MO 2', codeRubrique: 'ABC', lots: ['Z'] }],
            [],
            [],
            [],
            'ABC',
            'MO 1'
        );
        expect(lots).toEqual([]);
    });

    it('matches by component text when no parenthesis hints', () => {
        expect(sourceMatchesComponent(
            { codeOperation: 'MO 1', codeRubrique: 'ABC123' },
            [],
            'ABC123',
            'MO 1'
        )).toBe(true);
        expect(sourceMatchesComponent(
            { codeOperation: 'MO 1', codeRubrique: 'ZZZ' },
            [{ raw: 'nope' }],
            'ABC',
            'MO 1'
        )).toBe(false);
    });
});
