const sql = require('mssql');

// Charger la configuration de production si disponible
let productionConfig = null;
try {
    productionConfig = require('../config-production');
    console.log('✅ Configuration de production chargée:', {
        DB_SERVER: productionConfig?.DB_SERVER,
        DB_DATABASE: productionConfig?.DB_DATABASE
    });
} catch (error) {
    console.log('📝 Configuration de production non trouvée, utilisation des variables d\'environnement:', error.message);
}

// Configuration de la base de données SQL Server
// Priorité : config-production.js > variables d'environnement > valeurs par défaut
const config = {
    server: productionConfig?.DB_SERVER || process.env.DB_SERVER || '192.168.1.26',
    database: productionConfig?.DB_DATABASE || process.env.DB_DATABASE || 'SEDI_APP_INDEPENDANTE',
    user: productionConfig?.DB_USER || process.env.DB_USER || 'QUALITE',
    password: productionConfig?.DB_PASSWORD || process.env.DB_PASSWORD || 'QUALITE',
    options: {
        encrypt: productionConfig?.DB_ENCRYPT || process.env.DB_ENCRYPT === 'true' || false,
        trustServerCertificate: productionConfig?.DB_TRUST_CERT || process.env.DB_TRUST_CERT === 'true' || true,
        enableArithAbort: true,
        requestTimeout: 30000,
        connectionTimeout: 30000
    },
    pool: {
        max: 30,  // 20 opérateurs + 5 admin + 5 marge pour FSOP/autres
        min: 10,  // Minimum de connexions actives pour réactivité
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 60000,  // Timeout pour acquérir une connexion
        createTimeoutMillis: 30000,   // Timeout pour créer une connexion
        destroyTimeoutMillis: 5000,   // Timeout pour détruire une connexion
        reapIntervalMillis: 1000,     // Intervalle de nettoyage
        createRetryIntervalMillis: 200, // Intervalle de retry
        // Note: evictionRunIntervalMillis n'est pas supporté par cette version de tarn
    }
};

// Log de la configuration finale utilisée
console.log('🔧 Configuration finale de la base de données:', {
    server: config.server,
    database: config.database,
    user: config.user,
    source: productionConfig ? 'config-production.js' : 'variables d\'environnement'
});

// Configuration de la base ERP
const erpConfig = {
    server: productionConfig?.DB_ERP_SERVER || process.env.DB_ERP_SERVER || '192.168.1.26',
    database: productionConfig?.DB_ERP_DATABASE || process.env.DB_ERP_DATABASE || 'SEDI_ERP',
    user: productionConfig?.DB_ERP_USER || process.env.DB_ERP_USER || 'QUALITE',
    password: productionConfig?.DB_ERP_PASSWORD || process.env.DB_ERP_PASSWORD || 'QUALITE',
    options: {
        encrypt: productionConfig?.DB_ERP_ENCRYPT || process.env.DB_ERP_ENCRYPT === 'true' || false,
        trustServerCertificate: productionConfig?.DB_ERP_TRUST_CERT || process.env.DB_ERP_TRUST_CERT === 'true' || true,
        enableArithAbort: true,
        requestTimeout: 30000,
        connectionTimeout: 30000
    },
    pool: {
        max: 30,  // 20 opérateurs + 5 admin + 5 marge pour FSOP/autres
        min: 10,  // Minimum de connexions actives pour réactivité
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 60000,  // Timeout pour acquérir une connexion
        createTimeoutMillis: 30000,   // Timeout pour créer une connexion
        destroyTimeoutMillis: 5000,   // Timeout pour détruire une connexion
        reapIntervalMillis: 1000,     // Intervalle de nettoyage
        createRetryIntervalMillis: 200, // Intervalle de retry
        // Note: evictionRunIntervalMillis n'est pas supporté par cette version de tarn
    }
};

// Pool de connexions
let pool = null;
let erpPool = null;

// Fonction pour obtenir une connexion
async function getConnection() {
    try {
        if (!pool) {
            // En mode test, simuler une connexion réussie
            if (process.env.NODE_ENV === 'test') {
                console.log('🧪 Mode test - Connexion simulée');
                return null; // Retourner null pour les tests
            }
            pool = await sql.connect(config);
            console.log('🔗 Connexion à la base de données établie');
        }
        return pool;
    } catch (error) {
        console.error('❌ Erreur de connexion à la base de données:', error);
        throw error;
    }
}

// Fonction pour obtenir une connexion ERP
async function getErpConnection() {
    try {
        if (!erpPool) {
            // En mode test, simuler une connexion réussie
            if (process.env.NODE_ENV === 'test') {
                console.log('🧪 Mode test - Connexion ERP simulée');
                return null; // Retourner null pour les tests
            }
            erpPool = await sql.connect(erpConfig);
            console.log('🔗 Connexion à la base ERP établie');
        }
        return erpPool;
    } catch (error) {
        console.error('❌ Erreur de connexion à la base ERP:', error);
        throw error;
    }
}

// Fonction pour exécuter une requête avec retry et gestion de concurrence
async function executeQuery(query, params = {}, retries = 3) {
    // En mode test, retourner des données simulées
    if (process.env.NODE_ENV === 'test') {
        console.log('🧪 Mode test - Données simulées retournées');
        return []; // Retourner un tableau vide pour les tests
    }
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const pool = await getConnection();
            
            // Utiliser un timeout pour éviter les blocages
            const request = pool.request();
            request.timeout = 30000; // 30 secondes max par requête
            
            // Ajouter les paramètres
            Object.keys(params).forEach(key => {
                request.input(key, params[key]);
            });
            
            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            // Erreurs de deadlock ou timeout - retry
            const isRetryable = error.code === 'ETIMEOUT' || 
                              error.code === 'EREQUEST' && 
                              (error.originalError?.number === 1205 || // Deadlock
                               error.originalError?.number === -2);    // Timeout
            
            if (isRetryable && attempt < retries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff
                console.warn(`⚠️ Erreur récupérable (tentative ${attempt}/${retries}), retry dans ${delay}ms:`, error.message);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            console.error('❌ Erreur lors de l\'exécution de la requête:', error);
            throw error;
        }
    }
}

