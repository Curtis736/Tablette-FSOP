/**
 * Service de monitoring pour la gestion des enregistrements de temps
 * Permet la correction, suppression et validation des enregistrements avant transmission à SILOG
 */

const { executeQuery, executeNonQuery } = require('../config/database');

class MonitoringService {
    static _toDateOnly(value) {
        if (!value) return null;
        // SQL DATE often comes back as JS Date via mssql
        if (value instanceof Date) {
            if (isNaN(value.getTime())) return null;
            return value.toISOString().slice(0, 10); // YYYY-MM-DD
        }
        const s = String(value).trim();
        // Common formats: "2026-01-21", "2026-01-21T00:00:00.000Z"
        const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
        return null;
    }

    static _normalizeTimeString(input) {
        if (typeof input !== 'string') return null;
        const s = input.trim();
        if (!s) return null;
        // Accept "10h39" / "10H39" as well
        return s.replace(/[hH]/g, ':');
    }

    static _parseTimeParts(input) {
        if (!input) return null;
        const s = this._normalizeTimeString(String(input));
        if (!s) return null;
        const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{2}))?$/);
        if (!m) return null;
        const hh = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        const ss = m[3] ? parseInt(m[3], 10) : 0;
        if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;
        if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;
        return { hh, mm, ss };
    }

    static _timePartsToHms(parts) {
        if (!parts) return null;
        const h = String(parts.hh).padStart(2, '0');
        const m = String(parts.mm).padStart(2, '0');
        const s = String(parts.ss || 0).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    static _minutesBetweenTimes(startParts, endParts) {
        if (!startParts || !endParts) return 0;
        const start = startParts.hh * 60 + startParts.mm;
        const end = endParts.hh * 60 + endParts.mm;
        if (end >= start) return end - start;
        // Cross midnight
        return (24 * 60 - start) + end;
    }

    /**
     * Réparer StartTime/EndTime/durations depuis ABHISTORIQUE_OPERATEURS (utile si Start/End = 00:00)
     * @param {number} tempsId
     * @returns {Promise<{success:boolean,message?:string,error?:string,data?:any}>}
     */
    static async repairRecordTimes(tempsId) {
        try {
            // 1) Charger l'enregistrement
            const recQuery = `
                SELECT TempsId, OperatorCode, LancementCode, StartTime, EndTime, DateCreation, StatutTraitement
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE TempsId = @tempsId
            `;
            const recs = await executeQuery(recQuery, { tempsId });
            if (!recs || recs.length === 0) {
                return { success: false, error: 'Enregistrement non trouvé' };
            }
            const rec = recs[0];

            // 2) Détecter si CreatedAt existe dans ABHISTORIQUE_OPERATEURS
            const colQuery = `
                SELECT COUNT(*) as cnt
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = 'dbo'
                  AND TABLE_NAME = 'ABHISTORIQUE_OPERATEURS'
                  AND COLUMN_NAME = 'CreatedAt'
            `;
            const col = await executeQuery(colQuery);
            const hasCreatedAt = (col?.[0]?.cnt || 0) > 0;

            // 3) Charger les événements du jour pour ce couple (OperatorCode, LancementCode)
            const eventsQuery = `
                SELECT Ident, Statut, DateCreation, HeureDebut, HeureFin${hasCreatedAt ? ', CreatedAt' : ''}
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorCode
                  AND CodeLanctImprod = @lancementCode
                  AND CAST(DateCreation AS DATE) = @date
                ORDER BY ${hasCreatedAt ? 'CreatedAt' : 'DateCreation'} ASC
            `;
            const dateOnly = rec.DateCreation ? String(rec.DateCreation).substring(0, 10) : null;
            const events = await executeQuery(eventsQuery, {
                operatorCode: rec.OperatorCode,
                lancementCode: rec.LancementCode,
                date: dateOnly
            });

            if (!events || events.length === 0) {
                return { success: false, error: 'Aucun événement trouvé pour recalculer les heures' };
            }

            const extractTime = (timeValue) => {
                if (!timeValue) return null;
                if (typeof timeValue === 'string') {
                    const m = timeValue.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
                    if (m) return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) };
                }
                if (timeValue instanceof Date) return { hour: timeValue.getHours(), minute: timeValue.getMinutes() };
                if (typeof timeValue === 'object' && timeValue.hour !== undefined && timeValue.minute !== undefined) {
                    return { hour: parseInt(timeValue.hour, 10), minute: parseInt(timeValue.minute, 10) };
                }
                return null;
            };

            const buildDateTime = (event, kind /* 'start'|'end' */) => {
                const createdAt = event.CreatedAt;
                if (createdAt) {
                    const d = new Date(createdAt);
                    if (!isNaN(d.getTime())) return d;
                }
                const base = new Date(event.DateCreation);
                if (!isNaN(base.getTime())) {
                    const t = extractTime(kind === 'start' ? event.HeureDebut : event.HeureFin);
                    if (t) base.setHours(t.hour, t.minute, 0, 0);
                    return base;
                }
                return new Date();
            };

            const debut = events.find(e => e.Ident === 'DEBUT') || events[0];
            const fin = [...events].reverse().find(e => e.Ident === 'FIN') || events[events.length - 1];

            const newStart = buildDateTime(debut, 'start');
            const newEnd = buildDateTime(fin, 'end');

            // 4) Recalculer les durées depuis les événements
            const DurationCalculationService = require('./DurationCalculationService');
            const durations = DurationCalculationService.calculateDurations(events);

            // 5) Mettre à jour ABTEMPS_OPERATEURS (même si StatutTraitement = 'T' : correction de données)
            const updateQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET StartTime = @startTime,
                    EndTime = @endTime,
                    TotalDuration = @totalDuration,
                    PauseDuration = @pauseDuration,
                    ProductiveDuration = @productiveDuration,
                    EventsCount = @eventsCount,
                    CalculatedAt = GETDATE(),
                    CalculationMethod = 'EVENTS_BASED'
                WHERE TempsId = @tempsId
            `;
            await executeNonQuery(updateQuery, {
                tempsId,
                startTime: newStart,
                endTime: newEnd,
                totalDuration: durations.totalDuration,
                pauseDuration: durations.pauseDuration,
                productiveDuration: durations.productiveDuration,
                eventsCount: durations.eventsCount
            });

            return {
                success: true,
                message: 'Heures réparées depuis les événements',
                data: {
                    tempsId,
                    operatorCode: rec.OperatorCode,
                    lancementCode: rec.LancementCode,
                    startTime: newStart,
                    endTime: newEnd,
                    durations
                }
            };
        } catch (error) {
            console.error('❌ Erreur repairRecordTimes:', error);
            return { success: false, error: error.message };
        }
    }
    /**
     * Récupérer tous les enregistrements de temps avec leurs détails
     * @param {Object} filters - Filtres optionnels (statutTraitement, operatorCode, lancementCode, date)
     * @returns {Promise<Array>} Liste des enregistrements
     */
    static async getTempsRecords(filters = {}) {
        try {
            const { statutTraitement, operatorCode, lancementCode, date, dateStart, dateEnd, includeAllStatuses } = filters;
            const includeAll = includeAllStatuses === true
                || String(includeAllStatuses || '').toLowerCase() === 'true'
                || String(includeAllStatuses || '') === '1';
            
            let whereConditions = [];
            const params = {};

            // In scheduled/disabled mode, validated records (StatutTraitement='O') are expected to be consumed by SILOG
            // via a Windows Scheduled Task. They should not clutter the default admin dashboard list.
            // If the caller explicitly requests statutTraitement, we respect it.
            const remoteMode = String(process.env.SILOG_REMOTE_MODE || '').trim().toLowerCase();
            const isScheduledMode = ['scheduled', 'disable', 'disabled', 'none'].includes(remoteMode);
            if (isScheduledMode && statutTraitement === undefined && !includeAll) {
                // Default view: show only actionable records (NULL or 'A' = on hold)
                whereConditions.push("(t.StatutTraitement IS NULL OR t.StatutTraitement = 'A')");
            }
            
            if (statutTraitement !== undefined) {
                if (statutTraitement === null || statutTraitement === 'NULL') {
                    whereConditions.push('t.StatutTraitement IS NULL');
                } else {
                    whereConditions.push('t.StatutTraitement = @statutTraitement');
                    params.statutTraitement = statutTraitement;
                }
            }
            
            if (operatorCode) {
                whereConditions.push('t.OperatorCode = @operatorCode');
                params.operatorCode = operatorCode;
            }
            
            if (lancementCode) {
                whereConditions.push('t.LancementCode = @lancementCode');
                params.lancementCode = lancementCode;
            }
            
            // Date filters:
            // - date: exact day (YYYY-MM-DD)
            // - dateStart/dateEnd: inclusive range (YYYY-MM-DD)
            if (date) {
                // ⚡ SARGABLE: support DATE or DATETIME columns without CAST(DateCreation AS DATE)
                whereConditions.push('t.DateCreation >= @date AND t.DateCreation < DATEADD(day, 1, @date)');
                params.date = date;
            } else if (dateStart || dateEnd) {
                if (dateStart) {
                    whereConditions.push('t.DateCreation >= @dateStart');
                    params.dateStart = dateStart;
                }
                if (dateEnd) {
                    // inclusive end date => < end+1 day (works for DATE and DATETIME)
                    whereConditions.push('t.DateCreation < DATEADD(day, 1, @dateEnd)');
                    params.dateEnd = dateEnd;
                }
            }
            
            const whereClause = whereConditions.length > 0 
                ? 'WHERE ' + whereConditions.join(' AND ')
                : '';
            
            const query = `
                SELECT 
                    t.TempsId,
                    t.OperatorCode,
                    r.Designation1 AS OperatorName,
                    t.LancementCode,
                    l.DesignationLct1 AS LancementName,
                    -- IMPORTANT: renvoyer des heures "HH:mm" (pas d'ISO UTC) pour éviter les décalages timezone côté frontend
                    CONVERT(VARCHAR(5), t.StartTime, 108) AS StartTime,
                    CONVERT(VARCHAR(5), t.EndTime, 108) AS EndTime,
                    t.TotalDuration,
                    t.PauseDuration,
                    t.ProductiveDuration,
                    t.EventsCount,
                    t.Phase,
                    t.CodeRubrique,
                    t.StatutTraitement,
                    t.DateCreation,
                    t.CalculatedAt,
                    t.CalculationMethod
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t WITH (NOLOCK)
                LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r WITH (NOLOCK) ON t.OperatorCode = r.Coderessource
                LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l WITH (NOLOCK) ON t.LancementCode = l.CodeLancement
                ${whereClause}
                ORDER BY t.DateCreation DESC, t.TempsId DESC
            `;
            
            const records = await executeQuery(query, params);
            
            return {
                success: true,
                data: records,
                count: records.length
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de la récupération des enregistrements:', error);
            return {
                success: false,
                error: error.message,
                data: []
            };
        }
    }
    
    /**
     * Corriger un enregistrement de temps
     * @param {number} tempsId - ID de l'enregistrement
     * @param {Object} corrections - Données à corriger (Phase, CodeRubrique, TotalDuration, etc.)
     * @returns {Promise<Object>} Résultat de la correction
     */
    static async correctRecord(tempsId, corrections) {
        try {
            // Vérifier que l'enregistrement existe et n'est pas déjà transmis
            const checkQuery = `
                SELECT TempsId, StatutTraitement
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE TempsId = @tempsId
            `;
            
            const existing = await executeQuery(checkQuery, { tempsId });
            
            if (existing.length === 0) {
                return {
                    success: false,
                    error: 'Enregistrement non trouvé'
                };
            }
            
            if (existing[0].StatutTraitement === 'T') {
                return {
                    success: false,
                    error: 'Impossible de corriger un enregistrement déjà transmis à SILOG'
                };
            }

            // Charger les valeurs actuelles (pour recalcul cohérent si Start/End changent)
            const currentQuery = `
                SELECT TempsId, DateCreation, OperatorCode, LancementCode, Phase, CodeRubrique,
                       StartTime, EndTime, TotalDuration, PauseDuration, ProductiveDuration
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE TempsId = @tempsId
            `;
            const currentRows = await executeQuery(currentQuery, { tempsId });
            const current = currentRows?.[0] || null;
            // Date (YYYY-MM-DD) de l'enregistrement pour construire StartTime/EndTime côté SQL (sans décalage timezone)
            const dateOnly = this._toDateOnly(current?.DateCreation);
            
            // Construire la requête de mise à jour
            const updateFields = [];
            const updateParams = { tempsId };

            // Normaliser (supporte lancementCode ou LancementCode)
            const requestedLancementCode = corrections?.LancementCode ?? corrections?.lancementCode;
            const requestedLancementCodeTrimmed = requestedLancementCode !== undefined && requestedLancementCode !== null
                ? String(requestedLancementCode).trim().toUpperCase()
                : undefined;

            if (requestedLancementCodeTrimmed !== undefined) {
                if (!/^LT\d{7,8}$/.test(requestedLancementCodeTrimmed)) {
                    return {
                        success: false,
                        error: 'Format de lancement invalide (attendu: LT########)'
                    };
                }
                updateFields.push('LancementCode = @newLancementCode');
                updateParams.newLancementCode = requestedLancementCodeTrimmed;
            }
            
            if (corrections.Phase !== undefined) {
                updateFields.push('Phase = @phase');
                updateParams.phase = corrections.Phase;
            }
            
            if (corrections.CodeRubrique !== undefined) {
                updateFields.push('CodeRubrique = @codeRubrique');
                updateParams.codeRubrique = corrections.CodeRubrique;
            }
            
            // IMPORTANT: Si TotalDuration ou PauseDuration sont modifiés, recalculer ProductiveDuration automatiquement
            let shouldRecalculateProductive = false;
            
            if (corrections.TotalDuration !== undefined) {
                updateFields.push('TotalDuration = @totalDuration');
                updateParams.totalDuration = parseInt(corrections.TotalDuration);
                shouldRecalculateProductive = true;
            }
            
            if (corrections.PauseDuration !== undefined) {
                updateFields.push('PauseDuration = @pauseDuration');
                updateParams.pauseDuration = parseInt(corrections.PauseDuration);
                shouldRecalculateProductive = true;
            }
            
            if (corrections.ProductiveDuration !== undefined && !shouldRecalculateProductive) {
                // Si ProductiveDuration est modifié directement (sans modifier TotalDuration/PauseDuration)
                updateFields.push('ProductiveDuration = @productiveDuration');
                updateParams.productiveDuration = parseInt(corrections.ProductiveDuration);
            } else if (shouldRecalculateProductive) {
                // Recalculer ProductiveDuration = TotalDuration - PauseDuration
                // Utiliser les nouvelles valeurs si fournies, sinon récupérer depuis la base
                const newTotalDuration = corrections.TotalDuration !== undefined 
                    ? parseInt(corrections.TotalDuration) 
                    : null;
                const newPauseDuration = corrections.PauseDuration !== undefined 
                    ? parseInt(corrections.PauseDuration) 
                    : null;
                
                if (newTotalDuration !== null && newPauseDuration !== null) {
                    // Les deux valeurs sont fournies, calculer directement
                    const calculatedProductive = Math.max(0, newTotalDuration - newPauseDuration);
                    updateFields.push('ProductiveDuration = @productiveDuration');
                    updateParams.productiveDuration = calculatedProductive;
                    console.log(`🔄 ProductiveDuration recalculé automatiquement: ${calculatedProductive} minutes (Total=${newTotalDuration} - Pause=${newPauseDuration})`);
                } else {
                    // Une seule valeur modifiée, récupérer l'autre depuis la base et recalculer
                    const currentRecordQuery = `
                        SELECT TotalDuration, PauseDuration
                        FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                        WHERE TempsId = @tempsId
                    `;
                    const currentRecord = await executeQuery(currentRecordQuery, { tempsId });
                    
                    if (currentRecord.length > 0) {
                        const totalDuration = newTotalDuration !== null ? newTotalDuration : currentRecord[0].TotalDuration;
                        const pauseDuration = newPauseDuration !== null ? newPauseDuration : currentRecord[0].PauseDuration;
                        const calculatedProductive = Math.max(0, totalDuration - pauseDuration);
                        updateFields.push('ProductiveDuration = @productiveDuration');
                        updateParams.productiveDuration = calculatedProductive;
                        console.log(`🔄 ProductiveDuration recalculé automatiquement: ${calculatedProductive} minutes (Total=${totalDuration} - Pause=${pauseDuration})`);
                    }
                }
            }
            
            if (corrections.StartTime !== undefined) {
                const parts = this._parseTimeParts(corrections.StartTime);
                if (parts && dateOnly) {
                    updateFields.push("StartTime = DATEADD(SECOND, DATEDIFF(SECOND, '00:00:00', CAST(@startTimeHms AS TIME)), CAST(@date AS DATETIME2))");
                    updateParams.startTimeHms = this._timePartsToHms(parts);
                    updateParams.date = dateOnly;
                } else {
                    // Fallback: assume full datetime string
                updateFields.push('StartTime = @startTime');
                updateParams.startTime = corrections.StartTime;
                }
            }
            
            if (corrections.EndTime !== undefined) {
                const parts = this._parseTimeParts(corrections.EndTime);
                if (parts && dateOnly) {
                    updateFields.push("EndTime = DATEADD(SECOND, DATEDIFF(SECOND, '00:00:00', CAST(@endTimeHms AS TIME)), CAST(@date AS DATETIME2))");
                    updateParams.endTimeHms = this._timePartsToHms(parts);
                    updateParams.date = dateOnly;
                } else {
                    // Fallback: assume full datetime string
                updateFields.push('EndTime = @endTime');
                updateParams.endTime = corrections.EndTime;
                }
            }

            // IMPORTANT: Si StartTime/EndTime sont modifiés, recalculer automatiquement TotalDuration/ProductiveDuration
            // (sinon on peut avoir Start/End corrects mais ProductiveDuration = 0, rejet SILOG)
            const shouldRecalculateFromTimes =
                (corrections.StartTime !== undefined || corrections.EndTime !== undefined) &&
                (corrections.TotalDuration === undefined && corrections.PauseDuration === undefined && corrections.ProductiveDuration === undefined);

            if (shouldRecalculateFromTimes) {
                const startParts = corrections.StartTime !== undefined
                    ? this._parseTimeParts(corrections.StartTime)
                    : this._parseTimeParts(current?.StartTime ? new Date(current.StartTime).toTimeString().substring(0, 5) : null);

                const endParts = corrections.EndTime !== undefined
                    ? this._parseTimeParts(corrections.EndTime)
                    : this._parseTimeParts(current?.EndTime ? new Date(current.EndTime).toTimeString().substring(0, 5) : null);

                if (startParts && endParts) {
                    const total = this._minutesBetweenTimes(startParts, endParts);
                    const pause = Number.isFinite(current?.PauseDuration) ? (current.PauseDuration || 0) : 0;
                    const productive = Math.max(0, total - pause);

                    updateFields.push('TotalDuration = @totalDuration');
                    updateParams.totalDuration = total;

                    updateFields.push('ProductiveDuration = @productiveDuration');
                    updateParams.productiveDuration = productive;

                    updateFields.push("CalculationMethod = 'MANUAL_TIMES'");
                    console.log(`🔄 Recalcul durées depuis Start/End: Total=${total}min, Pause=${pause}min, Productif=${productive}min`);
                }
            }
            
            if (updateFields.length === 0) {
                return {
                    success: false,
                    error: 'Aucune correction à appliquer'
                };
            }
            
            // Réinitialiser le statut de traitement si nécessaire (pour permettre une nouvelle validation)
            if (existing[0].StatutTraitement === 'O' || existing[0].StatutTraitement === 'A') {
                updateFields.push('StatutTraitement = NULL');
            }
            
            const updateQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET ${updateFields.join(', ')}, CalculatedAt = GETDATE()
                WHERE TempsId = @tempsId
            `;
            
            const result = await executeNonQuery(updateQuery, updateParams);

            // Si le lancement a changé, déplacer aussi les événements ABHISTORIQUE de la même étape (opérateur+phase+rubrique+jour)
            if (requestedLancementCodeTrimmed !== undefined && current) {
                const oldLt = String(current.LancementCode || '').trim().toUpperCase();
                const newLt = requestedLancementCodeTrimmed;
                if (oldLt && newLt && oldLt !== newLt) {
                    const operatorCode = String(current.OperatorCode || '').trim();
                    const phase = String((corrections?.Phase ?? current.Phase ?? '')).trim();
                    const codeRubrique = String((corrections?.CodeRubrique ?? current.CodeRubrique ?? '')).trim();
                    const date = dateOnly;

                    if (operatorCode && date) {
                        const moveQuery = `
                            UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                            SET CodeLanctImprod = @newLt
                            WHERE OperatorCode = @operatorCode
                              AND CodeLanctImprod = @oldLt
                              AND ISNULL(LTRIM(RTRIM(Phase)), '') = ISNULL(LTRIM(RTRIM(@phase)), '')
                              AND ISNULL(LTRIM(RTRIM(CodeRubrique)), '') = ISNULL(LTRIM(RTRIM(@codeRubrique)), '')
                              AND CAST(DateCreation AS DATE) = @date
                        `;
                        await executeNonQuery(moveQuery, {
                            newLt,
                            operatorCode,
                            oldLt,
                            phase: phase || null,
                            codeRubrique: codeRubrique || null,
                            date
                        });
                    }
                }
            }
            
            if (result.rowsAffected > 0) {
                console.log(`✅ Enregistrement ${tempsId} corrigé avec succès`);
                return {
                    success: true,
                    message: 'Enregistrement corrigé avec succès',
                    tempsId: tempsId
                };
            } else {
                return {
                    success: false,
                    error: 'Aucune ligne affectée'
                };
            }
            
        } catch (error) {
            console.error('❌ Erreur lors de la correction:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Supprimer un enregistrement de temps
     * @param {number} tempsId - ID de l'enregistrement
     * @returns {Promise<Object>} Résultat de la suppression
     */
    static async deleteRecord(tempsId) {
        try {
            // Vérifier que l'enregistrement existe et n'est pas déjà transmis
            const checkQuery = `
                SELECT TempsId, StatutTraitement
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE TempsId = @tempsId
            `;
            
            const existing = await executeQuery(checkQuery, { tempsId });
            
            if (existing.length === 0) {
                return {
                    success: false,
                    error: 'Enregistrement non trouvé'
                };
            }
            
            if (existing[0].StatutTraitement === 'T') {
                return {
                    success: false,
                    error: 'Impossible de supprimer un enregistrement déjà transmis à SILOG'
                };
            }
            
            const deleteQuery = `
                DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE TempsId = @tempsId
            `;
            
            const result = await executeNonQuery(deleteQuery, { tempsId });
            
            if (result.rowsAffected > 0) {
                console.log(`✅ Enregistrement ${tempsId} supprimé avec succès`);
                return {
                    success: true,
                    message: 'Enregistrement supprimé avec succès',
                    tempsId: tempsId
                };
            } else {
                return {
                    success: false,
                    error: 'Aucune ligne affectée'
                };
            }
            
        } catch (error) {
            console.error('❌ Erreur lors de la suppression:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Valider un enregistrement (StatutTraitement = 'O')
     * @param {number} tempsId - ID de l'enregistrement
     * @returns {Promise<Object>} Résultat de la validation
     */
    static async validateRecord(tempsId) {
        try {
            const updateQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET StatutTraitement = 'O'
                WHERE TempsId = @tempsId
            `;
            
            const result = await executeNonQuery(updateQuery, { tempsId });
            
            if (result.rowsAffected > 0) {
                console.log(`✅ Enregistrement ${tempsId} validé`);
                return {
                    success: true,
                    message: 'Enregistrement validé avec succès',
                    tempsId: tempsId,
                    statutTraitement: 'O'
                };
            } else {
                return {
                    success: false,
                    error: 'Enregistrement non trouvé'
                };
            }
            
        } catch (error) {
            console.error('❌ Erreur lors de la validation:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Mettre en attente un enregistrement (StatutTraitement = 'A')
     * @param {number} tempsId - ID de l'enregistrement
     * @returns {Promise<Object>} Résultat de la mise en attente
     */
    static async setOnHold(tempsId) {
        try {
            const updateQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET StatutTraitement = 'A'
                WHERE TempsId = @tempsId
            `;
            
            const result = await executeNonQuery(updateQuery, { tempsId });
            
            if (result.rowsAffected > 0) {
                console.log(`✅ Enregistrement ${tempsId} mis en attente`);
                return {
                    success: true,
                    message: 'Enregistrement mis en attente',
                    tempsId: tempsId,
                    statutTraitement: 'A'
                };
            } else {
                return {
                    success: false,
                    error: 'Enregistrement non trouvé'
                };
            }
            
        } catch (error) {
            console.error('❌ Erreur lors de la mise en attente:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Marquer un enregistrement comme transmis (StatutTraitement = 'T')
     * @param {number} tempsId - ID de l'enregistrement
     * @param {Object} options - Options (autoFix: boolean)
     * @returns {Promise<Object>} Résultat de la transmission
     */
    static async markAsTransmitted(tempsId, options = {}) {
        try {
            const { autoFix = true } = options;
            
            // Validation préalable avec le service de validation
            const OperationValidationService = require('./OperationValidationService');
            const validation = await OperationValidationService.validateTransferData(tempsId);
            
            if (!validation.valid) {
                // Auto-correction si activée
                if (autoFix) {
                    console.log(`🔧 Tentative d'auto-correction pour TempsId=${tempsId}...`);
                    const fixed = await OperationValidationService.autoFixTransferData(tempsId);
                    
                    if (fixed.fixed) {
                        console.log(`✅ Auto-corrections appliquées:`, fixed.fixes);
                        // Re-valider après correction
                        const revalidation = await OperationValidationService.validateTransferData(tempsId);
                        if (!revalidation.valid) {
                            return {
                                success: false,
                                error: `Opération invalide après auto-correction: ${revalidation.errors.join(', ')}`,
                                validationErrors: revalidation.errors
                            };
                        }
                    } else {
                        // Auto-correction impossible
                        return {
                            success: false,
                            error: `Opération invalide: ${validation.errors.join(', ')}`,
                            validationErrors: validation.errors
                        };
                    }
                } else {
                    // Auto-correction désactivée
                    return {
                        success: false,
                        error: `Opération invalide: ${validation.errors.join(', ')}`,
                        validationErrors: validation.errors
                    };
                }
            }
            
            // Vérifier que l'enregistrement est validé
            const checkQuery = `
                SELECT TempsId, StatutTraitement
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE TempsId = @tempsId
            `;
            
            const existing = await executeQuery(checkQuery, { tempsId });
            
            if (existing.length === 0) {
                return {
                    success: false,
                    error: 'Enregistrement non trouvé'
                };
            }
            
            if (existing[0].StatutTraitement !== 'O') {
                return {
                    success: false,
                    error: 'L\'enregistrement doit être validé (StatutTraitement = \'O\') avant d\'être transmis',
                    currentStatut: existing[0].StatutTraitement
                };
            }
            
            const updateQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET StatutTraitement = 'T'
                WHERE TempsId = @tempsId
            `;
            
            const result = await executeNonQuery(updateQuery, { tempsId });
            
            if (result.rowsAffected > 0) {
                console.log(`✅ Enregistrement ${tempsId} marqué comme transmis`);
                return {
                    success: true,
                    message: 'Enregistrement marqué comme transmis',
                    tempsId: tempsId,
                    statutTraitement: 'T'
                };
            } else {
                return {
                    success: false,
                    error: 'Aucune ligne affectée'
                };
            }
            
        } catch (error) {
            console.error('❌ Erreur lors du marquage comme transmis:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Valider et transmettre un lot d'enregistrements
     * @param {Array<number>} tempsIds - Liste des IDs d'enregistrements
     * @param {Object} options - Options (autoFix: boolean)
     * @returns {Promise<Object>} Résultat de la validation/transmission
     */
    static async validateAndTransmitBatch(tempsIds, options = {}) {
        try {
            const { autoFix = true } = options;
            
            if (!Array.isArray(tempsIds) || tempsIds.length === 0) {
                return {
                    success: false,
                    error: 'Liste d\'IDs invalide'
                };
            }
            
            const OperationValidationService = require('./OperationValidationService');
            const validIds = [];
            const invalidIds = [];
            const fixedIds = [];
            
            // 1. Vérifier que les enregistrements existent et récupérer leurs données
            // IMPORTANT:
            // - La vue V_REMONTE_TEMPS (côté SILOG) doit remonter uniquement les lignes VALIDÉES (StatutTraitement='O').
            // - On accepte donc ici les lignes en StatutTraitement NULL (à valider) ou 'O' (déjà validées).
            // - On exclut 'A' (en attente) et 'T' (déjà transmis).
            const { executeQuery } = require('../config/database');
            const checkQuery = `
                SELECT TempsId, OperatorCode, LancementCode, StartTime, EndTime, StatutTraitement, ProductiveDuration
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE TempsId IN (${tempsIds.map((_, i) => `@id${i}`).join(', ')})
            `;
            const checkParams = {};
            tempsIds.forEach((id, i) => {
                checkParams[`id${i}`] = id;
            });
            const existingRecords = await executeQuery(checkQuery, checkParams);
            
            if (existingRecords.length === 0) {
                return {
                    success: false,
                    error: 'Aucun enregistrement trouvé pour les IDs fournis'
                };
            }
            
            // 2. Réparer les heures si elles sont à 00:00 (problème historique) puis valider chaque enregistrement
            for (const record of existingRecords) {
                const tempsId = record.TempsId;

                // Filtrer selon StatutTraitement
                const stt = record.StatutTraitement;
                if (stt === 'T') {
                    invalidIds.push({ tempsId, errors: [`Enregistrement déjà transmis (StatutTraitement='T').`] });
                    continue;
                }
                if (stt === 'A') {
                    invalidIds.push({ tempsId, errors: [`Enregistrement en attente (StatutTraitement='A').`] });
                    continue;
                }
                if (!(stt === null || stt === undefined || stt === 'O')) {
                    invalidIds.push({ tempsId, errors: [`StatutTraitement invalide: ${stt}`] });
                    continue;
                }

                // Réparer si StartTime/EndTime tombent à minuit (souvent DateCreation sans heure)
                try {
                    const st = new Date(record.StartTime);
                    const et = new Date(record.EndTime);
                    const isMidnight = (d) => !isNaN(d.getTime()) && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
                    if (isMidnight(st) && isMidnight(et)) {
                        console.log(`🛠️ Repair heures (00:00) pour TempsId=${tempsId}...`);
                        await this.repairRecordTimes(tempsId);
                    }
                } catch (e) {
                    // noop
                }
                
                // Vérifier les champs obligatoires
                if (!record.OperatorCode || !record.LancementCode || !record.StartTime || !record.EndTime) {
                    invalidIds.push({
                        tempsId,
                        errors: ['Champs obligatoires manquants (OperatorCode, LancementCode, StartTime, EndTime)']
                    });
                    continue;
                }
                
                // IMPORTANT: SILOG n'accepte pas les enregistrements avec ProductiveDuration = 0
                // Exclure ces enregistrements du transfert
                const productiveDuration = record.ProductiveDuration || 0;
                if (productiveDuration <= 0) {
                    invalidIds.push({
                        tempsId,
                        errors: [`ProductiveDuration doit être > 0 pour être accepté par SILOG. Valeur actuelle: ${productiveDuration} minutes`]
                    });
                    continue;
                }
                
                // NOTE: On accepte aussi les enregistrements déjà validés ('O') pour permettre une ré-exécution
                // (idempotence côté SILOG via ETEMPS.VarNumUtil2 / tempsId).
                
                // Validation optionnelle (vérifier cohérence des durées, etc.)
                const validation = await OperationValidationService.validateTransferData(tempsId);
                
                if (!validation.valid) {
                    // Auto-correction si activée
                    if (autoFix) {
                        console.log(`🔧 Tentative d'auto-correction pour TempsId=${tempsId}...`);
                        const fixed = await OperationValidationService.autoFixTransferData(tempsId);
                        
                        if (fixed.fixed) {
                            console.log(`✅ Auto-corrections appliquées pour TempsId=${tempsId}:`, fixed.fixes);
                            fixedIds.push(tempsId);
                            
                            // Re-valider après correction
                            const revalidation = await OperationValidationService.validateTransferData(tempsId);
                            if (revalidation.valid) {
                                validIds.push(tempsId);
                            } else {
                                // Même si la validation échoue après correction, on peut quand même valider si les champs obligatoires sont présents
                                console.warn(`⚠️ Validation échouée après correction pour TempsId=${tempsId}, mais champs obligatoires présents - inclusion quand même`);
                                validIds.push(tempsId);
                            }
                        } else {
                            // Même si l'auto-correction échoue, on peut valider si les champs obligatoires sont présents
                            console.warn(`⚠️ Auto-correction impossible pour TempsId=${tempsId}, mais champs obligatoires présents - inclusion quand même`);
                            validIds.push(tempsId);
                        }
                    } else {
                        // Même sans auto-correction, on peut valider si les champs obligatoires sont présents
                        console.warn(`⚠️ Validation échouée pour TempsId=${tempsId}, mais champs obligatoires présents - inclusion quand même`);
                        validIds.push(tempsId);
                    }
                } else {
                    validIds.push(tempsId);
                }
            }
            
            if (validIds.length === 0) {
                return {
                    success: false,
                    error: 'Aucun enregistrement valide à transmettre',
                    invalidIds: invalidIds
                };
            }
            
            if (invalidIds.length > 0) {
                console.warn(`⚠️ ${invalidIds.length} enregistrement(s) invalide(s) ignoré(s)`);
            }
            
            // 3. Valider tous les enregistrements valides (StatutTraitement = 'O')
            // ⚠️ Ne pas marquer 'T' ici: l'EDI_JOB doit d'abord consommer les lignes validées via V_REMONTE_TEMPS.
            const validateQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET StatutTraitement = 'O'
                WHERE TempsId IN (${validIds.map((_, i) => `@id${i}`).join(', ')})
            `;
            
            const validateParams = {};
            validIds.forEach((id, i) => {
                validateParams[`id${i}`] = id;
            });
            
            await executeNonQuery(validateQuery, validateParams);
            
            return {
                success: true,
                message: `${validIds.length} enregistrements validés`,
                count: validIds.length,
                validatedIds: validIds,
                fixedCount: fixedIds.length,
                invalidCount: invalidIds.length,
                invalidIds: invalidIds.length > 0 ? invalidIds : undefined
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de la validation/transmission par lot:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Marquer un lot comme transmis (StatutTraitement='T') après succès EDI_JOB.
     * Ne bascule en 'T' que les lignes actuellement en 'O' (validées).
     */
    static async markBatchAsTransmitted(tempsIds) {
        try {
            if (!Array.isArray(tempsIds) || tempsIds.length === 0) {
                return { success: false, error: 'Liste d\'IDs invalide' };
            }
            const params = {};
            const placeholders = tempsIds.map((id, i) => {
                params[`id${i}`] = id;
                return `@id${i}`;
            }).join(', ');
            const q = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET StatutTraitement = 'T'
                WHERE TempsId IN (${placeholders})
                  AND StatutTraitement = 'O'
            `;
            const r = await executeNonQuery(q, params);
            return { success: true, count: r.rowsAffected };
        } catch (error) {
            console.error('❌ Erreur markBatchAsTransmitted:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = MonitoringService;

