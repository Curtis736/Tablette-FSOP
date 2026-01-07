/**
 * Middleware d'audit pour tracer toutes les requêtes API
 * Écrit dans AB_AUDIT_EVENTS pour cohérence des logs
 */

const { executeQuery, executeNonQuery } = require('../config/database');

// Cache pour éviter les requêtes répétées
const sessionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Obtenir ou mettre en cache les informations de session
 */
async function getSessionInfo(operatorCode) {
    const cacheKey = `${operatorCode}_${new Date().toISOString().split('T')[0]}`;
    const cached = sessionCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.data;
    }
    
    try {
        const query = `
            SELECT TOP 1 SessionId, DeviceId, IpAddress
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
            WHERE OperatorCode = @operatorCode
              AND SessionStatus = 'ACTIVE'
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        
        const result = await executeQuery(query, { operatorCode });
        const sessionInfo = result.length > 0 ? result[0] : null;
        
        sessionCache.set(cacheKey, {
            data: sessionInfo,
            timestamp: Date.now()
        });
        
        return sessionInfo;
    } catch (error) {
        console.error('Erreur récupération session pour audit:', error);
        return null;
    }
}

/**
 * Générer un ID de corrélation unique
 */
function generateCorrelationId() {
    return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Générer un RequestId unique
 */
function generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Middleware d'audit principal
 */
function auditMiddleware(req, res, next) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    const requestId = generateRequestId();
    
    // Ajouter au request pour utilisation dans les routes
    req.audit = {
        correlationId,
        requestId,
        startTime
    };
    
    // Intercepter la réponse pour logger
    const originalSend = res.send;
    const originalJson = res.json;
    
    res.send = function(data) {
        logAuditEvent(req, res, startTime, correlationId, requestId, data);
        return originalSend.call(this, data);
    };
    
    res.json = function(data) {
        logAuditEvent(req, res, startTime, correlationId, requestId, data);
        return originalJson.call(this, data);
    };
    
    next();
}

/**
 * Logger un événement d'audit
 */
async function logAuditEvent(req, res, startTime, correlationId, requestId, responseData) {
    try {
        const durationMs = Date.now() - startTime;
        const statusCode = res.statusCode || 200;
        
        // Extraire les informations de la requête
        const operatorCode = req.body?.operatorId || req.body?.code || req.params?.operatorCode || req.query?.operatorCode || null;
        const lancementCode = req.body?.lancementCode || req.params?.code || req.query?.lancementCode || null;
        const endpoint = req.originalUrl || req.path;
        const method = req.method;
        const ipAddress = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || null;
        const userAgent = req.headers['user-agent'] || null;
        
        // Déterminer l'action basée sur l'endpoint
        let action = 'HttpRequest';
        if (endpoint.includes('/login')) action = 'OperatorLogin';
        else if (endpoint.includes('/logout')) action = 'OperatorLogout';
        else if (endpoint.includes('/start')) action = 'StartLancement';
        else if (endpoint.includes('/pause')) action = 'PauseLancement';
        else if (endpoint.includes('/resume')) action = 'ResumeLancement';
        else if (endpoint.includes('/stop')) action = 'StopLancement';
        else if (endpoint.includes('/heartbeat')) action = 'Heartbeat';
        
        // Déterminer la sévérité
        let severity = 'INFO';
        if (statusCode >= 500) severity = 'ERROR';
        else if (statusCode >= 400) severity = 'WARNING';
        
        // Récupérer les informations de session si opérateur présent
        let sessionId = null;
        let deviceId = null;
        
        if (operatorCode) {
            const sessionInfo = await getSessionInfo(operatorCode);
            if (sessionInfo) {
                sessionId = sessionInfo.SessionId;
                deviceId = sessionInfo.DeviceId;
            }
        }
        
        // Préparer le payload JSON (limité pour éviter les données trop volumineuses)
        let payloadJson = null;
        try {
            const payload = {
                body: req.body ? Object.keys(req.body).reduce((acc, key) => {
                    // Exclure les champs sensibles ou volumineux
                    if (key !== 'password' && key !== 'token' && typeof req.body[key] !== 'object') {
                        acc[key] = req.body[key];
                    }
                    return acc;
                }, {}) : null,
                query: Object.keys(req.query).length > 0 ? req.query : null,
                params: Object.keys(req.params).length > 0 ? req.params : null
            };
            
            // Limiter la taille du payload
            const payloadStr = JSON.stringify(payload);
            if (payloadStr.length < 8000) {
                payloadJson = payloadStr;
            }
        } catch (error) {
            // Ignorer les erreurs de sérialisation
        }
        
        // Message d'erreur si applicable
        let errorMessage = null;
        if (severity === 'ERROR' && responseData) {
            try {
                const errorData = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
                errorMessage = errorData.error || errorData.message || null;
                if (errorMessage && errorMessage.length > 1000) {
                    errorMessage = errorMessage.substring(0, 1000);
                }
            } catch (error) {
                // Ignorer
            }
        }
        
        // Insérer l'événement d'audit (asynchrone, ne pas bloquer la réponse)
        setImmediate(async () => {
            try {
                // Vérifier si la table existe avant d'insérer
                const checkTableQuery = `
                    SELECT COUNT(*) as tableExists
                    FROM INFORMATION_SCHEMA.TABLES
                    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AB_AUDIT_EVENTS'
                `;
                
                const tableCheck = await executeQuery(checkTableQuery);
                const tableExists = tableCheck && tableCheck.length > 0 && tableCheck[0].tableExists > 0;
                
                if (!tableExists) {
                    // Table n'existe pas, on skip silencieusement (pas d'erreur)
                    return;
                }
                
                const insertQuery = `
                    INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]
                    (OccurredAt, OperatorCode, SessionId, DeviceId, Action, Endpoint, Method, StatusCode, DurationMs,
                     LancementCode, IpAddress, UserAgent, CorrelationId, RequestId, PayloadJson, ErrorMessage, Severity)
                    VALUES
                    (GETUTCDATE(), @operatorCode, @sessionId, @deviceId, @action, @endpoint, @method, @statusCode, @durationMs,
                     @lancementCode, @ipAddress, @userAgent, @correlationId, @requestId, @payloadJson, @errorMessage, @severity)
                `;
                
                await executeNonQuery(insertQuery, {
                    operatorCode: operatorCode || null,
                    sessionId: sessionId || null,
                    deviceId: deviceId || null,
                    action,
                    endpoint,
                    method,
                    statusCode,
                    durationMs,
                    lancementCode: lancementCode || null,
                    ipAddress: ipAddress || null,
                    userAgent: userAgent || null,
                    correlationId,
                    requestId,
                    payloadJson: payloadJson || null,
                    errorMessage: errorMessage || null,
                    severity
                });
            } catch (error) {
                // Logger l'erreur mais ne pas faire échouer la requête
                // Ne logger que si ce n'est pas une erreur de table inexistante
                if (!error.message || !error.message.includes('Invalid object name')) {
                    console.error('❌ Erreur lors de l\'écriture de l\'audit:', error);
                }
            }
        });
        
    } catch (error) {
        // Ne pas faire échouer la requête si l'audit échoue
        console.error('❌ Erreur dans le middleware d\'audit:', error);
    }
}

/**
 * Logger un événement d'audit personnalisé (pour les actions métier spécifiques)
 */
async function logCustomAuditEvent(eventData) {
    try {
        const {
            operatorCode,
            sessionId,
            deviceId,
            action,
            lancementCode,
            correlationId,
            requestId,
            payloadJson,
            errorMessage,
            severity = 'INFO'
        } = eventData;
        
        // Vérifier si la table existe avant d'insérer
        const checkTableQuery = `
            SELECT COUNT(*) as tableExists
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AB_AUDIT_EVENTS'
        `;
        
        const tableCheck = await executeQuery(checkTableQuery);
        const tableExists = tableCheck && tableCheck.length > 0 && tableCheck[0].tableExists > 0;
        
        if (!tableExists) {
            // Table n'existe pas, on skip silencieusement
            return;
        }
        
        const insertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]
            (OccurredAt, OperatorCode, SessionId, DeviceId, Action, LancementCode, 
             CorrelationId, RequestId, PayloadJson, ErrorMessage, Severity)
            VALUES
            (GETUTCDATE(), @operatorCode, @sessionId, @deviceId, @action, @lancementCode,
             @correlationId, @requestId, @payloadJson, @errorMessage, @severity)
        `;
        
        await executeNonQuery(insertQuery, {
            operatorCode: operatorCode || null,
            sessionId: sessionId || null,
            deviceId: deviceId || null,
            action,
            lancementCode: lancementCode || null,
            correlationId: correlationId || null,
            requestId: requestId || null,
            payloadJson: payloadJson ? JSON.stringify(payloadJson) : null,
            errorMessage: errorMessage || null,
            severity
        });
    } catch (error) {
        // Ne logger que si ce n'est pas une erreur de table inexistante
        if (!error.message || !error.message.includes('Invalid object name')) {
            console.error('❌ Erreur lors de l\'écriture de l\'audit personnalisé:', error);
        }
    }
}

/**
 * Nettoyer le cache des sessions (appeler périodiquement)
 */
function clearSessionCache() {
    sessionCache.clear();
}

// Nettoyer le cache toutes les 10 minutes
setInterval(clearSessionCache, 10 * 60 * 1000);

module.exports = {
    auditMiddleware,
    logCustomAuditEvent,
    generateCorrelationId,
    generateRequestId
};


