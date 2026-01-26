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
            
            // 6. Déterminer Phase et CodeRubrique (clés ERP)
            // - Si les événements contiennent déjà Phase/CodeRubrique (issus de l'ERP), on les utilise.
            // - Sinon, fallback historique : récupérer depuis V_LCTC.
            let phase = debutEvent?.Phase || null;
            let codeRubrique = debutEvent?.CodeRubrique || null;

            const hasErpKeysFromEvents = Boolean(
                phase &&
                codeRubrique &&
                String(codeRubrique).trim() !== '' &&
                String(phase).trim() !== '' &&
                // Ancienne implémentation mettait CodeRubrique = operatorCode => ignorer ce cas
                String(codeRubrique).trim() !== String(operatorCode).trim()
            );
            
            if (!hasErpKeysFromEvents) {
                try {
                    const vlctcQuery = `
                        SELECT TOP 1 Phase, CodeRubrique
                        FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]
                        WHERE CodeLancement = @lancementCode
                    `;
                    
                    const vlctcResult = await executeQuery(vlctcQuery, { lancementCode });
                    
                    if (vlctcResult && vlctcResult.length > 0) {
                        // Prendre les valeurs EXACTEMENT telles quelles depuis V_LCTC (sans transformation)
                        phase = vlctcResult[0].Phase;
                        codeRubrique = vlctcResult[0].CodeRubrique;
                        console.log(`✅ Phase et CodeRubrique récupérés depuis V_LCTC: Phase=${phase}, CodeRubrique=${codeRubrique}`);
                    } else {
                        console.warn(`⚠️ Lancement ${lancementCode} non trouvé dans V_LCTC`);
                        console.warn(`⚠️ Raisons possibles: TypeRubrique <> 'O' (composant), LancementSolde <> 'N' (soldé), ou lancement inexistant dans SEDI_ERP`);
                        console.warn(`⚠️ Cette opération ne peut pas être consolidée car Phase et CodeRubrique sont requis (clés ERP)`);
                        return {
                            success: false,
                            skipped: true,
                            skipReason: 'VLCTC_MISSING',
                            tempsId: null,
                            error: null,
                            message: `Lancement ${lancementCode} ignoré: absent de V_LCTC (souvent normal si composant TypeRubrique <> 'O' ou lancement soldé LancementSolde <> 'N').`,
                            warnings: [
                                'Impossible de récupérer Phase et CodeRubrique depuis V_LCTC',
                                'C\'est normal si le lancement est un composant (TypeRubrique <> \'O\') ou s\'il est soldé',
                                'Ces opérations ne doivent pas être consolidées selon les spécifications ERP'
                            ]
                        };
                    }
                } catch (error) {
                    console.error(`❌ Erreur lors de la récupération de Phase/CodeRubrique depuis V_LCTC:`, error);
                    return {
                        success: false,
                        tempsId: null,
                        error: `Erreur lors de la récupération de Phase/CodeRubrique depuis V_LCTC: ${error.message}`,
                        warnings: ['Erreur lors de la récupération depuis V_LCTC']
                    };
                }
            } else {
                console.log(`✅ Phase/CodeRubrique déjà présents dans les événements: Phase=${phase}, CodeRubrique=${codeRubrique}`);
            }
            
            // 7. Préparer les valeurs pour l'insertion
            // IMPORTANT: DateCreation est souvent une DATE (00:00:00) => utiliser CreatedAt ou HeureDebut/HeureFin
            const extractTime = (timeValue) => {
                if (!timeValue) return null;
                if (typeof timeValue === 'string') {
                    const match = timeValue.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
                    if (match) {
                        return { hour: parseInt(match[1], 10), minute: parseInt(match[2], 10) };
                    }
                }
                if (timeValue instanceof Date) {
                    return { hour: timeValue.getHours(), minute: timeValue.getMinutes() };
                }
                if (typeof timeValue === 'object' && timeValue.hour !== undefined && timeValue.minute !== undefined) {
                    return { hour: parseInt(timeValue.hour, 10), minute: parseInt(timeValue.minute, 10) };
                }
                return null;
            };

            const buildDateTime = (event, kind /* 'start' | 'end' */) => {
                // 1) Prefer CreatedAt if present (full datetime)
                const createdAt = event.CreatedAt || event.createdAt;
                if (createdAt) {
                    const d = new Date(createdAt);
                    if (!isNaN(d.getTime())) return d;
                }

                // 2) Use DateCreation as date + HeureDebut/HeureFin as time
                const base = new Date(event.DateCreation || event.dateCreation);
                if (!isNaN(base.getTime())) {
                    const t = extractTime(kind === 'start' ? event.HeureDebut : event.HeureFin);
                    if (t) {
                        base.setHours(t.hour, t.minute, 0, 0);
                        return base;
                    }
                    // If DateCreation already contains time, keep it
                    return base;
                }

                // 3) Last resort: now
                return new Date();
            };

            const startTime = buildDateTime(debutEvent, 'start');
            const endTime = buildDateTime(finEvent, 'end');
            
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
            
            // 7. Vérifier que ProductiveDuration > 0 (SILOG n'accepte pas les temps à 0)
            if (durations.productiveDuration <= 0) {
                console.warn(`⚠️ ProductiveDuration = ${durations.productiveDuration} (Total=${durations.totalDuration}, Pause=${durations.pauseDuration})`);
                console.warn(`⚠️ SILOG n'accepte pas les enregistrements avec ProductiveDuration = 0`);
                // Ne pas bloquer la consolidation, mais logger un avertissement
                // L'admin pourra corriger manuellement si nécessaire
            }
            
            // 8. Insérer dans ABTEMPS_OPERATEURS
            // IMPORTANT: ProductiveDuration est en MINUTES (TotalDuration - PauseDuration)
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
                totalDuration: durations.totalDuration, // en minutes
                pauseDuration: durations.pauseDuration, // en minutes
                productiveDuration: durations.productiveDuration, // en minutes (TotalDuration - PauseDuration)
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
                    if (result.skipped) {
                        results.skipped.push({
                            OperatorCode,
                            LancementCode,
                            reason: result.skipReason || 'Ignoré',
                            message: result.message || null,
                            warnings: result.warnings || []
                        });
                } else {
                    results.errors.push({
                        operation: op,
                        error: result.error || 'Consolidation échouée'
                    });
                    }
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
            
            // Vérifier que ProductiveDuration > 0 (SILOG n'accepte pas les temps à 0)
            if (durations.productiveDuration <= 0) {
                console.warn(`⚠️ ProductiveDuration = ${durations.productiveDuration} après recalcul (Total=${durations.totalDuration}, Pause=${durations.pauseDuration})`);
                console.warn(`⚠️ SILOG n'accepte pas les enregistrements avec ProductiveDuration = 0`);
            }
            
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
                totalDuration: durations.totalDuration, // en minutes
                pauseDuration: durations.pauseDuration, // en minutes
                productiveDuration: durations.productiveDuration, // en minutes (TotalDuration - PauseDuration)
                eventsCount: durations.eventsCount
            });
            
            console.log(`✅ Durées recalculées pour TempsId=${tempsId}: Total=${durations.totalDuration}min, Pause=${durations.pauseDuration}min, Productif=${durations.productiveDuration}min`);
            
            return {
                success: true,
                error: null,
                durations,
                warnings: durations.productiveDuration <= 0 
                    ? ['ProductiveDuration = 0 après recalcul. SILOG n\'accepte pas les temps à 0.'] 
                    : []
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
