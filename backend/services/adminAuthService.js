const crypto = require('crypto');

// Auth admin basé sur des tokens HMAC-SHA256 signés.
// - Utilise ADMIN_USERNAME / ADMIN_PASSWORD pour le login
// - Émet un token signé (payload + signature) avec expiration
// - Les tokens survivent aux redémarrages car vérifiables via la clé secrète JWT_SECRET
// - Révocation possible via une liste noire en mémoire (tokens révoqués explicitement)

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12h

// Liste noire des tokens révoqués explicitement (logout)
// Taille limitée : nettoyée périodiquement
const revokedTokens = new Set();

let _cachedFallbackSecret = null;
function getSecret() {
    const s = process.env.JWT_SECRET || process.env.SESSION_SECRET || '';
    if (!s || s === 'change-me-in-production') {
        console.warn('⚠️ JWT_SECRET non défini ou valeur par défaut — définissez JWT_SECRET dans .env');
        if (!_cachedFallbackSecret) {
            _cachedFallbackSecret = crypto.randomBytes(32).toString('hex');
        }
        return _cachedFallbackSecret;
    }
    return s;
}

function getAdminCredentials() {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = (process.env.ADMIN_PASSWORD && String(process.env.ADMIN_PASSWORD).trim() !== '')
        ? process.env.ADMIN_PASSWORD
        : 'admin';

    const disabledRaw = String(process.env.ADMIN_AUTH_DISABLED || '').trim().toLowerCase();
    const enabled = !(disabledRaw === '1' || disabledRaw === 'true' || disabledRaw === 'yes');
    return { enabled, username, password };
}

function signPayload(payload) {
    const data = JSON.stringify(payload);
    const b64 = Buffer.from(data).toString('base64url');
    const sig = crypto.createHmac('sha256', getSecret()).update(b64).digest('base64url');
    return `${b64}.${sig}`;
}

function verifyPayload(token) {
    if (!token || typeof token !== 'string') return null;
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const b64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', getSecret()).update(b64).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    try {
        return JSON.parse(Buffer.from(b64, 'base64url').toString());
    } catch (_) {
        return null;
    }
}

function issueToken(username) {
    const ttlMs = Number.parseInt(process.env.ADMIN_TOKEN_TTL_MS || '', 10);
    const expiresAt = Date.now() + (Number.isFinite(ttlMs) ? ttlMs : DEFAULT_TTL_MS);
    const jti = crypto.randomBytes(16).toString('hex'); // identifiant unique pour révocation
    const token = signPayload({ username, expiresAt, jti });
    return { token, expiresAt };
}

function revokeToken(token) {
    if (!token) return false;
    const payload = verifyPayload(token);
    if (!payload) return false;
    revokedTokens.add(payload.jti);
    return true;
}

function verifyToken(token) {
    const payload = verifyPayload(token);
    if (!payload) return null;
    if (Date.now() > payload.expiresAt) return null;
    if (revokedTokens.has(payload.jti)) return null;
    return { username: payload.username, expiresAt: payload.expiresAt };
}

function cleanupExpiredTokens() {
    if (revokedTokens.size > 1000) {
        const now = Date.now();
        for (const jti of revokedTokens) {
            if (typeof jti === 'string' && revokedTokens.size > 500) {
                revokedTokens.delete(jti);
            }
        }
        if (revokedTokens.size > 1000) revokedTokens.clear();
    }
}

module.exports = {
    getAdminCredentials,
    issueToken,
    revokeToken,
    verifyToken,
    cleanupExpiredTokens,
};
