import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { operatorCodeFromRequest } = require('../middleware/dataIsolation');

describe('operatorCodeFromRequest', () => {
    it('reads params then path', () => {
        expect(operatorCodeFromRequest({ params: { operatorCode: '12' } })).toBe('12');
        const req = { params: {}, path: '/operators/99/session' };
        expect(operatorCodeFromRequest(req)).toBe('99');
        expect(req.params.operatorCode).toBe('99');
        expect(operatorCodeFromRequest({ path: '/other' })).toBeUndefined();
    });
});
