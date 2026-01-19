/**
 * Service de consolidation robuste avec gestion transactionnelle
 * Gère la consolidation des opérations avec validation, détection de doublons et gestion de conflits
 */

const { executeQuery, executeNonQuery, getConnection } = require('../config/database');
const OperationValidationService = require('./OperationValidationService');
const DurationCalculationService = require('./DurationCalculationService');

class ConsolidationService {
    /**
     * Consolide une opération terminée dans ABTEMPS_OPERATEURS
     * @param {string} operatorCode - Code opérateur
     * @param {string} lancementCode - Code lancement
     * @param {Object} options - Options de consolidation
     * @returns {Promise<Object>} { success: boolean, tempsId: number|null, error: string|null, warnings: Array }
     */
    static async consolidateOperation(operatorCode, lancementCode, options = {}) {
        const { force = false, autoFix = true } = options;
        
        try {
            console.log(`🔄 Consolidation de ${operatorCode}/${lancementCode}...`);
            
            // 1. Vérifier si déjà consolidé
            if (!force) {
                const existingQuery = `
                    SELECT TempsId 
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                    WHERE OperatorCode = @operatorCode 
                      AND LancementCode = @lancementCode
                `;
                
                const existing = await executeQuery(existingQuery, { operatorCode, lancementCode });
                
                if (existing.length > 0) {
                    console.log(`ℹ️ Opération déjà consolidée: TempsId=${existing[0].TempsId}`);
                    return {
                        success: true,
                        tempsId: existing[0].TempsId,
                        error: null,
                        warnings: ['Opération déjà consolidée'],
                        alreadyExists: true
                    };
                }
            }
            
            // 2. Validation préalable
            const validation = await OperationValidationService.validateConsolidationData(operatorCode, lancementCode);
            
            if (!validation.valid) {
                // Auto-correction si activée
                if (autoFix && validation.events.length > 0) {
                    console.log(`🔧 Tentative d'auto-correction...`);
                    const fixed = OperationValidationService.autoFixOperationEvents(validation.events);
                    
                    if (fixed.fixed) {
                        console.log(`✅ Auto-corrections appliquées:`, fixed.fixes);
                        // Re-valider après correction
                        const revalidation = await OperationValidationService.validateConsolidationData(operatorCode, lancementCode);
                        if (revalidation.valid) {
                            console.log(`✅ Validation réussie après auto-correction`);
                        } else {
                            // Si toujours invalide après correction, retourner l'erreur
                            return {
                                success: false,
                                tempsId: null,
                                error: `Opération invalide après auto-correction: ${revalidation.errors.join(', ')}`,
                                warnings: fixed.fixes
                            };
                        }
                    } else {
                        // Auto-correction impossible
                        return {
                            success: false,
                            tempsId: null,
                            error: `Opération invalide: ${validation.errors.join(', ')}`,
                            warnings: validation.warnings
                        };
                    }
                } else {
                    // Auto-correction désactivée ou impossible
                    return {
                        success: false,
                        tempsId: null,
                        error: `Opération invalide: ${validation.errors.join(', ')}`,
                        warnings: validation.warnings
                    };
                }
            }
            
            // 3. Récupérer tous les événements (après validation)
            const eventsQuery = `
                SELECT * 
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorCode 
                  AND CodeLanctImprod = @lancementCode
                ORDER BY DateCreation ASC, NoEnreg ASC
            `;
            
            const events = await executeQuery(eventsQuery, { operatorCode, lancementCode });
            
            if (events.length === 0) {
                return {
                    success: false,
                    tempsId: null,
                    error: 'Aucun événement trouvé',
                    warnings: []
                };
            }
            
            // 4. Trouver les événements clés
            const debutEvent = events.find(e => e.Ident === 'DEBUT');
            const finEvent = events.find(e => e.Ident === 'FIN');
            
            if (!debutEvent || !finEvent) {
                return {
                    success: false,
                    tempsId: null,
                    error: 'Événements DEBUT ou FIN manquants',
                    warnings: []
                };
            }
            
            // 5. Calculer les durées (utiliser le service unifié)
            const durations = DurationCalculationService.calculateDurations(events);
            
            // 6. Extraire Phase et CodeRubrique
            const phase = debutEvent.Phase || finEvent.Phase || 'PRODUCTION';
            const codeRubrique = debutEvent.CodeRubrique || finEvent.CodeRubrique || operatorCode;
            
            // 7. Préparer les valeurs pour l'insertion
            const startTime = debutEvent.DateCreation;
            const endTime = finEvent.DateCreation;
            
            // 8. Vérifier à nouveau si déjà consolidé (race condition)
            if (!force) {
                const doubleCheckQuery = `
                    SELECT TempsId 
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                    WHERE OperatorCode = @operatorCode 
                      AND LancementCode = @lancementCode
                `;
                
                const doubleCheck = await executeQuery(doubleCheckQuery, { operatorCode, lancementCode });
                
                if (doubleCheck.length > 0) {
                    console.log(`ℹ️ Opération consolidée entre-temps: TempsId=${doubleCheck[0].TempsId}`);
                    return {
                        success: true,
                        tempsId: doubleCheck[0].TempsId,
                        error: null,
                        warnings: ['Opération consolidée par un autre processus'],
                        alreadyExists: true
                    };
                }
            }
            
            // 9. Insérer dans ABTEMPS_OPERATEURS
            const insertQuery = `
                INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                (OperatorCode, LancementCode, StartTime, EndTime, TotalDuration, PauseDuration, ProductiveDuration, EventsCount, Phase, CodeRubrique, DateCreation, StatutTraitement)
                OUTPUT INSERTED.TempsId
                VALUES (@operatorCode, @lancementCode, @startTime, @endTime, @totalDuration, @pauseDuration, @productiveDuration, @eventsCount, @phase, @codeRubrique, CAST(GETDATE() AS DATE), NULL)
            `;
            
            const insertResult = await executeQuery(insertQuery, {
                operatorCode,
                lancementCode,
                startTime,
                endTime,
                totalDuration: durations.totalDuration,
                pauseDuration: durations.pauseDuration,
                productiveDuration: durations.productiveDuration,
                eventsCount: durations.eventsCount,
                phase,
                codeRubrique
            });
            
            const tempsId = insertResult && insertResult[0] ? insertResult[0].TempsId : null;
            
            if (!tempsId) {
                return {
                    success: false,
                    tempsId: null,
                    error: 'Échec de l\'insertion - aucun TempsId retourné',
                    warnings: []
                };
            }
            
            console.log(`✅ Consolidation réussie: TempsId=${tempsId}, Durée=${durations.totalDuration}min (${durations.productiveDuration}min productif)`);
            
            return {
                success: true,
                tempsId,
                error: null,
                warnings: validation.warnings || [],
                durations
            };
            
        } catch (error) {
            console.error(`❌ Erreur lors de la consolidation de ${operatorCode}/${lancementCode}:`, error);
            
            // Vérifier si c'est une erreur de contrainte unique (doublon)
            if (error.number === 2627 || error.originalError?.number === 2627) {
                // Récupérer le TempsId existant
                const existingQuery = `
                    SELECT TempsId 
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                    WHERE OperatorCode = @operatorCode 
                      AND LancementCode = @lancementCode
                `;
                
                try {
                    const existing = await executeQuery(existingQuery, { operatorCode, lancementCode });
                    if (existing.length > 0) {
                        return {
                            success: true,
                            tempsId: existing[0].TempsId,
                            error: null,
                            warnings: ['Opération déjà consolidée (détecté après erreur)'],
                            alreadyExists: true
                        };
                    }
                } catch (queryError) {
                    // Ignorer l'erreur de requête
                }
            }
            
            return {
                success: false,
                tempsId: null,
                error: `Erreur lors de la consolidation: ${error.message}`,
                warnings: []
            };
        }
    }
    
