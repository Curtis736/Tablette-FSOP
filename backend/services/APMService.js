/**
 * Service de monitoring APM (Application Performance Monitoring)
 * Intègre avec Prometheus et fournit des métriques détaillées
 */

const client = require('prom-client');
const register = new client.Registry();

// Métriques personnalisées
const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Durée des requêtes HTTP en secondes',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
});

const httpRequestTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Nombre total de requêtes HTTP',
    labelNames: ['method', 'route', 'status_code']
});

const dbQueryDuration = new client.Histogram({
    name: 'db_query_duration_seconds',
    help: 'Durée des requêtes SQL en secondes',
    labelNames: ['query_type', 'table'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});

const dbQueryTotal = new client.Counter({
    name: 'db_queries_total',
    help: 'Nombre total de requêtes SQL',
    labelNames: ['query_type', 'table', 'status']
});

const cacheHitRate = new client.Counter({
    name: 'cache_hits_total',
    help: 'Nombre de hits du cache',
    labelNames: ['cache_type']
});

const cacheMissRate = new client.Counter({
    name: 'cache_misses_total',
    help: 'Nombre de misses du cache',
    labelNames: ['cache_type']
});

const activeConnections = new client.Gauge({
    name: 'active_connections',
    help: 'Nombre de connexions actives',
    labelNames: ['type'] // 'operator', 'admin', 'api'
});

const activeOperations = new client.Gauge({
    name: 'active_operations',
    help: 'Nombre d\'opérations en cours',
    labelNames: ['operator_code', 'status']
});

const errorTotal = new client.Counter({
    name: 'errors_total',
    help: 'Nombre total d\'erreurs',
    labelNames: ['error_type', 'severity'] // 'database', 'api', 'validation' / 'error', 'warning'
});

// Enregistrer les métriques
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestTotal);
register.registerMetric(dbQueryDuration);
register.registerMetric(dbQueryTotal);
register.registerMetric(cacheHitRate);
register.registerMetric(cacheMissRate);
register.registerMetric(activeConnections);
register.registerMetric(activeOperations);
register.registerMetric(errorTotal);

// Métriques système par défaut
client.collectDefaultMetrics({ register });

class APMService {
    constructor() {
        this.startTime = Date.now();
    }

    /**
     * Middleware pour mesurer la durée des requêtes HTTP
     */
    httpMiddleware() {
        return (req, res, next) => {
            const start = Date.now();
            const route = req.route?.path || req.path || 'unknown';
            
            res.on('finish', () => {
                const duration = (Date.now() - start) / 1000;
                const statusCode = res.statusCode.toString();
                
                httpRequestDuration.observe(
                    { method: req.method, route, status_code: statusCode },
                    duration
                );
                
                httpRequestTotal.inc({
                    method: req.method,
                    route,
                    status_code: statusCode
                });
            });
            
            next();
        };
    }

    /**
     * Mesurer la durée d'une requête SQL
     */
    async measureDbQuery(queryType, table, queryFn) {
        const start = Date.now();
        let status = 'success';
        
        try {
            const result = await queryFn();
            const duration = (Date.now() - start) / 1000;
            
            dbQueryDuration.observe({ query_type: queryType, table }, duration);
            dbQueryTotal.inc({ query_type: queryType, table, status });
            
            return result;
        } catch (error) {
            status = 'error';
            const duration = (Date.now() - start) / 1000;
            
            dbQueryDuration.observe({ query_type: queryType, table }, duration);
            dbQueryTotal.inc({ query_type: queryType, table, status });
            
            this.recordError('database', 'error', error);
            throw error;
        }
    }

    /**
     * Enregistrer un hit de cache
     */
    recordCacheHit(cacheType) {
        cacheHitRate.inc({ cache_type: cacheType });
    }

    /**
     * Enregistrer un miss de cache
     */
    recordCacheMiss(cacheType) {
        cacheMissRate.inc({ cache_type: cacheType });
    }

    /**
     * Mettre à jour le nombre de connexions actives
     */
    updateActiveConnections(type, count) {
        activeConnections.set({ type }, count);
    }

    /**
     * Mettre à jour le nombre d'opérations actives
     */
    updateActiveOperations(operatorCode, status, count) {
        activeOperations.set({ operator_code: operatorCode, status }, count);
    }

    /**
     * Enregistrer une erreur
     */
    recordError(errorType, severity, error = null) {
        errorTotal.inc({ error_type: errorType, severity });
        
        if (error) {
            console.error(`[APM] ${severity.toUpperCase()} - ${errorType}:`, error.message);
        }
    }

    /**
     * Obtenir les métriques au format Prometheus
     */
    async getMetrics() {
        return await register.metrics();
    }

    /**
     * Obtenir les métriques au format JSON
     */
    async getMetricsJSON() {
        return await register.getMetricsAsJSON();
    }

    /**
     * Obtenir les statistiques de performance
     */
    getPerformanceStats() {
        const uptime = (Date.now() - this.startTime) / 1000;
        
        return {
            uptime_seconds: uptime,
            uptime_human: this.formatUptime(uptime),
            metrics: {
                http: {
                    request_duration: httpRequestDuration,
                    request_total: httpRequestTotal
                },
                database: {
                    query_duration: dbQueryDuration,
                    query_total: dbQueryTotal
                },
                cache: {
                    hits: cacheHitRate,
                    misses: cacheMissRate
                }
            }
        };
    }

    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        return `${days}d ${hours}h ${minutes}m ${secs}s`;
    }
}

// Singleton
const apmService = new APMService();

module.exports = apmService;
