const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
require('dotenv').config();

const dbConfig = require('./config/database');
const operatorRoutes = require('./routes/operators');
const lancementRoutes = require('./routes/lancements');
const operationRoutes = require('./routes/operations');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const commentRoutes = require('./routes/comments');
const fsopRoutes = require('./routes/fsop');
const heartbeatRoutes = require('./routes/heartbeat');
const { metricsMiddleware, getMetrics, register } = require('./middleware/metrics');
const { auditMiddleware } = require('./middleware/audit');
const apmService = require('./services/APMService');
const cacheService = require('./services/CacheService');


const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration - MUST be before Helmet
const allowedOrigins = [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://192.168.1.26:8080',
    'http://192.168.1.26:3001',
    process.env.FRONTEND_URL
].filter(Boolean);

// Configure CORS - Allow all origins for now to fix CORS issues
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) {
            return callback(null, true);
        }
        // Allow any origin that matches our list or in development
        if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
            callback(null, true);
        } else {
            // Allow anyway for now to fix CORS issues
            callback(null, true);
        }
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
    exposedHeaders: ['Content-Length', 'Content-Disposition', 'X-Foo', 'X-Bar'],
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Middleware de sécurité - Configure Helmet to allow CORS
app.use(helmet({
    crossOriginResourcePolicy: false, // Disable CORP to allow CORS
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false // Disable CSP for now to avoid CORS conflicts
}));

// Rate limiting global:
// - En atelier, plusieurs tablettes peuvent partager la même IP (NAT) => il faut un plafond plus haut
// - Les routes /api/admin et /api/auth/login ont leur propre limiter dédié
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 1000 : 20000,
    message: {
        error: 'Trop de requêtes, veuillez patienter',
        retryAfter: Math.ceil(15 * 60 * 1000 / 1000) // en secondes
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting pour les requêtes de santé, admin (limiter dédié),
        // login (limiter dédié) et opérations critiques
        return req.path === '/api/health' ||
               req.path.startsWith('/api/admin') ||
               req.path === '/api/auth/login' ||
               req.path.startsWith('/api/operators/start') ||
               req.path.startsWith('/api/operators/stop') ||
               req.path.startsWith('/api/operators/pause');
    }
});
app.use(apiLimiter);

// ⚡ OPTIMISATION : Compression HTTP pour réduire la taille des réponses JSON
app.use(compression({
    filter: (req, res) => {
        // Compresser toutes les réponses JSON et texte
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    },
    level: 6, // Niveau de compression (1-9, 6 = bon compromis vitesse/taille)
    threshold: 1024 // Compresser seulement si > 1KB
}));

// Middleware de parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('combined'));

// Audit middleware (doit être avant les routes)
app.use(auditMiddleware);

// Métriques
app.use(metricsMiddleware);

// ⚡ OPTIMISATION : APM middleware pour monitoring détaillé
app.use(apmService.httpMiddleware());
// Rate limiting spécifique pour les routes admin (plus permissif)
const adminLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: process.env.NODE_ENV === 'production' ? 200 : 500, // 200 en prod, 500 en dev
    message: {
        error: 'Trop de requêtes admin, veuillez patienter',
        retryAfter: 60
    },
    skip: (req) => {
        // Skip pour les requêtes de santé et les requêtes de lecture
        return req.path === '/api/health' || req.method === 'GET';
    }
});

// Rate limiting spécifique pour la connexion admin (anti brute-force, mais sans bloquer le reste de l'appli)
const adminLoginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: process.env.NODE_ENV === 'production' ? 30 : 200,
    message: {
        error: 'Trop de tentatives de connexion, veuillez patienter',
        retryAfter: 300
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Routes
app.use('/api/auth/login', adminLoginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/operators', operatorRoutes);
app.use('/api/lancements', lancementRoutes);
app.use('/api/operations', operationRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/fsop', fsopRoutes);
app.use('/api/heartbeat', heartbeatRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);

// Route de santé
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Route métriques Prometheus
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        const metrics = await getMetrics();
        res.end(metrics);
    } catch (error) {
        console.error('Erreur lors de la récupération des métriques:', error);
        res.status(500).end();
    }
});

// ⚡ OPTIMISATION : Route APM pour monitoring détaillé
app.get('/api/apm/metrics', async (req, res) => {
    try {
        const metrics = await apmService.getMetrics();
        res.set('Content-Type', 'text/plain');
        res.end(metrics);
    } catch (error) {
        console.error('Erreur lors de la récupération des métriques APM:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des métriques' });
    }
});

app.get('/api/apm/stats', async (req, res) => {
    try {
        const stats = apmService.getPerformanceStats();
        res.json(stats);
    } catch (error) {
        console.error('Erreur lors de la récupération des stats APM:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des stats' });
    }
});
// Route racine
app.get('/', (req, res) => {
    res.json({ 
        message: 'SEDI Tablette API',
        version: '1.0.0',
        endpoints: {
            health: '/api/health',
            operators: '/api/operators',
            lancements: '/api/lancements',
            operations: '/api/operations',
            comments: '/api/comments',
            admin: '/api/admin'
        }
    });
});

// Gestion des erreurs 404 - catch-all pour Express 5
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint non trouvé',
        path: req.originalUrl
    });
});

// Gestion globale des erreurs
app.use((err, req, res, next) => {
    console.error('Erreur serveur:', err);
    
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' 
            ? 'Erreur interne du serveur' 
            : err.message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
});

// Démarrage du serveur (seulement si ce n'est pas un test)
// Vérifier NODE_ENV au moment de l'exécution, pas de l'import
const shouldStartServer = () => {
    // Ne pas démarrer le serveur si NODE_ENV est 'test' ou si on est dans un contexte de test
    return process.env.NODE_ENV !== 'test' && 
           process.env.NODE_ENV !== 'testing' &&
           !process.env.JEST_WORKER_ID && // Jest utilise cette variable
           !process.argv.some(arg => arg.includes('jest')); // Vérifier si jest est dans les arguments
};