    /**
     * Consolide un lot d'opérations
     * @param {Array} operations - Liste de { OperatorCode, LancementCode }
     * @param {Object} options - Options de consolidation
     * @returns {Promise<Object>} { success: Array, skipped: Array, errors: Array }
     */
    static async consolidateBatch(operations, options = {}) {
        const results = {
            success: [],
            skipped: [],
            errors: []
        };
        
        for (const op of operations) {
            const { OperatorCode, LancementCode } = op;
            
            if (!OperatorCode || !LancementCode) {
                results.errors.push({
                    operation: op,
                    error: 'OperatorCode et LancementCode requis'
                });
                continue;
            }
            
            try {
                const result = await this.consolidateOperation(OperatorCode, LancementCode, options);
                
                if (result.success) {
                    if (result.alreadyExists) {
                        results.skipped.push({
                            OperatorCode,
                            LancementCode,
                            TempsId: result.tempsId,
                            reason: 'Déjà consolidé'
                        });
                    } else {
                        results.success.push({
                            OperatorCode,
                            LancementCode,
                            TempsId: result.tempsId,
                            durations: result.durations
                        });
                    }
                } else {
                    results.errors.push({
                        operation: op,
                        error: result.error || 'Consolidation échouée'
                    });
                }
            } catch (error) {
                console.error(`❌ Erreur consolidation ${OperatorCode}/${LancementCode}:`, error);
                results.errors.push({
                    operation: op,
                    error: error.message
                });
            }
        }
        
        return results;
    }
    
