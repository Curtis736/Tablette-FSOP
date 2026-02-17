/**
 * Service de consolidation robuste avec gestion transactionnelle
 * Gère la consolidation des opérations avec validation, détection de doublons et gestion de conflits
 */

const { executeQuery, executeNonQuery, getConnection } = require('../config/database');
const OperationValidationService = require('./OperationValidationService');
const DurationCalculationService = require('./DurationCalculationService');

class ConsolidationService {
    /**
     * Retourne une clé de date locale YYYY-MM-DD (évite les décalages UTC sur les champs SQL DATE)
     */
    static _localDateKey(value) {
        if (!value) return null;
        const d = value instanceof Date ? new Date(value) : new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    /**
     * Sélectionne le "dernier cycle" (DEBUT..FIN) pertinent parmi tous les événements d'un opérateur/lancement.
     * - Si options.phase / options.codeRubrique / options.dateCreation sont fournis, on scope dessus.
     * - Sinon on infère à partir du dernier événement FIN (ou à défaut du dernier événement).
     * @returns {Object} { scopedEvents, debutEvent, finEvent, inferredPhase, inferredCodeRubrique, inferredDateKey }
     */
    static _selectLatestCycleEvents(allEvents, options = {}) {
        const optPhase = options.phase ?? options.Phase ?? null;
        const optCodeRubrique = options.codeRubrique ?? options.CodeRubrique ?? null;
        const optDate = options.dateCreation ?? options.date ?? options.DateCreation ?? null;
        const optDateKey = this._localDateKey(optDate);

        const getEventDateTime = (e) => {
            const v = e.CreatedAt || e.createdAt || e.DateCreation || e.dateCreation;
            const d = new Date(v);
            if (!Number.isNaN(d.getTime())) return d;
            return new Date(0);
        };

        const sorted = [...allEvents].sort((a, b) => {
            const da = getEventDateTime(a).getTime();
            const db = getEventDateTime(b).getTime();
            if (da !== db) return da - db;
            return (a.NoEnreg || 0) - (b.NoEnreg || 0);
        });

        const lastFin = [...sorted].reverse().find(e => String(e.Ident || '').toUpperCase() === 'FIN');
        const lastAny = sorted.length ? sorted[sorted.length - 1] : null;
        const ref = lastFin || lastAny;

        const inferredPhase = (optPhase ?? ref?.Phase ?? null);
        const inferredCodeRubrique = (optCodeRubrique ?? ref?.CodeRubrique ?? null);
        const inferredDateKey = (optDateKey ?? this._localDateKey(ref?.DateCreation || ref?.CreatedAt || ref?.createdAt) ?? null);

        const scoped = sorted.filter(e => {
            if (inferredDateKey) {
                const dk = this._localDateKey(e.DateCreation || e.dateCreation || e.CreatedAt || e.createdAt);
                if (dk !== inferredDateKey) return false;
            }
            if (inferredPhase && String(e.Phase || '').trim() !== String(inferredPhase).trim()) return false;
            if (inferredCodeRubrique && String(e.CodeRubrique || '').trim() !== String(inferredCodeRubrique).trim()) return false;
            return true;
        });

        // Dans le scope, prendre le dernier FIN puis le DEBUT le plus proche avant.
        let finIdx = -1;
        for (let i = scoped.length - 1; i >= 0; i--) {
            if (String(scoped[i].Ident || '').toUpperCase() === 'FIN') {
                finIdx = i;
                break;
            }
        }
        if (finIdx === -1) {
            const debutEvent = [...scoped].reverse().find(e => String(e.Ident || '').toUpperCase() === 'DEBUT') || null;
            return {
                scopedEvents: scoped,
                debutEvent,
                finEvent: null,
                inferredPhase,
                inferredCodeRubrique,
                inferredDateKey
            };
        }

        let debutIdx = -1;
        for (let i = finIdx; i >= 0; i--) {
            if (String(scoped[i].Ident || '').toUpperCase() === 'DEBUT') {
                debutIdx = i;
                break;
            }
        }

        const cycleEvents = debutIdx >= 0 ? scoped.slice(debutIdx, finIdx + 1) : scoped.slice(0, finIdx + 1);
        const debutEvent = cycleEvents.find(e => String(e.Ident || '').toUpperCase() === 'DEBUT') || null;
        const finEvent = cycleEvents.find(e => String(e.Ident || '').toUpperCase() === 'FIN') || null;

        return {
            scopedEvents: cycleEvents,
            debutEvent,
            finEvent,
            inferredPhase,
            inferredCodeRubrique,
            inferredDateKey
        };
    }

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

            // 1. Récupérer tous les événements (on scoper ensuite sur le dernier cycle)
            const eventsQuery = `
                SELECT * 
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorCode 
                  AND CodeLanctImprod = @lancementCode
                ORDER BY DateCreation ASC, NoEnreg ASC
            `;
            
            const allEvents = await executeQuery(eventsQuery, { operatorCode, lancementCode });

            if (!allEvents || allEvents.length === 0) {
                return {
                    success: false,
                    tempsId: null,
                    error: 'Aucun événement trouvé',
                    warnings: []
                };
            }

            // 2. Sélectionner le dernier cycle (évite de consolider un ancien jour/cycle)
            const selected = this._selectLatestCycleEvents(allEvents, options);
            let events = selected.scopedEvents;
            let debutEvent = selected.debutEvent;
            let finEvent = selected.finEvent;

            // 3. Validation du cycle sélectionné
            let validation = OperationValidationService.validateOperationEvents(events);
            if (!validation.valid) {
                if (autoFix && validation.events && validation.events.length > 0) {
                    console.log(`🔧 Tentative d'auto-correction...`);
                    const fixed = OperationValidationService.autoFixOperationEvents(validation.events);
                    if (fixed.fixed) {
                        console.log(`✅ Auto-corrections appliquées:`, fixed.fixes);
                        events = fixed.fixedEvents;
                        validation = OperationValidationService.validateOperationEvents(events);
                    }
                    if (!validation.valid) {
                        return {
                            success: false,
                            tempsId: null,
                            error: `Opération invalide: ${validation.errors.join(', ')}`,
                            warnings: fixed.fixes || validation.warnings || []
                        };
                    }
                } else {
                    return {
                        success: false,
                        tempsId: null,
                        error: `Opération invalide: ${validation.errors.join(', ')}`,
                        warnings: validation.warnings || []
                    };
                }
            }

            // Reprendre les events clés après validation (sur le cycle)
            debutEvent = events.find(e => String(e.Ident || '').toUpperCase() === 'DEBUT') || debutEvent;
            finEvent = events.find(e => String(e.Ident || '').toUpperCase() === 'FIN') || finEvent;
            if (!debutEvent || !finEvent) {
                return {
                    success: false,
                    tempsId: null,
                    error: 'Événements DEBUT ou FIN manquants (cycle sélectionné)',
                    warnings: validation.warnings || []
                };
            }

            // 4. Calculer les durées (sur le cycle sélectionné)
            const durations = DurationCalculationService.calculateDurations(events);
            
            // IMPORTANT: la "date de travail" doit rester celle des événements (pas la date de consolidation),
            // sinon le filtre "transféré" côté opérateur (JOIN ABTEMPS.DateCreation = ABHISTO.DateCreation) ne matche pas
            // quand l'admin transfère un jour différent.
            const rawDateCreation = debutEvent?.DateCreation || finEvent?.DateCreation || new Date();
            // ⚠️ IMPORTANT: éviter de passer un objet Date JS (risque de décalage UTC sur un champ SQL DATE).
            // On passe une string YYYY-MM-DD stable, castée en DATE côté SQL.
            const opDate = (() => {
                const k = this._localDateKey(rawDateCreation);
                if (k) return k; // 'YYYY-MM-DD'
                // fallback: aujourd'hui (local)
                return this._localDateKey(new Date());
            })();

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

            // 8bis. Vérifier si déjà consolidé selon la contrainte UNIQUE réelle (souvent basée sur StartTime)
            // Certains environnements ont une contrainte UNIQUE sur (OperatorCode, LancementCode, StartTime).
            // Si on ne check pas ça, on peut échouer avec "Cannot insert duplicate key".
            if (!force && startTime) {
                try {
                    const byStartQuery = `
                        SELECT TOP 1 TempsId
                        FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                        WHERE OperatorCode = @operatorCode
                          AND LancementCode = @lancementCode
                          AND StartTime = @startTime
                        ORDER BY TempsId DESC
                    `;
                    const rows = await executeQuery(byStartQuery, { operatorCode, lancementCode, startTime });
                    if (rows && rows.length > 0) {
                        console.log(`ℹ️ Opération déjà consolidée (StartTime match): TempsId=${rows[0].TempsId}`);
                        return {
                            success: true,
                            tempsId: rows[0].TempsId,
                            error: null,
                            warnings: ['Opération déjà consolidée (StartTime)'],
                            alreadyExists: true
                        };
                    }
                } catch (e) {
                    // best-effort: ne pas bloquer si ce check échoue
                }
            }

            // 8. Vérifier si déjà consolidé (sur les clés complètes : opérateur + LT + phase + rubrique + date)
            if (!force) {
                const existingQuery = `
                    SELECT TempsId 
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                    WHERE OperatorCode = @operatorCode 
                      AND LancementCode = @lancementCode
                      AND ISNULL(LTRIM(RTRIM(Phase)), '') = ISNULL(LTRIM(RTRIM(@phase)), '')
                      AND ISNULL(LTRIM(RTRIM(CodeRubrique)), '') = ISNULL(LTRIM(RTRIM(@codeRubrique)), '')
                      AND DateCreation = @dateCreation
                `;
                const existing = await executeQuery(existingQuery, {
                    operatorCode,
                    lancementCode,
                    phase,
                    codeRubrique,
                    dateCreation: opDate
                });
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
            
            // 8. Vérifier à nouveau si déjà consolidé (race condition)
            if (!force) {
                const doubleCheckQuery = `
                    SELECT TempsId 
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                    WHERE OperatorCode = @operatorCode 
                      AND LancementCode = @lancementCode
                      AND ISNULL(LTRIM(RTRIM(Phase)), '') = ISNULL(LTRIM(RTRIM(@phase)), '')
                      AND ISNULL(LTRIM(RTRIM(CodeRubrique)), '') = ISNULL(LTRIM(RTRIM(@codeRubrique)), '')
                      AND DateCreation = @dateCreation
                `;
                
                const doubleCheck = await executeQuery(doubleCheckQuery, {
                    operatorCode,
                    lancementCode,
                    phase,
                    codeRubrique,
                    dateCreation: opDate
                });
                
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
                VALUES (@operatorCode, @lancementCode, @startTime, @endTime, @totalDuration, @pauseDuration, @productiveDuration, @eventsCount, @phase, @codeRubrique, CAST(@dateCreation AS DATE), NULL)
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
                codeRubrique,
                dateCreation: opDate
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
                // Récupérer le TempsId existant (commencer par la clé de contrainte la plus probable: StartTime)
                try {
                    if (startTime) {
                        const byStartQuery = `
                            SELECT TOP 1 TempsId
                            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                            WHERE OperatorCode = @operatorCode
                              AND LancementCode = @lancementCode
                              AND StartTime = @startTime
                            ORDER BY TempsId DESC
                        `;
                        const byStart = await executeQuery(byStartQuery, { operatorCode, lancementCode, startTime });
                        if (byStart && byStart.length > 0) {
                            return {
                                success: true,
                                tempsId: byStart[0].TempsId,
                                error: null,
                                warnings: ['Opération déjà consolidée (détecté via StartTime après erreur UNIQUE)'],
                                alreadyExists: true
                            };
                        }
                    }
                } catch (e) {
                    // ignore
                }

                // Fallback: clé historique (phase/rubrique/date)
                const existingQuery = `
                    SELECT TempsId 
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                    WHERE OperatorCode = @operatorCode 
                      AND LancementCode = @lancementCode
                      AND ISNULL(LTRIM(RTRIM(Phase)), '') = ISNULL(LTRIM(RTRIM(@phase)), '')
                      AND ISNULL(LTRIM(RTRIM(CodeRubrique)), '') = ISNULL(LTRIM(RTRIM(@codeRubrique)), '')
                      AND DateCreation = @dateCreation
                `;
                
                try {
                    const existing = await executeQuery(existingQuery, {
                        operatorCode,
                        lancementCode,
                        phase,
                        codeRubrique,
                        dateCreation: opDate
                    });
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
