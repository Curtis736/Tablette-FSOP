/**
 * Politique HTTP par défaut : pas de mise en cache des réponses dynamiques (API, racine JSON, métriques).
 * Évite les états périmés (304, cache mandataire) sur tablettes / navigateurs.
 */
function noHttpCacheDefaults(req, res, next) {
    const p = req.path || '';
    if (p.startsWith('/api') || p === '/' || p === '/metrics') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
}

module.exports = { noHttpCacheDefaults };
