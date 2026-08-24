import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { splitSqlBatches, stripSqlBlockComments, isMeaningfulBatch } = require('../utils/sqlBatchUtils');

describe('sqlBatchUtils', () => {
    it('splits GO batches and ignores comments-only batches', () => {
        const sql = `
SELECT 1
GO
-- just a comment
GO
SELECT 2
/* block
   comment */
GO
`;
        const batches = splitSqlBatches(sql);
        const meaningful = batches.filter(isMeaningfulBatch);
        expect(meaningful).toHaveLength(2);
        expect(meaningful[0]).toBe('SELECT 1');
        expect(meaningful[1]).toContain('SELECT 2');
        expect(meaningful.every((b) => !/^--/.test(b.trim()))).toBe(true);
        expect(meaningful.map((b) => stripSqlBlockComments(b.replace(/--[^\n]*$/gm, '')).trim()))
            .toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('strips block comments without regex backtracking', () => {
        expect(stripSqlBlockComments('A /* x */ B')).toBe('A  B');
        expect(stripSqlBlockComments('A /* unterminated')).toBe('A ');
    });
});
