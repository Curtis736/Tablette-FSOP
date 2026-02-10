const crypto = require('crypto');

// Auth admin ultra-simple (sans dépendance) basé sur un token en mémoire.
// - Utilise ADMIN_USERNAME / ADMIN_PASSWORD pour le login
// - Émet un token aléatoire (Bearer) stocké côté serveur avec expiration
// - ⚠️ Les tokens sont perdus si le serveur redémarre (acceptable pour une tablette / usage interne)

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12h

const tokens = new Map(); // token -> { username, expiresAt }

function getAdminCredentials() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = (process.env.ADMIN_PASSWORD && String(process.env.ADMIN_PASSWORD).trim() !== '')
    ? process.env.ADMIN_PASSWORD
    : 'admin';

  // ⚠️ Demande métier: toujours autoriser un fallback admin/admin (même en production)
  return { enabled: true, username, password };
}

function issueToken(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttlMs = Number.parseInt(process.env.ADMIN_TOKEN_TTL_MS || '', 10);
  const expiresAt = Date.now() + (Number.isFinite(ttlMs) ? ttlMs : DEFAULT_TTL_MS);
  tokens.set(token, { username, expiresAt });
  return { token, expiresAt };
}

function revokeToken(token) {
  if (!token) return false;
  return tokens.delete(token);
}

function verifyToken(token) {
  if (!token) return null;
  const entry = tokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return null;
  }
  return entry;
}

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, entry] of tokens.entries()) {
    if (now > entry.expiresAt) tokens.delete(token);
  }
}

module.exports = {
  getAdminCredentials,
  issueToken,
  revokeToken,
  verifyToken,
  cleanupExpiredTokens,
};

