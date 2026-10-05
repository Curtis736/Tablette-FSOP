import { describe, it, expect, afterEach } from 'vitest';

const { isRhEnabled, getRhCredentials } = require('../services/adminAuthService');

describe('adminAuthService - ENABLE_RH', () => {
    const saved = { ENABLE_RH: process.env.ENABLE_RH, RH_AUTH_DISABLED: process.env.RH_AUTH_DISABLED };

    afterEach(() => {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    });

    it('is disabled when ENABLE_RH is not set', () => {
        delete process.env.ENABLE_RH;
        delete process.env.RH_AUTH_DISABLED;
        expect(isRhEnabled()).toBe(false);
        expect(getRhCredentials().enabled).toBe(false);
    });

    it('is enabled with ENABLE_RH=true', () => {
        process.env.ENABLE_RH = 'true';
        delete process.env.RH_AUTH_DISABLED;
        expect(isRhEnabled()).toBe(true);
    });

    it('RH_AUTH_DISABLED still wins over ENABLE_RH', () => {
        process.env.ENABLE_RH = 'true';
        process.env.RH_AUTH_DISABLED = '1';
        expect(isRhEnabled()).toBe(false);
    });
});