    /**
     * Vérifie l'intégrité d'une consolidation
     * @param {number} tempsId - ID de l'enregistrement consolidé
     * @returns {Promise<Object>} { valid: boolean, errors: Array, record: Object }
     */
    static async verifyConsolidation(tempsId) {
        return await OperationValidationService.verifyConsolidation(tempsId);
    }
    
    /**
     * Recalcule les durées d'une opération consolidée
     * @param {number} tempsId - ID de l'enregistrement consolidé
     * @returns {Promise<Object>} { success: boolean, error: string|null, durations: Object }
     */
    static async recalculateDurations(tempsId) {
        try {
            // Récupérer l'enregistrement consolidé
            const recordQuery = `
                SELECT OperatorCode, LancementCode
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE TempsId = @tempsId
            `;
            
            const records = await executeQuery(recordQuery, { tempsId });
            
            if (records.length === 0) {
                return {
                    success: false,
                    error: 'Enregistrement consolidé non trouvé',
                    durations: null
                };
            }
            
            const record = records[0];
            
            // Récupérer les événements
            const eventsQuery = `
                SELECT * 
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorCode 
                  AND CodeLanctImprod = @lancementCode
                ORDER BY DateCreation ASC, NoEnreg ASC
            `;
            
            const events = await executeQuery(eventsQuery, {
                operatorCode: record.OperatorCode,
                lancementCode: record.LancementCode
            });
            
            // Calculer les durées
            const durations = DurationCalculationService.calculateDurations(events);
            
            // Mettre à jour l'enregistrement
            const updateQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET TotalDuration = @totalDuration,
                    PauseDuration = @pauseDuration,
                    ProductiveDuration = @productiveDuration,
                    EventsCount = @eventsCount
                WHERE TempsId = @tempsId
            `;
            
            await executeNonQuery(updateQuery, {
                tempsId,
                totalDuration: durations.totalDuration,
                pauseDuration: durations.pauseDuration,
                productiveDuration: durations.productiveDuration,
                eventsCount: durations.eventsCount
            });
            
            return {
                success: true,
                error: null,
                durations
            };
            
        } catch (error) {
            console.error(`❌ Erreur lors du recalcul des durées pour TempsId=${tempsId}:`, error);
            return {
                success: false,
                error: error.message,
                durations: null
            };
        }
    }
}

module.exports = ConsolidationService;