// Stocker la référence du serveur pour pouvoir le fermer proprement
let server = null;

// Fonction de nettoyage automatique
async function performStartupCleanup() {
    try {
        console.log('🧹 Nettoyage automatique au démarrage...');
        
        const { executeQuery } = require('./config/database');
        
        // Nettoyer les sessions expirées
        const cleanupSessionsQuery = `
            DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
            WHERE DateCreation < DATEADD(hour, -24, GETDATE())
        `;
        await executeQuery(cleanupSessionsQuery);
        console.log('✅ Sessions expirées nettoyées');
        
        // Terminer les opérations actives sans session active (orphelines)
        console.log('🔍 Recherche des opérations orphelines (actives sans opérateur connecté)...');
        const orphanOperationsQuery = `
            UPDATE h
            SET h.Statut = 'TERMINE',
                h.HeureFin = CAST(GETDATE() AS TIME)
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
            LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s 
                ON h.OperatorCode = s.OperatorCode 
                AND s.SessionStatus = 'ACTIVE'
                AND CAST(s.DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            WHERE h.Statut IN ('EN_COURS', 'EN_PAUSE')
                AND CAST(h.DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                AND s.OperatorCode IS NULL
                AND h.OperatorCode IS NOT NULL
                AND h.OperatorCode != ''
                AND h.OperatorCode != '0'
        `;
        const orphanResult = await executeQuery(orphanOperationsQuery);
        console.log('✅ Opérations orphelines terminées automatiquement');
        
        // Nettoyer les doublons d'opérations
        const duplicatesQuery = `
            WITH DuplicateEvents AS (
                SELECT NoEnreg,
                       ROW_NUMBER() OVER (
                           PARTITION BY OperatorCode, CodeLanctImprod, CAST(DateCreation AS DATE), Ident, Phase
                           ORDER BY DateCreation ASC, NoEnreg ASC
                       ) as rn
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode IS NOT NULL 
                    AND OperatorCode != ''
                    AND OperatorCode != '0'
            )
            DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE NoEnreg IN (
                SELECT NoEnreg FROM DuplicateEvents WHERE rn > 1
            )
        `;
        await executeQuery(duplicatesQuery);
        console.log('✅ Doublons d\'opérations nettoyés');
        
        console.log('✅ Nettoyage automatique terminé');
    } catch (error) {
        console.error('❌ Erreur lors du nettoyage automatique:', error);
    }
}

// Fonction de nettoyage périodique (toutes les heures)
function startPeriodicCleanup() {
    setInterval(async () => {
        try {
            console.log('🧹 Nettoyage périodique...');
            await performStartupCleanup();
        } catch (error) {
            console.error('❌ Erreur lors du nettoyage périodique:', error);
        }
    }, 60 * 60 * 1000); // Toutes les heures
}

if (shouldStartServer()) {
    // Utiliser le port 3033 pour le développement local, sinon utiliser PORT (3001)
    const devPort = process.env.NODE_ENV === 'development' ? 3033 : PORT;
    
    // Fonction pour démarrer le serveur avec gestion d'erreur de port occupé
    const startServer = async (port) => {
        return new Promise((resolve, reject) => {
            const serverInstance = app.listen(port, async () => {
                console.log(`🚀 Serveur SEDI Tablette démarré sur le port ${port}`);
                console.log(`📊 Interface admin: http://localhost:${port}/api/admin`);
                console.log(`🔍 Santé: http://localhost:${port}/api/health`);
                
                // Effectuer le nettoyage automatique au démarrage
                await performStartupCleanup();
                
                // Démarrer le nettoyage périodique
                startPeriodicCleanup();
                
                resolve(serverInstance);
            });
            
            serverInstance.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(`❌ Le port ${port} est déjà utilisé.`);
                    console.log(`💡 Tentative d'arrêt du processus utilisant le port ${port}...`);
                    reject(err);
                } else {
                    reject(err);
                }
            });
        });
    };
    
    // Essayer de démarrer sur le port de développement
    startServer(devPort).then((serverInstance) => {
        server = serverInstance;
    }).catch(async (err) => {
        if (err.code === 'EADDRINUSE' && devPort === 3033) {
            // Si le port 3033 est occupé, essayer le port 3001
            console.log(`⚠️ Port ${devPort} occupé, tentative sur le port ${PORT}...`);
            try {
                server = await startServer(PORT);
            } catch (fallbackErr) {
                console.error('❌ Impossible de démarrer le serveur sur les ports 3033 et 3001');
                console.error('💡 Arrêtez les processus utilisant ces ports ou changez le port dans la configuration');
                process.exit(1);
            }
        } else {
            console.error('❌ Erreur lors du démarrage du serveur:', err);
            process.exit(1);
        }
    });
} else {
    console.log('🧪 Mode test détecté - Serveur non démarré');
}

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
    console.log('🛑 Arrêt du serveur...');
    if (server) {
        server.close(() => {
            console.log('✅ Serveur fermé proprement');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

process.on('SIGINT', () => {
    console.log('🛑 Arrêt du serveur...');
    if (server) {
        server.close(() => {
            console.log('✅ Serveur fermé proprement');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

// Fonction pour fermer le serveur proprement (utile pour les tests)
const closeServer = () => {
    return new Promise((resolve) => {
        if (server) {
            server.close(() => {
                console.log('✅ Serveur fermé proprement');
                resolve();
            });
        } else {
            resolve();
        }
    });
};

module.exports = { app, closeServer };
