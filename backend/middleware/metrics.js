const promClient = require('prom-client');

// Créer un registry Prometheus personnalisé
const register = new promClient.Registry();

// Ajouter les métriques par défaut (CPU, mémoire, etc.)
promClient.collectDefaultMetrics({
  register,
  prefix: 'sedi_app_'
});

// Métriques personnalisées pour l'application
const metrics = {
  // Compteur de requêtes HTTP
  httpRequestsTotal: new promClient.Counter({
    name: 'sedi_http_requests_total',
    help: 'Nombre total de requêtes HTTP',
    labelNames: ['method', 'route', 'status'],
    registers: [register]
  }),

  // Durée des requêtes HTTP
  httpRequestDuration: new promClient.Histogram({
    name: 'sedi_http_request_duration_seconds',
    help: 'Durée des requêtes HTTP en secondes',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [register]
  }),

  // Taille des requêtes HTTP
  httpRequestSize: new promClient.Histogram({
    name: 'sedi_http_request_size_bytes',
    help: 'Taille des requêtes HTTP en octets',
    labelNames: ['method', 'route'],
    buckets: [100, 1000, 10000, 100000, 1000000],
    registers: [register]
  }),

  // Taille des réponses HTTP
  httpResponseSize: new promClient.Histogram({
    name: 'sedi_http_response_size_bytes',
    help: 'Taille des réponses HTTP en octets',
    labelNames: ['method', 'route', 'status'],
    buckets: [100, 1000, 10000, 100000, 1000000],
    registers: [register]
  }),

  // Taux d'erreur
  httpErrorsTotal: new promClient.Counter({
    name: 'sedi_http_errors_total',
    help: "Nombre total d'erreurs HTTP",
    labelNames: ['method', 'route', 'status'],
    registers: [register]
  }),

  // Requêtes de base de données
  dbQueriesTotal: new promClient.Counter({
    name: 'sedi_db_queries_total',
    help: 'Nombre total de requêtes de base de données',
    labelNames: ['query_type', 'status'],
    registers: [register]
  }),

  // Durée des requêtes de base de données
  dbQueryDuration: new promClient.Histogram({
    name: 'sedi_db_query_duration_seconds',
    help: 'Durée des requêtes de base de données en secondes',
    labelNames: ['query_type'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [register]
  }),

  // Taux de requêtes limitées par rate limiting
  rateLimitHits: new promClient.Counter({
    name: 'sedi_rate_limit_hits_total',
    help: 'Nombre total de hits de rate limiting',
    labelNames: ['route'],
    registers: [register]
  }),

  // Sessions actives
  activeSessions: new promClient.Gauge({
    name: 'sedi_active_sessions',
    help: 'Nombre de sessions actives',
    registers: [register]
  }),

  // Opérations actives
  activeOperations: new promClient.Gauge({
    name: 'sedi_active_operations',
    help: "Nombre d'opérations actives",
    labelNames: ['type'],
    registers: [register]
  }),

  // Connexions à la base de données
  dbConnections: new promClient.Gauge({
    name: 'sedi_db_connections',
    help: 'Nombre de connexions à la base de données',
    registers: [register]
  })
};

// Middleware pour mesurer les métriques HTTP
const metricsMiddleware = (req, res, next) => {
  const startTime = Date.now();
  const route = req.route?.path || req.path;
  const method = req.method;

  // Mesurer la taille de la requête
  const contentLength = req.get('content-length');
  if (contentLength) {
    metrics.httpRequestSize.observe(
      { method, route },
      Number.parseInt(contentLength)
    );
  }

  // Créer un objet res.end personnalisé pour capturer la taille de la réponse
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    res.end = originalEnd;
    
    const duration = (Date.now() - startTime) / 1000;
    const status = res.statusCode;
    
    // Mesurer les métriques
    metrics.httpRequestDuration.observe({ method, route, status }, duration);
    metrics.httpRequestsTotal.inc({ method, route, status });
    
    if (status >= 400) {
      metrics.httpErrorsTotal.inc({ method, route, status });
    }

    // Mesurer la taille de la réponse
    if (chunk) {
      const responseSize = Buffer.byteLength(chunk, encoding);
      metrics.httpResponseSize.observe({ method, route, status }, responseSize);
    }

    return originalEnd.call(this, chunk, encoding);
  };

  next();
};

// Fonction pour exporter les métriques au format Prometheus
const getMetrics = async () => {
  return await register.metrics();
};

// Fonction pour réinitialiser les métriques (utile pour les tests)
const resetMetrics = () => {
  register.resetMetrics();
};

module.exports = {
  metrics,
  metricsMiddleware,
  getMetrics,
  resetMetrics,
  register
};


















