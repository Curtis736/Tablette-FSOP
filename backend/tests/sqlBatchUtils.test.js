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
        expect(batches.filter(isMeaningfulBatch)).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('strips block comments without regex backtracking', () => {
        expect(stripSqlBlockComments('A /* x */ B')).toBe('A  B');
        expect(stripSqlBlockComments('A /* unterminated')).toBe('A ');
    });
});
