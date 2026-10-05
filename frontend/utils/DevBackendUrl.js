/**
 * URL du backend Node en développement local (tablette sur http-server :8080, etc.).
 * Aligné avec backend/server.js : port 3033 si NODE_ENV=development (npm run dev / dev:sandbox).
 *
 * Surcharge optionnelle : localStorage.setItem('sedi_dev_backend_port', '3001')
 *
 * Important : utiliser le MÊME hostname que la page (127.0.0.1 vs localhost),
 * sinon le navigateur bloque en "Failed to fetch" (CORS / private network).
 */
export function resolveLocalDevBackendPort() {
    try {
        const p = String(window.localStorage?.getItem('sedi_dev_backend_port') || '').trim();
        if (p === '3033' || p === '3001') return p;
    } catch (_) {
        /* ignore */
    }
    return '3033';
}

export function getLocalDevApiBase() {
    const host = (typeof window !== 'undefined' && window.location?.hostname)
        ? window.location.hostname
        : '127.0.0.1';
    return `http://${host}:${resolveLocalDevBackendPort()}/api`;
}
