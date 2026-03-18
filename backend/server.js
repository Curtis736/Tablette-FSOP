const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
require('dotenv').config();

const dbConfig = require('./config/database');
const { executeQuery, executeNonQuery } = require('./config/database');
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
const { requestLogger } = require('./middleware/requestLogger');
const { authenticateAdmin } = require('./middleware/auth');
const apmService = require('./services/APMService');
const cacheService = require('./services/CacheService');
const MaintenanceManager = require('./scripts/maintenance');


const app = express();
const PORT = process.env.PORT || 3001;

// Derrière Nginx / reverse proxy, activer trust proxy pour que express-rate-limit
// utilise correctement X-Forwarded-For (sinon warning + mauvais keying).
// Sécurisé: on fait confiance au proxy local (docker/nginx) uniquement.
app.set('trust proxy', 1);

// CORS configuration - MUST be before Helmet
const allowedOrigins = [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://192.168.1.26:8080',
    'http://192.168.1.26:3001',
    'https://192.168.1.26',
    'https://localhost',
    'https://192.168.1.26:8443',
    'https://localhost:8443',
    'https://fsop.sedi-ati.com',
    process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, same-origin)
        if (!origin) {
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
            callback(null, true);
        } else {
            callback(new Error(`CORS: origine non autorisée: ${origin}`));
        }
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
    exposedHeaders: ['Content-Length', 'Content-Disposition', 'X-Foo', 'X-Bar'],
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
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

// Logger request-scoped (X-Request-Id + niveaux via LOG_LEVEL)
app.use(requestLogger);

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

// Route métriques Prometheus (admin uniquement)
app.get('/metrics', authenticateAdmin, async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        const metrics = await getMetrics();
        res.end(metrics);
    } catch (error) {
        console.error('Erreur lors de la récupération des métriques:', error);
        res.status(500).end();
    }
});

app.get('/api/apm/metrics', authenticateAdmin, async (req, res) => {
    try {
        const metrics = await apmService.getMetrics();
        res.set('Content-Type', 'text/plain');
        res.end(metrics);
    } catch (error) {
        console.error('Erreur lors de la récupération des métriques APM:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des métriques' });
    }
});

