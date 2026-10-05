/**
 * Cache persistant (localStorage) pour les réponses GET réussies.
 * Permet un mode dégradé lecture seule quand le backend Docker est indisponible.
 *
 * En développement local (localhost:8080, etc.) le cache est désactivé par défaut
 * pour éviter des sessions / données périmées après redémarrage du backend.
 * Forcer : localStorage.setItem('sedi_force_offline_cache','1')
 * Couper partout : localStorage.setItem('sedi_disable_offline_cache','1')
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

export function isOfflineCacheEnabled() {
    try {
        if (window.localStorage?.getItem('sedi_disable_offline_cache') === '1') return false;
        if (window.localStorage?.getItem('sedi_force_offline_cache') === '1') return true;
        const host = window.location?.hostname || '';
        const port = window.location?.port || '';
        const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '';
        const devPorts = new Set(['5173', '4173', '3000', '5174', '8080']);
        if (isLocalHost && (devPorts.has(port) || port === '8080')) return false;
    } catch (_) {
        /* ignore */
    }
    return true;
}

export function buildOfflineCacheKey(endpoint, options = {}) {
    const method = String(options?.method || 'GET').toUpperCase();
    const ep = String(endpoint || '');
    return `${method}:${ep}`;
}

export function readOfflineCache(key, ttlMs = DEFAULT_TTL_MS) {
    if (!isOfflineCacheEnabled()) return null;
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
    if (!isOfflineCacheEnabled()) return;
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

export function isLiveEndpoint(endpoint) {
    const ep = String(endpoint || '').toLowerCase();
    // Ces routes doivent toujours refléter l'état réel (pas de cache offline)
    return ep.includes('/counters')
        || ep.includes('/rh/')
        || ep.includes('/auth/')
        || (ep.includes('/operators/') && (
            ep.includes('/current')
            || ep.includes('/history')
            || ep.includes('/counters')
        ));
}

export function shouldWriteOfflineCache(endpoint) {
    if (!isOfflineCacheEnabled()) return false;
    return !isLiveEndpoint(endpoint);
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
