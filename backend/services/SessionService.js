/**
 * Service pour gérer les sessions opérateurs avec cohérence
 * Ne jamais écraser LoginTime, toujours mettre à jour LastActivityTime
 */

const { executeQuery, executeNonQuery } = require('../config/database');

class SessionService {
    /**
     * Mettre à jour la dernière activité d'une session (sans écraser LoginTime)
     */
    static async updateLastActivity(operatorCode, sessionId = null) {
        try {
            let query;
            let params;
            
            if (sessionId) {
                // Mise à jour par SessionId (plus précis)
                query = `
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                    SET LastActivityTime = GETDATE(),
                        ActivityStatus = 'ACTIVE'
                    WHERE SessionId = @sessionId
                      AND SessionStatus = 'ACTIVE'
                `;
                params = { sessionId };
            } else {
                // Mise à jour par OperatorCode (fallback)
                query = `
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                    SET LastActivityTime = GETDATE(),
                        ActivityStatus = 'ACTIVE'
                    WHERE OperatorCode = @operatorCode
                      AND SessionStatus = 'ACTIVE'
                      AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                `;
                params = { operatorCode };
            }
            
            await executeNonQuery(query, params);
        } catch (error) {
            console.error('❌ Erreur mise à jour LastActivityTime:', error);
            // Ne pas faire échouer la requête si la mise à jour échoue
        }
    }

    /**
     * Obtenir la session active d'un opérateur
     */
    static async getActiveSession(operatorCode) {
        try {
            const query = `
                SELECT TOP 1 
                    SessionId,
                    OperatorCode,
                    LoginTime,
                    LogoutTime,
                    SessionStatus,
                    ActivityStatus,
                    LastActivityTime,
                    DeviceId,
                    IpAddress,
                    DeviceInfo
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                WHERE OperatorCode = @operatorCode
                  AND SessionStatus = 'ACTIVE'
                  AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                ORDER BY DateCreation DESC
            `;
            
            const result = await executeQuery(query, { operatorCode });
            return result.length > 0 ? result[0] : null;
        } catch (error) {
            console.error('❌ Erreur récupération session active:', error);
            return null;
        }
    }

    /**
     * Créer une nouvelle session (ferme les anciennes)
     */
    static async createSession(operatorCode, deviceId, ipAddress, deviceInfo) {
        try {
            // Fermer les sessions actives existantes
            const closeQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                SET LogoutTime = GETDATE(),
                    SessionStatus = 'CLOSED'
                WHERE OperatorCode = @operatorCode
                  AND SessionStatus = 'ACTIVE'
            `;
            await executeNonQuery(closeQuery, { operatorCode });
            
            // Créer la nouvelle session
            const createQuery = `
                INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                (OperatorCode, LoginTime, SessionStatus, DeviceId, IpAddress, DeviceInfo, LastActivityTime, ActivityStatus, DateCreation)
                VALUES (@operatorCode, GETDATE(), 'ACTIVE', @deviceId, @ipAddress, @deviceInfo, GETDATE(), 'ACTIVE', GETDATE())
            `;
            
            await executeNonQuery(createQuery, {
                operatorCode,
                deviceId: deviceId || null,
                ipAddress: ipAddress || null,
                deviceInfo: deviceInfo || null
            });
            
            // Récupérer la session créée
            return await this.getActiveSession(operatorCode);
        } catch (error) {
            console.error('❌ Erreur création session:', error);
            throw error;
        }
    }

    /**
     * Fermer une session
     */
    static async closeSession(operatorCode, sessionId = null) {
        try {
            let query;
            let params;
            
            if (sessionId) {
                query = `
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                    SET LogoutTime = GETDATE(),
                        SessionStatus = 'CLOSED',
                        ActivityStatus = 'INACTIVE'
                    WHERE SessionId = @sessionId
                `;
                params = { sessionId };
            } else {
                query = `
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                    SET LogoutTime = GETDATE(),
                        SessionStatus = 'CLOSED',
                        ActivityStatus = 'INACTIVE'
                    WHERE OperatorCode = @operatorCode
                      AND SessionStatus = 'ACTIVE'
                      AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                `;
                params = { operatorCode };
            }
            
            await executeNonQuery(query, params);
        } catch (error) {
            console.error('❌ Erreur fermeture session:', error);
            throw error;
        }
    }
}

module.exports = SessionService;


