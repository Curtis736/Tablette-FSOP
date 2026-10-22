// Routes d'authentification
const express = require('express');
const crypto = require('node:crypto');
const router = express.Router();
const { getAdminCredentials, getRhCredentials, issueToken, revokeToken, verifyToken } = require('../services/adminAuthService');

const BEARER_RE = /^Bearer[ \t]+(\S+)$/i;

function timingSafeEqual(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) {
        // Comparer quand même pour éviter le timing leak sur la longueur
        crypto.timingSafeEqual(ba, ba);
        return false;
    }
    return crypto.timingSafeEqual(ba, bb);
}

// POST /api/auth/login - Connexion admin
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};

        const creds = getAdminCredentials();
        if (!creds.enabled) {
            return res.status(403).json({
                success: false,
                error: 'Accès administrateur désactivé (ADMIN_AUTH_DISABLED=1)'
            });
        }

        if (timingSafeEqual(username, creds.username) && timingSafeEqual(password, creds.password)) {
            const { token, expiresAt } = issueToken(username, { role: 'admin' });
            res.json({
                success: true,
                user: {
                    id: 'admin',
                    username: username,
                    role: 'admin',
                    name: 'Administrateur SEDI'
                },
                token,
                expiresAt,
                message: 'Connexion administrateur réussie'
            });
        } else {
            res.status(401).json({
                success: false,
                error: 'Identifiants invalides'
            });
        }
        
    } catch (error) {
        console.error('Erreur lors de la connexion admin:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
});

// POST /api/auth/logout - Déconnexion admin
router.post('/logout', async (req, res) => {
    try {
        const auth = req.headers.authorization || '';
        const m = BEARER_RE.exec(String(auth));
        const token = m ? m[1].trim() : '';
        if (token) revokeToken(token);
        res.json({
            success: true,
            message: 'Déconnexion réussie'
        });
    } catch (error) {
        console.error('Erreur lors de la déconnexion:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
});

// GET /api/auth/verify - Vérifier la session admin
router.get('/verify', async (req, res) => {
    try {
        const creds = getAdminCredentials();
        if (!creds.enabled) {
            return res.status(403).json({
                success: false,
                error: 'Accès administrateur désactivé (ADMIN_AUTH_DISABLED=1)'
            });
        }

        const auth = req.headers.authorization || '';
        const m = BEARER_RE.exec(String(auth));
        const token = m ? m[1].trim() : '';
        const entry = verifyToken(token);
        if (!entry || entry.role !== 'admin') {
            return res.status(401).json({
                success: false,
                error: 'Session admin invalide'
            });
        }

        res.json({
            success: true,
            user: {
                id: 'admin',
                username: entry.username,
                role: 'admin',
                name: 'Administrateur SEDI'
            }
        });
    } catch (error) {
        console.error('Erreur lors de la vérification:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
});

// GET /api/auth/rh/status — l'interface masque le bouton « Accès RH » si désactivé
router.get('/rh/status', (_req, res) => {
    res.json({ success: true, enabled: getRhCredentials().enabled });
});

// POST /api/auth/rh/login — Connexion RH (accès séparé)
router.post('/rh/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        const creds = getRhCredentials();
        if (!creds.enabled) {
            return res.status(403).json({
                success: false,
                error: 'Accès RH désactivé (ENABLE_RH)'
            });
        }

        if (timingSafeEqual(username, creds.username) && timingSafeEqual(password, creds.password)) {
            const { token, expiresAt } = issueToken(username, { role: 'rh' });
            res.json({
                success: true,
                user: {
                    id: 'rh',
                    username,
                    role: 'rh',
                    name: 'Ressources Humaines'
                },
                token,
                expiresAt,
                message: 'Connexion RH réussie'
            });
        } else {
            res.status(401).json({
                success: false,
                error: 'Identifiants invalides'
            });
        }
    } catch (error) {
        console.error('Erreur lors de la connexion RH:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
});

// POST /api/auth/rh/logout
router.post('/rh/logout', async (req, res) => {
    try {
        const auth = req.headers.authorization || '';
        const m = BEARER_RE.exec(String(auth));
        const token = m ? m[1].trim() : '';
        if (token) revokeToken(token);
        res.json({ success: true, message: 'Déconnexion RH réussie' });
    } catch (error) {
        console.error('Erreur lors de la déconnexion RH:', error);
        res.status(500).json({ success: false, error: 'Erreur interne du serveur' });
    }
});

// GET /api/auth/rh/verify
router.get('/rh/verify', async (req, res) => {
    try {
        const creds = getRhCredentials();
        if (!creds.enabled) {
            return res.status(403).json({
                success: false,
                error: 'Accès RH désactivé (ENABLE_RH)'
            });
        }

        const auth = req.headers.authorization || '';
        const m = BEARER_RE.exec(String(auth));
        const token = m ? m[1].trim() : '';
        const entry = verifyToken(token);
        if (!entry || entry.role !== 'rh') {
            return res.status(401).json({
                success: false,
                error: 'Session RH invalide'
            });
        }

        res.json({
            success: true,
            user: {
                id: 'rh',
                username: entry.username,
                role: 'rh',
                name: 'Ressources Humaines'
            }
        });
    } catch (error) {
        console.error('Erreur lors de la vérification RH:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
});

module.exports = router;
