/**
 * Middleware pour garantir l'isolation des données par opérateur
 */

const { executeQuery, executeProcedure } = require('../config/database');

class DataIsolationManager {
    constructor() {
        this.operatorCache = new Map();
        this.cacheTimeout = 300000; // 5 minutes
    }

    /**
     * Middleware pour valider que l'opérateur ne peut accéder qu'à ses propres données
     */
    async validateDataAccess(req, res, next) {
        try {
            // Handle case where req.params might be undefined
            const operatorCode = req.params?.operatorCode;
            const requestedOperatorCode = req.query?.operatorCode || req.body?.operatorCode;
            
            // If no operatorCode in params, try to get it from the route path
            if (!operatorCode && req.path) {
                const pathMatch = req.path.match(/\/operators\/(\d+)/);
                if (pathMatch) {
                    req.params = req.params || {};
                    req.params.operatorCode = pathMatch[1];
                }
            }
            
            const finalOperatorCode = req.params?.operatorCode || operatorCode;

            // Si un opérateur demande des données d'un autre opérateur
            if (requestedOperatorCode && requestedOperatorCode !== finalOperatorCode) {
                console.log(`🚨 TENTATIVE D'ACCÈS NON AUTORISÉ: ${finalOperatorCode} essaie d'accéder aux données de ${requestedOperatorCode}`);
                
                return res.status(403).json({
                    success: false,
                    error: 'Accès non autorisé aux données d\'un autre opérateur',
                    security: 'BLOCKED'
                });
            }

            // Vérifier que l'opérateur existe et est actif
            const operator = await this.getOperatorInfo(finalOperatorCode);
            if (!operator) {
                return res.status(404).json({
                    success: false,
                    error: 'Opérateur non trouvé'
                });
            }

            // Ajouter les informations de l'opérateur à la requête
            req.operator = operator;
            req.dataIsolation = {
                allowedOperatorCode: operatorCode,
                timestamp: new Date().toISOString()
            };

            next();

        } catch (error) {
            console.error('❌ Erreur lors de la validation d\'accès:', error);
            console.error('❌ Détails de l\'erreur:', error.message);
            console.error('❌ Stack:', error.stack);
            
            // Distinguer les erreurs de connexion DB des autres erreurs
            if (error.message && (error.message.includes('timeout') || error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT'))) {
                return res.status(503).json({
                    success: false,
                    error: 'Service de base de données temporairement indisponible',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }
            
            res.status(500).json({
                success: false,
                error: 'Erreur de sécurité lors de la validation d\'accès',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Middleware pour filtrer automatiquement les données par opérateur
     */
    async filterDataByOperator(req, res, next) {
        try {
            const { operatorCode } = req.params;
            
            // Ajouter le filtre d'opérateur à toutes les requêtes
            req.dataFilter = {
                operatorCode: operatorCode,
                whereClause: `AND h.OperatorCode = @operatorCode`,
                params: { operatorCode }
            };

            next();

        } catch (error) {
            console.error('❌ Erreur lors du filtrage des données:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur lors du filtrage des données'
            });
        }
    }

    /**
     * Valider qu'un lancement appartient bien à l'opérateur
     */
    async validateLancementOwnership(lancementCode, operatorCode) {
        try {
            const query = `
                SELECT TOP 1 OperatorCode
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE CodeLanctImprod = @lancementCode
                AND OperatorCode = @operatorCode
            `;
            
            const result = await executeQuery(query, { lancementCode, operatorCode });
            
            if (result.length === 0) {
                console.log(`🚨 TENTATIVE D'ACCÈS AU LANCEMENT: ${operatorCode} essaie d'accéder au lancement ${lancementCode} qui ne lui appartient pas`);
                return false;
            }
            
            return true;

        } catch (error) {
            console.error('❌ Erreur lors de la validation de propriété:', error);
            return false;
        }
    }

    /**
     * Obtenir les informations d'un opérateur (avec cache)
     */
    async getOperatorInfo(operatorCode) {
        // Vérifier le cache
        const cached = this.operatorCache.get(operatorCode);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            return cached.data;
        }

        try {
            const query = `
                SELECT 
                    r.Coderessource,
                    r.Designation1,
                    r.Typeressource,
                    s.SessionStatus,
                    s.LoginTime
                FROM [SEDI_ERP].[dbo].[RESSOURC] r
                LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s 
                    ON r.Coderessource = s.OperatorCode 
                    AND s.SessionStatus = 'ACTIVE'
                    AND CAST(s.DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                WHERE r.Coderessource = @operatorCode
            `;
            
            const result = await executeQuery(query, { operatorCode });
            
            if (result.length === 0) {
                return null;
            }

            const operator = {
                code: result[0].Coderessource,
                name: result[0].Designation1,
                type: result[0].Typeressource,
                sessionStatus: result[0].SessionStatus,
                loginTime: result[0].LoginTime,
                isActive: !!result[0].SessionStatus
            };

            // Enregistrer la consultation dans la table de mapping (en arrière-plan)
            try {
                await executeProcedure('sp_RecordOperatorConsultation', { CodeOperateur: operatorCode });
            } catch (error) {
                // Ne pas faire échouer si l'enregistrement de consultation échoue
                console.warn(`⚠️ Erreur enregistrement consultation pour ${operatorCode}:`, error.message);
            }

            // Mettre en cache
            this.operatorCache.set(operatorCode, {
                data: operator,
                timestamp: Date.now()
            });

            return operator;

        } catch (error) {
            console.error('❌ Erreur lors de la récupération de l\'opérateur:', error);
            console.error('❌ Détails:', error.message);
            // Ne pas throw, retourner null pour que le middleware puisse gérer l'erreur
            return null;
        }
    }

    /**
     * Nettoyer le cache
     */
    clearCache() {
        this.operatorCache.clear();
    }

    /**
     * Middleware pour logger les tentatives d'accès
     */
    logAccessAttempt(req, res, next) {
        try {
            // Handle case where req.params might be undefined
            const operatorCode = req.params?.operatorCode;
            const ip = req.ip || req.connection.remoteAddress || 'unknown';
            
            // If no operatorCode in params, try to get it from the route path
            let finalOperatorCode = operatorCode;
            if (!finalOperatorCode && req.path) {
                const pathMatch = req.path.match(/\/operators\/(\d+)/);
                if (pathMatch) {
                    finalOperatorCode = pathMatch[1];
                }
            }
            
            const userAgent = req.get('User-Agent');
            
            console.log(`🔍 Accès aux données - Opérateur: ${finalOperatorCode || 'unknown'}, IP: ${ip}, Endpoint: ${req.path}`);
            
            // Log détaillé pour les tentatives suspectes
            if (req.query?.operatorCode && req.query.operatorCode !== finalOperatorCode) {
                console.log(`🚨 TENTATIVE SUSPECTE - Opérateur ${finalOperatorCode} demande les données de ${req.query.operatorCode}`);
            }
            
            next();
        } catch (error) {
            console.error('❌ Erreur lors du log d\'accès:', error);
            next(); // Continue even if logging fails
        }
    }
}

const dataIsolationManager = new DataIsolationManager();

module.exports = {
    validateDataAccess: dataIsolationManager.validateDataAccess.bind(dataIsolationManager),
    filterDataByOperator: dataIsolationManager.filterDataByOperator.bind(dataIsolationManager),
    validateLancementOwnership: dataIsolationManager.validateLancementOwnership.bind(dataIsolationManager),
    getOperatorInfo: dataIsolationManager.getOperatorInfo.bind(dataIsolationManager),
    clearCache: dataIsolationManager.clearCache.bind(dataIsolationManager),
    logAccessAttempt: dataIsolationManager.logAccessAttempt.bind(dataIsolationManager)
};
