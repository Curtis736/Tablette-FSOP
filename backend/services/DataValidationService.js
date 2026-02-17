// Service de validation des données pour éviter les mélanges
const { executeQuery } = require('../config/database');

class DataValidationService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 60000; // 1 minute
    }

    /**
     * Valider qu'un opérateur est bien associé à un lancement
     */
    async validateOperatorLancementAssociation(operatorCode, lancementCode) {
        try {
            const cacheKey = `${operatorCode}-${lancementCode}`;
            const cached = this.cache.get(cacheKey);
            
            if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
                return cached.result;
            }

            // Vérifier que l'opérateur existe dans RESSOURC
            const operatorQuery = `
                SELECT TOP 1 Coderessource, Designation1, Typeressource
                FROM [SEDI_ERP].[dbo].[RESSOURC]
                WHERE Coderessource = @operatorCode
            `;
            
            const operatorResult = await executeQuery(operatorQuery, { operatorCode });
            
            if (operatorResult.length === 0) {
                const result = { valid: false, error: 'Opérateur non trouvé' };
                this.cache.set(cacheKey, { result, timestamp: Date.now() });
                return result;
            }

            // Vérifier que le lancement existe dans LCTE
            const lancementQuery = `
                SELECT TOP 1 CodeLancement, DesignationLct1, Statut
                FROM [SEDI_ERP].[dbo].[LCTE]
                WHERE CodeLancement = @lancementCode
            `;
            
            const lancementResult = await executeQuery(lancementQuery, { lancementCode });
            
            if (lancementResult.length === 0) {
                const result = { valid: false, error: 'Lancement non trouvé' };
                this.cache.set(cacheKey, { result, timestamp: Date.now() });
                return result;
            }

            // ✅ AUTORISATION : Plusieurs opérateurs peuvent travailler sur le même lancement simultanément
            // La vérification de conflit a été désactivée pour permettre la collaboration multi-opérateurs
            // Ancienne vérification commentée :
            /*
            const conflictQuery = `
                SELECT TOP 1 OperatorCode, Statut, DateCreation
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE CodeLanctImprod = @lancementCode
                AND Statut IN ('EN_COURS', 'EN_PAUSE')
                AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                AND OperatorCode != @operatorCode
            `;
            
            const conflictResult = await executeQuery(conflictQuery, { lancementCode, operatorCode });
            
            if (conflictResult.length > 0) {
                const result = { 
                    valid: false, 
                    error: `Conflit détecté: le lancement ${lancementCode} est déjà en cours par l'opérateur ${conflictResult[0].OperatorCode}`,
                    conflict: conflictResult[0]
                };
                this.cache.set(cacheKey, { result, timestamp: Date.now() });
                return result;
            }
            */

            const result = { 
                valid: true, 
                operator: operatorResult[0], 
                lancement: lancementResult[0] 
            };
            this.cache.set(cacheKey, { result, timestamp: Date.now() });
            return result;

        } catch (error) {
            console.error('❌ Erreur lors de la validation:', error);
            return { valid: false, error: 'Erreur de validation' };
        }
    }

    /**
     * Récupérer les données d'un opérateur avec validation stricte
     */
    async getOperatorDataSecurely(operatorCode) {
        try {
            // Vérifier que l'opérateur existe
            const operatorQuery = `
                SELECT TOP 1 Coderessource, Designation1, Typeressource
                FROM [SEDI_ERP].[dbo].[RESSOURC]
                WHERE Coderessource = @operatorCode
            `;
            
            const operatorResult = await executeQuery(operatorQuery, { operatorCode });
            
            if (operatorResult.length === 0) {
                return { valid: false, error: 'Opérateur non trouvé' };
            }

            // Récupérer UNIQUEMENT les événements de cet opérateur
            // IMPORTANT: Convertir HeureDebut et HeureFin en VARCHAR(5) (HH:mm) directement dans SQL
            // pour éviter les problèmes de timezone lors de la conversion par Node.js
            const eventsQuery = `
                SELECT 
                    h.NoEnreg,
                    h.Ident,
                    h.CodeLanctImprod,
                    h.Phase,
                    h.OperatorCode,
                    h.CodeRubrique,
                    h.Statut,
                    CONVERT(VARCHAR(5), h.HeureDebut, 108) AS HeureDebut,
                    CONVERT(VARCHAR(5), h.HeureFin, 108) AS HeureFin,
                    -- IMPORTANT: Date-only stable (évite les décalages de fuseau côté Node/moment)
                    CONVERT(VARCHAR(10), h.DateCreation, 23) AS DateCreation, -- YYYY-MM-DD
                    h.CreatedAt,
                    l.DesignationLct1 as Article,
                    l.DesignationLct2 as ArticleDetail
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
                LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l ON l.CodeLancement = h.CodeLanctImprod
                WHERE h.OperatorCode = @operatorCode
                ORDER BY h.DateCreation DESC, h.NoEnreg DESC
            `;
            
            const events = await executeQuery(eventsQuery, { operatorCode });
            
            return {
                valid: true,
                operator: operatorResult[0],
                events: events
            };

        } catch (error) {
            console.error('❌ Erreur lors de la récupération sécurisée:', error);
            return { valid: false, error: 'Erreur de récupération' };
        }
    }

    /**
     * Récupérer les données admin avec validation stricte
     */
    async getAdminDataSecurely(date = null) {
        try {
            // ⚡ Perf: si une date est fournie, filtrer en SQL (sinon, on scanne tout l'historique et on risque un 504).
            // Le frontend admin travaille quasi exclusivement "par jour" (param ?date=YYYY-MM-DD).
            const targetDate = date ? String(date).trim() : null;

            // Récupérer TOUS les événements avec validation stricte
            // IMPORTANT: Convertir HeureDebut et HeureFin en VARCHAR(5) (HH:mm) directement dans SQL
            // pour éviter les problèmes de timezone lors de la conversion par Node.js
            const eventsQuery = `
                SELECT 
                    h.NoEnreg,
                    h.Ident,
                    h.CodeLanctImprod,
                    h.Phase,
                    h.OperatorCode,
                    h.CodeRubrique,
                    h.Statut,
                    CONVERT(VARCHAR(5), h.HeureDebut, 108) AS HeureDebut,
                    CONVERT(VARCHAR(5), h.HeureFin, 108) AS HeureFin,
                    -- IMPORTANT: Date-only stable (évite les décalages de fuseau côté Node/moment)
                    CONVERT(VARCHAR(10), h.DateCreation, 23) AS DateCreation, -- YYYY-MM-DD
                    h.CreatedAt,
                    COALESCE(r.Designation1, 'Opérateur ' + CAST(h.OperatorCode AS VARCHAR)) as operatorName,
                    r.Coderessource as resourceCode,
                    l.DesignationLct1 as Article,
                    l.DesignationLct2 as ArticleDetail,
                    -- Validation stricte de l'association
                    CASE 
                        WHEN r.Coderessource = h.OperatorCode THEN 'VALID'
                        WHEN r.Coderessource IS NULL THEN 'NO_RESOURCE'
                        ELSE 'INVALID_ASSOCIATION'
                    END as associationStatus
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h WITH (NOLOCK)
                LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r WITH (NOLOCK) ON h.OperatorCode = r.Coderessource
                LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l WITH (NOLOCK) ON l.CodeLancement = h.CodeLanctImprod
                WHERE h.OperatorCode IS NOT NULL 
                    AND h.OperatorCode != ''
                    AND h.OperatorCode != '0'
                    ${
                        targetDate
                            ? "AND h.DateCreation >= @date AND h.DateCreation < DATEADD(day, 1, @date)"
                            : ''
                    }
                ORDER BY h.DateCreation DESC
            `;
            
            const allEvents = await executeQuery(eventsQuery, targetDate ? { date: targetDate } : {});
            
            // Filtrer les associations invalides
            const validEvents = allEvents.filter(event => 
                event.associationStatus === 'VALID' || event.associationStatus === 'NO_RESOURCE'
            );
            
            const invalidEvents = allEvents.filter(event => 
                event.associationStatus === 'INVALID_ASSOCIATION'
            );
            
            if (invalidEvents.length > 0) {
                console.log(`🚨 ${invalidEvents.length} événements avec associations invalides détectés:`, 
                    invalidEvents.map(e => `${e.OperatorCode} -> ${e.resourceCode}`));
            }
            
            return {
                valid: true,
                events: validEvents,
                invalidEvents: invalidEvents,
                totalEvents: allEvents.length,
                validEvents: validEvents.length
            };

        } catch (error) {
            console.error('❌ Erreur lors de la récupération admin sécurisée:', error);
            return { valid: false, error: 'Erreur de récupération admin' };
        }
    }

    /**
     * Nettoyer le cache
     */
    clearCache() {
        this.cache.clear();
        console.log('🧹 Cache de validation nettoyé');
    }
}

module.exports = new DataValidationService();
