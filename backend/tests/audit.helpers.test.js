import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    resolveAuditAction,
    resolveAuditSeverity,
    buildAuditPayload
} = require('../middleware/audit');

describe('audit helpers', () => {
    it('maps endpoints and status codes', () => {
        expect(resolveAuditAction('/api/operators/login')).toBe('OperatorLogin');
        expect(resolveAuditAction('/api/operators/logout')).toBe('OperatorLogout');
        expect(resolveAuditAction('/lancement/start')).toBe('StartLancement');
        expect(resolveAuditAction('/lancement/pause')).toBe('PauseLancement');
        expect(resolveAuditAction('/lancement/resume')).toBe('ResumeLancement');
        expect(resolveAuditAction('/lancement/stop')).toBe('StopLancement');
        expect(resolveAuditAction('/heartbeat')).toBe('Heartbeat');
        expect(resolveAuditAction('/other')).toBe('HttpRequest');
        expect(resolveAuditSeverity(500)).toBe('ERROR');
        expect(resolveAuditSeverity(404)).toBe('WARNING');
        expect(resolveAuditSeverity(200)).toBe('INFO');
    });

    it('builds a sanitized payload and drops oversized JSON', () => {
        const small = buildAuditPayload({
            body: { password: 'secret', token: 't', name: 'bob', nested: { a: 1 } },
            query: { q: '1' },
            params: { id: '9' }
        });
        const parsed = JSON.parse(small);
        expect(parsed.body.password).toBeUndefined();
        expect(parsed.body.token).toBeUndefined();
        expect(parsed.body.name).toBe('bob');
        expect(parsed.body.nested).toBeUndefined();
        expect(parsed.query).toEqual({ q: '1' });

        const hugeQuery = { blob: 'x'.repeat(9000) };
        expect(buildAuditPayload({ body: null, query: hugeQuery, params: {} })).toBeNull();
    });
});
