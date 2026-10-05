/**
 * Service de consolidation robuste avec gestion transactionnelle
 * Gère la consolidation des opérations avec validation, détection de doublons et gestion de conflits
 */

const { executeQuery, executeNonQuery, getConnection } = require('../config/database');
const OperationValidationService = require('./OperationValidationService');
const DurationCalculationService = require('./DurationCalculationService');

/** Qualifier SQL [DB] — suit DB_DATABASE en DEV sans dépendre du module RH. */
const appDb = `[${String(process.env.DB_DATABASE || 'SEDI_APP_INDEPENDANTE').replace(/[\[\]]/g, '')}]`;

class ConsolidationService {
    /**
     * Retourne une clé de date locale YYYY-MM-DD (évite les décalages UTC sur les champs SQL DATE)
     */
    static _localDateKey(value) {
        if (!value) return null;
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    /**
     * Validation SILOG (NULL → 'O') après consolidation hors transaction.
     * Accepte un TempsId ou une liste (créneaux productifs).
     */
    static async _finishConsolidation(result, options = {}) {
        if (
            result?.success &&
            !options?.db &&
            options?.skipSilogValidate !== true
        ) {
            const ids = Array.isArray(result.tempsIds) && result.tempsIds.length > 0
                ? result.tempsIds
                : (result.tempsId ? [result.tempsId] : []);
            if (ids.length > 0) {
                try {
                    const MonitoringService = require('./MonitoringService');
                    let allOk = true;
                    let lastReason = null;
                    for (const id of ids) {
                        const v = await MonitoringService.validateTempsIdForSilog(id);
                        if (v && v.validated !== true) {
                            allOk = false;
                            lastReason = v.reason || lastReason;
                        }
                    }
                    result.silogValidated = allOk;
                    if (lastReason && !allOk) {
                        result.silogValidateReason = lastReason;
                    }
                } catch (e) {
                    console.warn('Validation SILOG auto après consolidation (non bloquant):', e?.message || e);
                }
            }
        }
        return result;
    }

    /**
     * Compare deux datetime à la minute près (SILOG / ABTEMPS).
     */
    static _sameMinute(a, b) {
        if (!a || !b) return false;
        const da = a instanceof Date ? a : new Date(a);
        const db = b instanceof Date ? b : new Date(b);
        if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
        return da.getFullYear() === db.getFullYear()
            && da.getMonth() === db.getMonth()
            && da.getDate() === db.getDate()
            && da.getHours() === db.getHours()
            && da.getMinutes() === db.getMinutes();
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
        // Important: ne pas forcer un scope par date si le client n'a pas explicitement fourni
        // `options.dateCreation`. Sinon, un cycle DEBUT..FIN qui traverse minuit peut être
        // artificiellement "coupé" et conduire à l'échec de consolidation.
        const inferredDateKey = optDateKey ?? null;

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
        const db = options.db || { executeQuery, executeNonQuery };

        // Variables utiles au traitement d'erreurs (ex: contrainte UNIQUE)
        let startTime = null;
        let phase = null;
        let codeRubrique = null;
        let opDate = null;
        
        try {
            console.log(`🔄 Consolidation de ${operatorCode}/${lancementCode}...`);

            // 1. Récupérer tous les événements (on scoper ensuite sur le dernier cycle)
            const eventsQuery = `
                SELECT * 
                FROM ${appDb}.[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorCode 
                  AND CodeLanctImprod = @lancementCode
                ORDER BY DateCreation ASC, NoEnreg ASC
            `;
            
            const allEvents = await db.executeQuery(eventsQuery, { operatorCode, lancementCode });

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

            // 4. Créneaux productifs (1 ABTEMPS / créneau = même découpage que l'écran admin)
            // Pause = fin de ligne, reprise = début suivante. PauseDuration toujours 0 sur chaque ligne.
            const workSegments = DurationCalculationService.buildClosedWorkSegments(events);
            if (!workSegments.length) {
                return {
                    success: false,
                    tempsId: null,
                    tempsIds: [],
                    error: 'Aucun créneau productif fermé à consolider',
                    warnings: validation.warnings || []
                };
            }

            const cycleDurations = DurationCalculationService.calculateDurations(events);
            
            // IMPORTANT: la "date de travail" doit rester celle des événements (pas la date de consolidation),
            // sinon le filtre "transféré" côté opérateur (JOIN ABTEMPS.DateCreation = ABHISTO.DateCreation) ne matche pas
            // quand l'admin transfère un jour différent.
            const rawDateCreation = debutEvent?.DateCreation || finEvent?.DateCreation || new Date();
            // ⚠️ IMPORTANT: éviter de passer un objet Date JS (risque de décalage UTC sur un champ SQL DATE).
            // On passe une string YYYY-MM-DD stable, castée en DATE côté SQL.
            opDate = (() => {
                const k = this._localDateKey(rawDateCreation);
                if (k) return k; // 'YYYY-MM-DD'
                // fallback: aujourd'hui (local)
                return this._localDateKey(new Date());
            })();

            // 6. Déterminer Phase et CodeRubrique (clés ERP)
            // ABTEMPS.Phase/CodeRubrique sont NOT NULL : on n'insère JAMAIS NULL,
            // et on n'invente JAMAIS 'PRODUCTION' (rejeté par SILOG).
            // Sans clés ERP résolues → skip consolidation (FIN reste écrit, stop OK).
            const EVENT_MARKER_PHASES = new Set(['PRODUCTION', 'PAUSE', 'REPRISE', 'TERMINE', 'TERMINÉE', 'ADMIN']);
            const isEventMarkerPhase = (value) =>
                EVENT_MARKER_PHASES.has(String(value || '').trim().toUpperCase());
            const looksLikeErpKeys = (ph, rub) => {
                const p = String(ph || '').trim();
                const r = String(rub || '').trim();
                if (!p || !r) return false;
                if (isEventMarkerPhase(p)) return false;
                // Ancienne implémentation mettait CodeRubrique = operatorCode => ignorer ce cas
                if (r === String(operatorCode || '').trim()) return false;
                return true;
            };

            phase = debutEvent?.Phase || null;
            codeRubrique = debutEvent?.CodeRubrique || null;

            if (!looksLikeErpKeys(phase, codeRubrique)) {
                phase = null;
                codeRubrique = null;

                // Prefer keys passed by /stop (étape réellement choisie / résolue)
                const optPhase = options.phase ?? options.Phase ?? null;
                const optRub = options.codeRubrique ?? options.CodeRubrique ?? null;
                if (looksLikeErpKeys(optPhase, optRub)) {
                    phase = String(optPhase).trim();
                    codeRubrique = String(optRub).trim();
                    console.log(`✅ Phase/CodeRubrique depuis options stop: Phase=${phase}, CodeRubrique=${codeRubrique}`);
                }
            } else {
                phase = String(phase).trim();
                codeRubrique = String(codeRubrique).trim();
                console.log(`✅ Phase/CodeRubrique déjà présents dans les événements: Phase=${phase}, CodeRubrique=${codeRubrique}`);
            }

            if (!looksLikeErpKeys(phase, codeRubrique)) {
                try {
                    // 1) V_LCTC (lancements non soldés, TypeRubrique='O')
                    let rows = await db.executeQuery(
                        `
                        SELECT TOP 1 Phase, CodeRubrique
                        FROM ${appDb}.[dbo].[V_LCTC]
                        WHERE CodeLancement = @lancementCode
                        `,
                        { lancementCode }
                    );

                    // 2) LCTC brut si V_LCTC muet (ex: lancement soldé entre-temps)
                    if (!rows?.length) {
                        rows = await db.executeQuery(
                            `
                            SELECT TOP 1
                                LTRIM(RTRIM(Phase)) AS Phase,
                                LTRIM(RTRIM(CodeRubrique)) AS CodeRubrique
                            FROM [SEDI_ERP].[dbo].[LCTC]
                            WHERE CodeLancement = @lancementCode
                              AND TypeRubrique = 'O'
                            ORDER BY Phase, CodeRubrique
                            `,
                            { lancementCode }
                        );
                        if (rows?.length) {
                            console.warn(`⚠️ Lancement ${lancementCode} absent de V_LCTC — clés reprises depuis LCTC`);
                        }
                    }

                    if (rows?.length && looksLikeErpKeys(rows[0].Phase, rows[0].CodeRubrique)) {
                        phase = String(rows[0].Phase).trim();
                        codeRubrique = String(rows[0].CodeRubrique).trim();
                        console.log(`✅ Phase et CodeRubrique récupérés ERP: Phase=${phase}, CodeRubrique=${codeRubrique}`);
                    } else {
                        console.warn(`⚠️ Lancement ${lancementCode}: impossible de résoudre Phase/CodeRubrique ERP`);
                        console.warn(`⚠️ Raisons possibles: TypeRubrique <> 'O', lancement inexistant, ou clés marqueur uniquement`);
                        return {
                            success: false,
                            skipped: true,
                            skipReason: 'VLCTC_MISSING',
                            tempsId: null,
                            tempsIds: [],
                            error: null,
                            message: `Clés ERP introuvables pour ${lancementCode} — consolidation reportée (FIN enregistrée)`,
                            warnings: ['Phase/CodeRubrique non résolus — pas d\'insertion ABTEMPS (colonnes NOT NULL)']
                        };
                    }
                } catch (error) {
                    console.error(`❌ Erreur résolution Phase/CodeRubrique ERP:`, error);
                    return {
                        success: false,
                        skipped: true,
                        skipReason: 'VLCTC_MISSING',
                        tempsId: null,
                        tempsIds: [],
                        error: null,
                        message: `Erreur résolution clés ERP pour ${lancementCode} — consolidation reportée`,
                        warnings: [error.message]
                    };
                }
            }
            
            // 7. Préparer les valeurs pour l'insertion
            // IMPORTANT: DateCreation est souvent une DATE (00:00:00) => utiliser CreatedAt ou HeureDebut/HeureFin
            const extractTime = (timeValue) => {
                if (!timeValue) return null;
                if (typeof timeValue === 'string') {
                    const match = timeValue.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
                    if (match) {
                        return { hour: Number.parseInt(match[1], 10), minute: Number.parseInt(match[2], 10) };
                    }
                }
                if (timeValue instanceof Date) {
                    return { hour: timeValue.getHours(), minute: timeValue.getMinutes() };
                }
                if (typeof timeValue === 'object' && timeValue.hour !== undefined && timeValue.minute !== undefined) {
                    return { hour: Number.parseInt(timeValue.hour, 10), minute: Number.parseInt(timeValue.minute, 10) };
                }
                return null;
            };

            const buildDateTime = (event, kind /* 'start' | 'end' */) => {
                // 1) Prefer CreatedAt if present (full datetime)
                const createdAt = event.CreatedAt || event.createdAt;
                if (createdAt) {
                    const d = new Date(createdAt);
                    if (!Number.isNaN(d.getTime())) return d;
                }

                // 2) Use DateCreation as date + HeureDebut/HeureFin as time
                const base = new Date(event.DateCreation || event.dateCreation);
                if (!Number.isNaN(base.getTime())) {
                    const timeField = kind === 'start'
                        ? (event.HeureDebut || event.HeureFin)
                        : (event.HeureFin || event.HeureDebut);
                    const t = extractTime(timeField);
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

            const resolvedSegments = workSegments.map((seg) => {
                const segStart = buildDateTime(seg.startEvent, 'start');
                const segEnd = buildDateTime(seg.endEvent, seg.endIsFin ? 'end' : 'start');
                const minutes = Math.max(0, Math.floor((segEnd - segStart) / (1000 * 60)));
                return {
                    startTime: segStart,
                    endTime: segEnd,
                    totalDuration: minutes,
                    pauseDuration: 0,
                    productiveDuration: minutes
                };
            }).filter((seg) => seg.startTime && seg.endTime && seg.endTime >= seg.startTime);

            if (!resolvedSegments.length) {
                return {
                    success: false,
                    tempsId: null,
                    tempsIds: [],
                    error: 'Créneaux productifs invalides (heures)',
                    warnings: validation.warnings || []
                };
            }

            // Conservé pour gestion d'erreur UNIQUE (premier créneau)
            startTime = resolvedSegments[0].startTime;

            const tempsIds = [];
            let insertedCount = 0;
            let updatedCount = 0;

            for (const seg of resolvedSegments) {
                const durationParams = {
                    operatorCode,
                    lancementCode,
                    startTime: seg.startTime,
                    endTime: seg.endTime,
                    totalDuration: seg.totalDuration,
                    pauseDuration: seg.pauseDuration,
                    productiveDuration: seg.productiveDuration,
                    eventsCount: 1,
                    phase,
                    codeRubrique,
                    dateCreation: opDate
                };

                if (seg.productiveDuration <= 0) {
                    console.warn(`⚠️ Segment productif à 0 min ignoré (${operatorCode}/${lancementCode} ${seg.startTime?.toISOString?.() || seg.startTime})`);
                    continue;
                }

                let existing = null;
                try {
                    const byStartQuery = `
                        SELECT TOP 1 TempsId, EndTime, PauseDuration, StatutTraitement, ProductiveDuration
                        FROM ${appDb}.[dbo].[ABTEMPS_OPERATEURS]
                        WHERE OperatorCode = @operatorCode
                          AND LancementCode = @lancementCode
                          AND StartTime = @startTime
                        ORDER BY TempsId DESC
                    `;
                    const rows = await db.executeQuery(byStartQuery, {
                        operatorCode,
                        lancementCode,
                        startTime: seg.startTime
                    });
                    existing = rows && rows.length > 0 ? rows[0] : null;
                } catch (e) {
                    // best-effort
                }

                if (existing) {
                    const st = String(existing.StatutTraitement ?? '').toUpperCase().trim();
                    const locked = st === 'T' || st === 'O';
                    const sameEnd = ConsolidationService._sameMinute(existing.EndTime, seg.endTime);
                    const alreadySegment = sameEnd && Number(existing.PauseDuration || 0) === 0;

                    if (alreadySegment && !force) {
                        tempsIds.push(existing.TempsId);
                        continue;
                    }

                    if (locked && !force) {
                        // Déjà validé/transféré : ne pas recouper
                        tempsIds.push(existing.TempsId);
                        continue;
                    }

                    await db.executeNonQuery(
                        `UPDATE ${appDb}.[dbo].[ABTEMPS_OPERATEURS]
                         SET StartTime = @startTime, EndTime = @endTime,
                             TotalDuration = @totalDuration, PauseDuration = @pauseDuration,
                             ProductiveDuration = @productiveDuration, EventsCount = @eventsCount,
                             Phase = COALESCE(@phase, Phase),
                             CodeRubrique = COALESCE(@codeRubrique, CodeRubrique)
                         WHERE TempsId = @tempsId`,
                        { ...durationParams, tempsId: existing.TempsId }
                    );
                    tempsIds.push(existing.TempsId);
                    updatedCount += 1;
                    console.log(`✅ Segment ABTEMPS mis à jour: TempsId=${existing.TempsId}, ${seg.productiveDuration}min`);
                    continue;
                }

                if (force) {
                    // force sans ligne existante → INSERT ci-dessous
                }

                const insertQuery = `
                    INSERT INTO ${appDb}.[dbo].[ABTEMPS_OPERATEURS]
                    (OperatorCode, LancementCode, StartTime, EndTime, TotalDuration, PauseDuration, ProductiveDuration, EventsCount, Phase, CodeRubrique, DateCreation, StatutTraitement)
                    OUTPUT INSERTED.TempsId
                    VALUES (@operatorCode, @lancementCode, @startTime, @endTime, @totalDuration, @pauseDuration, @productiveDuration, @eventsCount, @phase, @codeRubrique, CAST(@dateCreation AS DATE), NULL)
                `;
                try {
                    const insertResult = await db.executeQuery(insertQuery, durationParams);
                    const newId = insertResult && insertResult[0] ? insertResult[0].TempsId : null;
                    if (!newId) {
                        return {
                            success: false,
                            tempsId: tempsIds[0] || null,
                            tempsIds,
                            error: 'Échec de l\'insertion - aucun TempsId retourné',
                            warnings: []
                        };
                    }
                    tempsIds.push(newId);
                    insertedCount += 1;
                    console.log(`✅ Segment ABTEMPS créé: TempsId=${newId}, ${seg.productiveDuration}min`);
                } catch (error) {
                    // Contrainte UNIQUE (StartTime) : récupérer l'existant
                    if (error.number === 2627 || error.originalError?.number === 2627) {
                        try {
                            const byStart = await db.executeQuery(
                                `SELECT TOP 1 TempsId
                                 FROM ${appDb}.[dbo].[ABTEMPS_OPERATEURS]
                                 WHERE OperatorCode = @operatorCode
                                   AND LancementCode = @lancementCode
                                   AND StartTime = @startTime
                                 ORDER BY TempsId DESC`,
                                { operatorCode, lancementCode, startTime: seg.startTime }
                            );
                            if (byStart && byStart.length > 0) {
                                tempsIds.push(byStart[0].TempsId);
                                continue;
                            }
                        } catch (e) {
                            // ignore
                        }
                    }
                    throw error;
                }
            }

            if (!tempsIds.length) {
                return {
                    success: false,
                    tempsId: null,
                    tempsIds: [],
                    error: 'Aucun créneau productif consolidé (durées à 0 ?)',
                    warnings: validation.warnings || []
                };
            }

            const primaryTempsId = tempsIds[0];
            const alreadyExists = insertedCount === 0 && updatedCount === 0;
            console.log(
                `✅ Consolidation segments: ${tempsIds.length} TempsId(s) [${tempsIds.join(',')}] ` +
                `(insert=${insertedCount}, update=${updatedCount}, cycleProductif=${cycleDurations.productiveDuration}min)`
            );

            return await ConsolidationService._finishConsolidation({
                success: true,
                tempsId: primaryTempsId,
                tempsIds,
                error: null,
                warnings: validation.warnings || [],
                durations: cycleDurations,
                alreadyExists,
                segmentsCount: resolvedSegments.length
            }, options);
            
        } catch (error) {
            console.error(`❌ Erreur lors de la consolidation de ${operatorCode}/${lancementCode}:`, error);
            
            // Vérifier si c'est une erreur de contrainte unique (doublon StartTime)
            if (error.number === 2627 || error.originalError?.number === 2627) {
                // Récupérer le TempsId existant via la clé UNIQUE (OperatorCode, LancementCode, StartTime)
                try {
                    if (startTime) {
                        const byStartQuery = `
                            SELECT TOP 1 TempsId
                            FROM ${appDb}.[dbo].[ABTEMPS_OPERATEURS]
                            WHERE OperatorCode = @operatorCode
                              AND LancementCode = @lancementCode
                              AND StartTime = @startTime
                            ORDER BY TempsId DESC
                        `;
                        const byStart = await db.executeQuery(byStartQuery, { operatorCode, lancementCode, startTime });
                        if (byStart && byStart.length > 0) {
                            return await ConsolidationService._finishConsolidation({
                                success: true,
                                tempsId: byStart[0].TempsId,
                                tempsIds: [byStart[0].TempsId],
                                error: null,
                                warnings: ['Opération déjà consolidée (détecté via StartTime après erreur UNIQUE)'],
                                alreadyExists: true
                            }, options);
                        }
                    }
                } catch (e) {
                    // ignore
                }
            }
            
            return {
                success: false,
                tempsId: null,
                tempsIds: [],
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
                const ids = Array.isArray(result.tempsIds) && result.tempsIds.length > 0
                    ? result.tempsIds
                    : (result.tempsId ? [result.tempsId] : []);
                
                if (result.success) {
                    if (result.alreadyExists) {
                        for (const id of ids) {
                            results.skipped.push({
                                OperatorCode,
                                LancementCode,
                                TempsId: id,
                                reason: 'Déjà consolidé'
                            });
                        }
                    } else {
                        for (const id of ids) {
                            results.success.push({
                                OperatorCode,
                                LancementCode,
                                TempsId: id,
                                durations: result.durations,
                                segmentsCount: result.segmentsCount || ids.length
                            });
                        }
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
                FROM ${appDb}.[dbo].[ABTEMPS_OPERATEURS]
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
                FROM ${appDb}.[dbo].[ABHISTORIQUE_OPERATEURS]
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
                UPDATE ${appDb}.[dbo].[ABTEMPS_OPERATEURS]
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
