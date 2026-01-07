/**
 * Service d'audit pour centraliser la logique d'écriture des événements
 */

const { executeNonQuery } = require('../config/database');
const { logCustomAuditEvent } = require('../middleware/audit');

class AuditService {
    /**
     * Logger une connexion opérateur
     */
    static async logOperatorLogin(operatorCode, sessionId, deviceId, ipAddress) {
        await logCustomAuditEvent({
            operatorCode,
            sessionId,
            deviceId,
            action: 'OperatorLogin',
            payloadJson: { operatorCode, sessionId, deviceId, ipAddress },
            severity: 'INFO'
        });
    }

    /**
     * Logger une déconnexion opérateur
     */
    static async logOperatorLogout(operatorCode, sessionId) {
        await logCustomAuditEvent({
            operatorCode,
            sessionId,
            action: 'OperatorLogout',
            payloadJson: { operatorCode, sessionId },
            severity: 'INFO'
        });
    }

    /**
     * Logger le démarrage d'un lancement
     */
    static async logStartLancement(operatorCode, sessionId, lancementCode, requestId) {
        await logCustomAuditEvent({
            operatorCode,
            sessionId,
            action: 'StartLancement',
            lancementCode,
            requestId,
            payloadJson: { operatorCode, lancementCode },
            severity: 'INFO'
        });
    }

    /**
     * Logger une pause
     */
    static async logPauseLancement(operatorCode, sessionId, lancementCode, requestId) {
        await logCustomAuditEvent({
            operatorCode,
            sessionId,
            action: 'PauseLancement',
            lancementCode,
            requestId,
            payloadJson: { operatorCode, lancementCode },
            severity: 'INFO'
        });
    }

    /**
     * Logger une reprise
     */
    static async logResumeLancement(operatorCode, sessionId, lancementCode, requestId) {
        await logCustomAuditEvent({
            operatorCode,
            sessionId,
            action: 'ResumeLancement',
            lancementCode,
            requestId,
            payloadJson: { operatorCode, lancementCode },
            severity: 'INFO'
        });
    }

    /**
     * Logger l'arrêt d'un lancement
     */
    static async logStopLancement(operatorCode, sessionId, lancementCode, requestId, durations) {
        await logCustomAuditEvent({
            operatorCode,
            sessionId,
            action: 'StopLancement',
            lancementCode,
            requestId,
            payloadJson: {
                operatorCode,
                lancementCode,
                durations: {
                    total: durations.totalDuration,
                    pause: durations.pauseDuration,
                    productive: durations.productiveDuration
                }
            },
            severity: 'INFO'
        });
    }

    /**
     * Logger un heartbeat
     */
    static async logHeartbeat(operatorCode, sessionId) {
        await logCustomAuditEvent({
            operatorCode,
            sessionId,
            action: 'Heartbeat',
            payloadJson: { operatorCode, sessionId },
            severity: 'INFO'
        });
    }

    /**
     * Logger une erreur
     */
    static async logError(operatorCode, sessionId, action, errorMessage, payloadJson = null) {
        await logCustomAuditEvent({
            operatorCode,
            sessionId,
            action,
            errorMessage,
            payloadJson,
            severity: 'ERROR'
        });
    }
}

module.exports = AuditService;


