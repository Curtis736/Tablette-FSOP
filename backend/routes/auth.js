// Routes d'authentification
const express = require('express');
const router = express.Router();
const { getAdminCredentials, issueToken, revokeToken, verifyToken } = require('../services/adminAuthService');

// POST /api/auth/login - Connexion admin
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const creds = getAdminCredentials();
        if (!creds.enabled) {
            return res.status(403).json({
                success: false,
                error: 'Accès administrateur désactivé (ADMIN_AUTH_DISABLED=1)'
            });
        }

        // Vérification des identifiants admin (configurable via env)
        if (username === creds.username && password === creds.password) {
            const { token, expiresAt } = issueToken(username);
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
        const m = String(auth).match(/^Bearer\s+(.+)$/i);
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
        const m = String(auth).match(/^Bearer\s+(.+)$/i);
        const token = m ? m[1].trim() : '';
        const entry = verifyToken(token);
        if (!entry) {
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

module.exports = router;