// Fonction pour exécuter une requête sur la base ERP
async function executeErpQuery(query, params = {}) {
    const pool = await getErpConnection();
    
    // En mode test, retourner des données simulées
    if (process.env.NODE_ENV === 'test') {
        console.log('🧪 Mode test - Données ERP simulées retournées');
        return []; // Retourner un tableau vide pour les tests
    }
    
    try {
        const request = pool.request();
        
        // Ajouter les paramètres
        Object.keys(params).forEach(key => {
            request.input(key, params[key]);
        });
        
        const result = await request.query(query);
        return result.recordset;
    } catch (error) {
        console.error('❌ Erreur lors de l\'exécution de la requête ERP:', error);
        throw error;
    }
}

// Fonction pour exécuter une procédure stockée
async function executeProcedure(procedureName, params = {}) {
    const pool = await getConnection();
    
    // En mode test, retourner des données simulées
    if (process.env.NODE_ENV === 'test') {
        console.log('🧪 Mode test - Procédure simulée:', procedureName);
        return []; // Retourner un tableau vide pour les tests
    }
    
    try {
        const request = pool.request();
        
        // Ajouter les paramètres
        Object.keys(params).forEach(key => {
            request.input(key, params[key]);
        });
        
        const result = await request.execute(procedureName);
        return result.recordset;
    } catch (error) {
        // SQL Server error 2812 = "Could not find stored procedure"
        // In some environments (e.g., VM without mapping scripts applied), these procedures may be missing.
        // We treat this as non-fatal to avoid blocking the API for pure "audit/consultation" side effects.
        const sqlNumber = error?.number ?? error?.originalError?.info?.number;
        if (sqlNumber === 2812) {
            console.warn(`⚠️ Procédure stockée introuvable (ignorée): ${procedureName}`);
            return [];
        }
        console.error(' Erreur lors de l\'exécution de la procédure:', error);
        throw error;
    }
}

// Exécuter une commande non séléctive (INSERT/UPDATE/DELETE) avec gestion de concurrence
async function executeNonQuery(query, params = {}, retries = 3) {
    // En mode test, retourner un résultat simulé
    if (process.env.NODE_ENV === 'test') {
        console.log('🧪 Mode test - Commande simulée:', query.substring(0, 50) + '...');
        return { rowsAffected: 1 }; // Simuler une ligne affectée
    }
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const pool = await getConnection();
            const request = pool.request();
            request.timeout = 30000; // 30 secondes max
            
            Object.keys(params).forEach(key => {
                request.input(key, params[key]);
            });
            
            const result = await request.query(query);
            // mssql retourne un tableau rowsAffected par commande
            const affected = Array.isArray(result.rowsAffected) ? result.rowsAffected.reduce((a, b) => a + b, 0) : (result.rowsAffected || 0);
            return {
                rowsAffected: affected
            };
        } catch (error) {
            // Erreurs de deadlock ou timeout - retry
            const isRetryable = error.code === 'ETIMEOUT' || 
                              error.code === 'EREQUEST' && 
                              (error.originalError?.number === 1205 || // Deadlock
                               error.originalError?.number === -2 ||   // Timeout
                               error.originalError?.number === 1222);  // Lock request timeout
            
            if (isRetryable && attempt < retries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff
                console.warn(`⚠️ Erreur récupérable (tentative ${attempt}/${retries}), retry dans ${delay}ms:`, error.message);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            console.error('❌ Erreur lors de l\'exécution de la commande:', error);
            throw error;
        }
    }
}

// Fonction pour fermer la connexion
async function closeConnection() {
    if (pool) {
        await pool.close();
        pool = null;
        console.log('🔌 Connexion à la base de données fermée');
    }
}

// Gestion des erreurs de connexion avec reconnexion automatique
sql.on('error', async (err) => {
    console.error('❌ Erreur SQL Server:', err);
    
    // Si la connexion est perdue, réinitialiser le pool
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKET') {
        console.log('🔄 Reconnexion automatique au pool SQL...');
        try {
            if (pool) {
                await pool.close();
                pool = null;
            }
            if (erpPool) {
                await erpPool.close();
                erpPool = null;
            }
            // Les prochaines requêtes recréeront automatiquement les pools
        } catch (closeError) {
            console.error('❌ Erreur lors de la fermeture du pool:', closeError);
        }
    }
});

// Monitoring du pool de connexions
setInterval(() => {
    if (pool) {
        const poolInfo = {
            total: pool.totalCount || 0,
            idle: pool.idleCount || 0,
            waiting: pool.waitingCount || 0
        };
        if (poolInfo.total > 0) {
            console.log(`📊 Pool SQL: ${poolInfo.total} connexions (${poolInfo.idle} idle, ${poolInfo.waiting} en attente)`);
        }
    }
}, 60000); // Toutes les minutes

module.exports = {
    config,
    erpConfig,
    getConnection,
    getErpConnection,
    executeQuery,
    executeErpQuery,
    executeProcedure,
    executeNonQuery,
    closeConnection,
    sql
};
