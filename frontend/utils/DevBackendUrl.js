/**
 * URL du backend Node en développement local (tablette sur http-server :8080, etc.).
 * Doit rester aligné avec backend/server.js : PORT défaut 3001 ; 3033 si NODE_ENV=development.
 *
 * Surcharge optionnelle : localStorage.setItem('sedi_dev_backend_port', '3033')
 */
export function resolveLocalDevBackendPort() {
    try {
        const p = String(window.localStorage?.getItem('sedi_dev_backend_port') || '').trim();
        if (p === '3033' || p === '3001') return p;
    } catch (_) {
        /* ignore */
    }
    return '3001';
}

export function getLocalDevApiBase() {
    return `http://localhost:${resolveLocalDevBackendPort()}/api`;
}
