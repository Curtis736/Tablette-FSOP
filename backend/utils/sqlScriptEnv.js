/**
 * Résout user/password SQL pour les scripts CLI (sans mot de passe en dur).
 * Priorité : config-production.js > variables d'environnement.
 */
function requireEnv(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`Variable d'environnement requise: ${name}`);
    }
    return value;
}

function resolveDbCredentials(productionConfig, { erp = false } = {}) {
    const userKey = erp ? 'DB_ERP_USER' : 'DB_USER';
    const passKey = erp ? 'DB_ERP_PASSWORD' : 'DB_PASSWORD';
    const user = productionConfig?.[userKey] || process.env[userKey];
    const password = productionConfig?.[passKey] || process.env[passKey];
    if (!user || !password) {
        throw new Error(
            `Identifiants SQL requis: définir ${userKey} et ${passKey} (ou config-production.js)`
        );
    }
    return { user, password };
}

function loadProductionConfig() {
    try {
        return require('../config-production');
    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') {
            return null;
        }
        throw error;
    }
}

module.exports = {
    requireEnv,
    resolveDbCredentials,
    loadProductionConfig
};
