import { describe, expect, it } from 'vitest';
import {
    normalizeFsopLotKey,
    matchLotByParenRef,
    collectLotsForVoieCell,
    collectLotsForLotCell,
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

    it('falls back to items then empty (no uniqueLots dump)', () => {
        const fromItems = collectLotsForVoieCell(
            [],
            [{ codeRubrique: 'ABC', lots: ['X'] }],
            ['FB'],
            [],
            'ABC',
            ''
        );
        expect(fromItems).toEqual(['X']);
        const noMatch = collectLotsForVoieCell([], [], ['FB'], [], 'nope', '');
        expect(noMatch).toEqual([]);
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

    it('collectLotsForLotCell returns empty when no article match (no LT-wide dump)', () => {
        const lots = collectLotsForLotCell(
            [],
            [{ codeRubrique: 'OTHER', lots: ['Z'] }],
            ['LOT-A', 'LOT-B'],
            [{ raw: 'NOPE' }],
            'Composant inconnu (NOPE)',
            'MO X'
        );
        expect(lots).toEqual([]);
    });

    it('collectLotsForLotCell returns only lots matched to the article', () => {
        const lots = collectLotsForLotCell(
            [{ codeOperation: 'MO 1', codeRubrique: 'ABC', lots: ['L1', 'L2'] }],
            [],
            ['FB1', 'FB2'],
            [],
            'Piece ABC',
            'MO 1'
        );
        expect(lots).toEqual(['L1', 'L2']);
    });
});