app.get('/api/apm/stats', authenticateAdmin, async (req, res) => {
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
        if (String(process.env.DISABLE_STARTUP_CLEANUP || '').toLowerCase() === 'true') {
            console.log('🧹 Nettoyage automatique désactivé (DISABLE_STARTUP_CLEANUP=true)');
            return;
        }

        console.log('🧹 Nettoyage automatique au démarrage...');
        
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
                AND s.DateCreation >= CONVERT(date, GETDATE())
                AND s.DateCreation <  DATEADD(day, 1, CONVERT(date, GETDATE()))
            WHERE h.Statut IN ('EN_COURS', 'EN_PAUSE')
                AND h.DateCreation >= CONVERT(date, GETDATE())
                AND h.DateCreation <  DATEADD(day, 1, CONVERT(date, GETDATE()))
                AND s.OperatorCode IS NULL
                AND h.OperatorCode IS NOT NULL
                AND h.OperatorCode != ''
                AND h.OperatorCode != '0'
        `;
        await executeQuery(orphanOperationsQuery);
        console.log('✅ Opérations orphelines terminées automatiquement');
        
        // Nettoyer les doublons d'opérations
        const duplicatesQuery = `
            -- ⚡ Limiter le nettoyage aux événements récents (évite scans énormes + timeouts)
            DECLARE @startDate date = DATEADD(day, -7, CONVERT(date, GETDATE()));
            DECLARE @endDate   date = DATEADD(day,  1, CONVERT(date, GETDATE()));
            WITH DuplicateEvents AS (
                SELECT NoEnreg,
                       ROW_NUMBER() OVER (
                           PARTITION BY OperatorCode, CodeLanctImprod, CONVERT(date, DateCreation), Ident, Phase
                           ORDER BY DateCreation ASC, NoEnreg ASC
                       ) as rn
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode IS NOT NULL 
                    AND OperatorCode != ''
                    AND OperatorCode != '0'
                    AND DateCreation >= @startDate
                    AND DateCreation <  @endDate
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

// Clôturer toutes les sessions opérateurs à minuit (heure serveur)
// Objectif: éviter les "sessions fantômes" qui polluent le dashboard admin le lendemain.
function scheduleMidnightCloseSessions() {
    const enabled = String(process.env.CLOSE_SESSIONS_AT_MIDNIGHT || 'true').toLowerCase() === 'true';
    if (!enabled) {
        console.log('🌙 Fermeture des sessions à minuit désactivée (CLOSE_SESSIONS_AT_MIDNIGHT!=true)');
        return;
    }

    const scheduleNextRun = () => {
        const now = new Date();
        const next = new Date(now);
        next.setHours(0, 0, 0, 0);
        next.setDate(next.getDate() + 1); // prochain minuit
        const delay = next.getTime() - now.getTime();
        console.log(`🌙 Prochaine fermeture des sessions planifiée à ${next.toISOString()} (dans ${Math.round(delay / 1000)} secondes).`);

        setTimeout(async () => {
            try {
                console.log('🌙 Fermeture automatique des sessions opérateurs (minuit)...');
                await executeNonQuery(`
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                    SET LogoutTime = GETDATE(),
                        SessionStatus = 'CLOSED',
                        ActivityStatus = 'INACTIVE'
                    WHERE SessionStatus = 'ACTIVE'
                `);
                console.log('✅ Sessions opérateurs fermées (minuit).');
            } catch (error) {
                console.error('❌ Erreur lors de la fermeture des sessions à minuit:', error);
            } finally {
                scheduleNextRun();
            }
        }, delay);
    };

    scheduleNextRun();
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

// Planification quotidienne de la clôture automatique des opérations (par défaut à 19h heure serveur)
function scheduleDailyAutoCloseOperations() {
    const enabled = String(process.env.ENABLE_AUTO_CLOSE_OPS || 'true').toLowerCase() === 'true';
    if (!enabled) {
        console.log('⏰ Clôture automatique des opérations désactivée (ENABLE_AUTO_CLOSE_OPS!=true)');
        return;
    }

    const maintenance = new MaintenanceManager();

    const scheduleNextRun = () => {
        const now = new Date();
        const next = new Date(now);
        // Heure cible: 19h00:00 heure serveur
        next.setHours(19, 0, 0, 0);
        if (next <= now) {
            // Si on a déjà dépassé 19h aujourd'hui, programmer pour demain
            next.setDate(next.getDate() + 1);
        }
        const delay = next.getTime() - now.getTime();
        console.log(`⏰ Prochaine clôture automatique des opérations planifiée à ${next.toISOString()} (dans ${Math.round(delay / 1000)} secondes).`);

        setTimeout(async () => {
            try {
                await maintenance.autoCloseOpenOperations();
            } catch (error) {
                console.error('❌ Erreur lors de la clôture automatique quotidienne des opérations:', error);
            } finally {
                // Replanifier pour le lendemain
                scheduleNextRun();
            }
        }, delay);
    };

    scheduleNextRun();
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

                // Fermer les sessions à minuit (évite les compteurs incohérents le lendemain)
                scheduleMidnightCloseSessions();
                
                // Démarrer le nettoyage périodique uniquement si explicitement activé
                if (String(process.env.ENABLE_PERIODIC_CLEANUP || '').toLowerCase() === 'true') {
                    startPeriodicCleanup();
                } else {
                    console.log('🧹 Nettoyage périodique désactivé (ENABLE_PERIODIC_CLEANUP!=true)');
                }

                // Planifier la clôture automatique quotidienne des opérations (par défaut activée)
                scheduleDailyAutoCloseOperations();
                
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
