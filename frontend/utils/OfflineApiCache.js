/**
 * Cache persistant (localStorage) pour les réponses GET réussies.
 * Permet un mode dégradé lecture seule quand le backend Docker est indisponible.
 */
const PREFIX = 'sedi_offline_api_v1_';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function safeStorage() {
    try {
        return window.localStorage;
    } catch (_) {
        return null;
    }
}

export function buildOfflineCacheKey(endpoint, options = {}) {
    const method = String(options?.method || 'GET').toUpperCase();
    const ep = String(endpoint || '');
    return `${method}:${ep}`;
}

export function readOfflineCache(key, ttlMs = DEFAULT_TTL_MS) {
    const storage = safeStorage();
    if (!storage || !key) return null;
    try {
        const raw = storage.getItem(PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.savedAt == null) return null;
        if (Date.now() - parsed.savedAt > ttlMs) {
            storage.removeItem(PREFIX + key);
            return null;
        }
        return parsed.data;
    } catch (_) {
        return null;
    }
}

export function writeOfflineCache(key, data, ttlMs = DEFAULT_TTL_MS) {
    const storage = safeStorage();
    if (!storage || !key || data == null) return;
    try {
        storage.setItem(PREFIX + key, JSON.stringify({
            savedAt: Date.now(),
            ttlMs,
            data
        }));
    } catch (e) {
        console.warn('OfflineApiCache: impossible d\'enregistrer', e?.message || e);
    }
}

export function clearOfflineApiCache() {
    const storage = safeStorage();
    if (!storage) return;
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k) keys.push(k);
    }
    for (const k of keys) {
        if (k.startsWith(PREFIX)) storage.removeItem(k);
    }
}
