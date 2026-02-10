 // Middleware d'authentification et d'autorisation
const { executeQuery } = require('../config/database');
const { verifyToken, getAdminCredentials } = require('../services/adminAuthService');

/**
 * Middleware pour vérifier qu'un opérateur est authentifié et actif
 */
async function authenticateOperator(req, res, next) {
    try {
        const { operatorCode } = req.params;
        
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

        // Vérifier s'il y a une session active pour cet opérateur (optionnel)
        const sessionQuery = `
            SELECT TOP 1 SessionId, LoginTime, SessionStatus
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
            WHERE OperatorCode = @operatorCode 
            AND SessionStatus = 'ACTIVE'
            AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        
        const sessions = await executeQuery(sessionQuery, { operatorCode });
        
        // Ajouter les informations de l'opérateur à la requête
        req.operator = {
            code: operators[0].Coderessource,
            name: operators[0].Designation1,
            type: operators[0].Typeressource,
            sessionId: sessions.length > 0 ? sessions[0].SessionId : null,
            hasActiveSession: sessions.length > 0
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

module.exports = {
    authenticateOperator,
    authenticateAdmin
};