/**
 * Service de monitoring pour la gestion des enregistrements de temps
 * Permet la correction, suppression et validation des enregistrements avant transmission à SILOG
 */

const { executeQuery, executeNonQuery } = require('../config/database');

class MonitoringService {
    /**
     * Récupérer tous les enregistrements de temps avec leurs détails
     * @param {Object} filters - Filtres optionnels (statutTraitement, operatorCode, lancementCode, date)
     * @returns {Promise<Array>} Liste des enregistrements
     */
    static async getTempsRecords(filters = {}) {
        try {
            const { statutTraitement, operatorCode, lancementCode, date } = filters;
            
            let whereConditions = [];
            const params = {};
            
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
            
            if (date) {
                whereConditions.push('CAST(t.DateCreation AS DATE) = @date');
                params.date = date;
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
                    t.StartTime,
                    t.EndTime,
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
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
                LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON t.OperatorCode = r.Coderessource
                LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l ON t.LancementCode = l.CodeLancement
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
            
            // Construire la requête de mise à jour
            const updateFields = [];
            const updateParams = { tempsId };
            
            if (corrections.Phase !== undefined) {
                updateFields.push('Phase = @phase');
                updateParams.phase = corrections.Phase;
            }
            
            if (corrections.CodeRubrique !== undefined) {
                updateFields.push('CodeRubrique = @codeRubrique');
                updateParams.codeRubrique = corrections.CodeRubrique;
            }
            
            if (corrections.TotalDuration !== undefined) {
                updateFields.push('TotalDuration = @totalDuration');
                updateParams.totalDuration = parseInt(corrections.TotalDuration);
            }
            
            if (corrections.PauseDuration !== undefined) {
                updateFields.push('PauseDuration = @pauseDuration');
                updateParams.pauseDuration = parseInt(corrections.PauseDuration);
            }
            
            if (corrections.ProductiveDuration !== undefined) {
                updateFields.push('ProductiveDuration = @productiveDuration');
                updateParams.productiveDuration = parseInt(corrections.ProductiveDuration);
            }
            
            if (corrections.StartTime !== undefined) {
                updateFields.push('StartTime = @startTime');
                updateParams.startTime = corrections.StartTime;
            }
            
            if (corrections.EndTime !== undefined) {
                updateFields.push('EndTime = @endTime');
                updateParams.endTime = corrections.EndTime;
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
     * @returns {Promise<Object>} Résultat de la transmission
     */
    static async markAsTransmitted(tempsId) {
        try {
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
                    error: 'L\'enregistrement doit être validé (StatutTraitement = \'O\') avant d\'être transmis'
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
     * @returns {Promise<Object>} Résultat de la validation/transmission
     */
    static async validateAndTransmitBatch(tempsIds) {
        try {
            if (!Array.isArray(tempsIds) || tempsIds.length === 0) {
                return {
                    success: false,
                    error: 'Liste d\'IDs invalide'
                };
            }
            
            // Valider tous les enregistrements
            const validateQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET StatutTraitement = 'O'
                WHERE TempsId IN (${tempsIds.map((_, i) => `@id${i}`).join(', ')})
            `;
            
            const validateParams = {};
            tempsIds.forEach((id, i) => {
                validateParams[`id${i}`] = id;
            });
            
            await executeNonQuery(validateQuery, validateParams);
            
            // Marquer comme transmis
            const transmitQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET StatutTraitement = 'T'
                WHERE TempsId IN (${tempsIds.map((_, i) => `@id${i}`).join(', ')})
            `;
            
            const result = await executeNonQuery(transmitQuery, validateParams);
            
            console.log(`✅ ${result.rowsAffected} enregistrements validés et marqués comme transmis`);
            
            return {
                success: true,
                message: `${result.rowsAffected} enregistrements validés et marqués comme transmis`,
                count: result.rowsAffected
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de la validation/transmission par lot:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = MonitoringService;

