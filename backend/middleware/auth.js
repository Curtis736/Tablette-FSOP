 // Middleware d'authentification et d'autorisation
const { executeQuery } = require('../config/database');
const { verifyToken, getAdminCredentials } = require('../services/adminAuthService');
const SessionService = require('../services/SessionService');

/**
 * Middleware pour vérifier qu'un opérateur est authentifié et actif
 */
async function authenticateOperator(req, res, next) {
    try {
        const { operatorCode } = req.params;
        const sessionIdHeader = String(req.headers['x-operator-session-id'] || '').trim();
        const deviceIdHeader = String(req.headers['x-device-id'] || '').trim();
        
        if (!operatorCode) {
            return res.status(400).json({
                success: false,
                error: 'Code opérateur requis'
            });
        }

        // Vérifier que l'opérateur existe et est valide
        const operatorQuery = `
            SELECT TOP 1
                Typeressource,
                Coderessource,
                Designation1
            FROM [SEDI_ERP].[dbo].[RESSOURC]
            WHERE Coderessource = @operatorCode
        `;
        
        const operators = await executeQuery(operatorQuery, { operatorCode });
        
        if (operators.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Opérateur non trouvé'
            });
        }

        // Vérifier s'il y a une session active (TTL glissant via SessionService)
        // NOTE: Ne pas filtrer par "aujourd'hui" (sinon cassé après minuit).
        const activeSession = await SessionService.getActiveSession(operatorCode);
        if (!activeSession) {
            return res.status(401).json({
                success: false,
                error: 'SESSION_REQUIRED',
                security: 'SESSION_REQUIRED',
                message: 'Opérateur non connecté ou session expirée'
            });
        }
        if (!sessionIdHeader) {
            return res.status(401).json({
                success: false,
                error: 'SESSION_CONTEXT_REQUIRED',
                security: 'SESSION_CONTEXT_REQUIRED',
                message: 'Contexte de session manquant, reconnectez-vous.'
            });
        }
        if (String(activeSession.SessionId) !== sessionIdHeader) {
            return res.status(401).json({
                success: false,
                error: 'SESSION_MISMATCH',
                security: 'SESSION_MISMATCH',
                message: 'Session invalide pour cet opérateur.'
            });
        }
        const sessionDeviceId = String(activeSession.DeviceId || '').trim();
        if (sessionDeviceId && sessionDeviceId !== deviceIdHeader) {
            return res.status(401).json({
                success: false,
                error: 'DEVICE_MISMATCH',
                security: 'DEVICE_MISMATCH',
                message: 'Session invalide pour cet appareil.'
            });
        }
        
        // Ajouter les informations de l'opérateur à la requête
        req.operator = {
            code: operators[0].Coderessource,
            name: operators[0].Designation1,
            type: operators[0].Typeressource,
            sessionId: activeSession.SessionId,
            deviceId: sessionDeviceId || null,
            hasActiveSession: true
        };

        next();
        
    } catch (error) {
        console.error('Erreur lors de l\'authentification opérateur:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
}

/**
 * Middleware pour vérifier qu'un utilisateur est administrateur
 */
async function authenticateAdmin(req, res, next) {
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
                error: 'Accès administrateur requis'
            });
        }

        req.admin = {
            id: 'admin',
            username: entry.username,
            role: 'admin'
        };
        next();
        
    } catch (error) {
        console.error('Erreur lors de l\'authentification admin:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur'
        });
    }
}

/**
 * Middleware qui bloque une route dangereuse (debug/purge/reset) si la variable
 * d'environnement correspondante n'est pas explicitement activée.
 *
 * Usage: router.post('/testing/purge', requireDangerousRoute('ALLOW_TEST_PURGE'), handler)
 *
 * En production, ces variables doivent être absentes ou à 'false' dans le .env.
 */
function requireDangerousRoute(envVar) {
    return (req, res, next) => {
        if (String(process.env[envVar] || '').toLowerCase() !== 'true') {
            return res.status(403).json({
                success: false,
                error: 'ROUTE_DISABLED',
                message: `Cette route est désactivée en production. Définissez ${envVar}=true pour l'activer.`
            });
        }
        next();
    };
}

/**
 * Middleware qui bloque toutes les routes /debug/* en production.
 * Activé par défaut sauf si ALLOW_DEBUG_ROUTES=true.
 */
function requireDebugMode(req, res, next) {
    if (String(process.env.ALLOW_DEBUG_ROUTES || '').toLowerCase() !== 'true') {
        return res.status(403).json({
            success: false,
            error: 'DEBUG_ROUTES_DISABLED',
            message: 'Les routes de débogage sont désactivées. Définissez ALLOW_DEBUG_ROUTES=true pour les activer.'
        });
    }
    next();
}

module.exports = {
    authenticateOperator,
    authenticateAdmin,
    requireDangerousRoute,
    requireDebugMode
};