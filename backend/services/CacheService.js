/**
 * Service de cache Redis pour les données partagées entre instances
 * Fallback sur cache mémoire si Redis n'est pas disponible
 */

class CacheService {
    constructor() {
        this.redisClient = null;
        this.memoryCache = new Map();
        this.isRedisAvailable = false;
        this.defaultTTL = parseInt(process.env.CACHE_TTL) || 300000; // 5 minutes par défaut
        
        this.initializeRedis();
    }

    /**
     * Initialiser la connexion Redis (optionnel)
     */
    async initializeRedis() {
        try {
            // Redis est optionnel - si REDIS_URL n'est pas défini, on utilise le cache mémoire
            if (!process.env.REDIS_URL) {
                console.log('📦 Cache: Mode mémoire uniquement (REDIS_URL non défini)');
                return;
            }

            const redis = require('redis');
            this.redisClient = redis.createClient({
                url: process.env.REDIS_URL,
                socket: {
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            console.warn('⚠️ Redis: Trop de tentatives de reconnexion, utilisation du cache mémoire');
                            this.isRedisAvailable = false;
                            return false; // Arrêter les tentatives
                        }
                        return Math.min(retries * 100, 3000); // Backoff exponentiel
                    }
                }
            });

            this.redisClient.on('error', (err) => {
                console.error('❌ Redis error:', err);
                this.isRedisAvailable = false;
            });

            this.redisClient.on('connect', () => {
                console.log('✅ Redis: Connecté');
                this.isRedisAvailable = true;
            });

            this.redisClient.on('disconnect', () => {
                console.warn('⚠️ Redis: Déconnecté, utilisation du cache mémoire');
                this.isRedisAvailable = false;
            });

            await this.redisClient.connect();
            this.isRedisAvailable = true;
            console.log('✅ Cache Redis initialisé');
        } catch (error) {
            console.warn('⚠️ Redis non disponible, utilisation du cache mémoire:', error.message);
            this.isRedisAvailable = false;
        }
    }

    /**
     * Générer une clé de cache
     */
    _generateKey(prefix, ...parts) {
        return `${prefix}:${parts.join(':')}`;
    }

    /**
     * Récupérer une valeur du cache
     */
    async get(key) {
        try {
            if (this.isRedisAvailable && this.redisClient) {
                const value = await this.redisClient.get(key);
                if (value) {
                    return JSON.parse(value);
                }
            } else {
                // Fallback sur cache mémoire
                const cached = this.memoryCache.get(key);
                if (cached && (Date.now() - cached.timestamp) < cached.ttl) {
                    return cached.value;
                }
                // Nettoyer les entrées expirées
                this.memoryCache.delete(key);
            }
            return null;
        } catch (error) {
            console.error('❌ Erreur lors de la récupération du cache:', error);
            return null;
        }
    }

    /**
     * Stocker une valeur dans le cache
     */
    async set(key, value, ttl = null) {
        try {
            const cacheTTL = ttl || this.defaultTTL;
            
            if (this.isRedisAvailable && this.redisClient) {
                await this.redisClient.setEx(key, Math.floor(cacheTTL / 1000), JSON.stringify(value));
            } else {
                // Fallback sur cache mémoire
                this.memoryCache.set(key, {
                    value,
                    timestamp: Date.now(),
                    ttl: cacheTTL
                });
                
                // Nettoyer périodiquement le cache mémoire (garder max 1000 entrées)
                if (this.memoryCache.size > 1000) {
                    const oldestKey = Array.from(this.memoryCache.entries())
                        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
                    this.memoryCache.delete(oldestKey);
                }
            }
        } catch (error) {
            console.error('❌ Erreur lors du stockage dans le cache:', error);
        }
    }

    /**
     * Supprimer une clé du cache
     */
    async delete(key) {
        try {
            if (this.isRedisAvailable && this.redisClient) {
                await this.redisClient.del(key);
            } else {
                this.memoryCache.delete(key);
            }
        } catch (error) {
            console.error('❌ Erreur lors de la suppression du cache:', error);
        }
    }

    /**
     * Supprimer toutes les clés avec un préfixe
     */
    async deleteByPattern(pattern) {
        try {
            if (this.isRedisAvailable && this.redisClient) {
                const keys = await this.redisClient.keys(pattern);
                if (keys.length > 0) {
                    await this.redisClient.del(keys);
                }
            } else {
                // Pour le cache mémoire, on itère sur toutes les clés
                for (const key of this.memoryCache.keys()) {
                    if (key.startsWith(pattern.replace('*', ''))) {
                        this.memoryCache.delete(key);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Erreur lors de la suppression par pattern:', error);
        }
    }

    /**
     * Cache pour les informations de lancement
     */
    async getLancement(codeLancement) {
        const key = this._generateKey('lancement', codeLancement);
        return await this.get(key);
    }

    async setLancement(codeLancement, data, ttl = 600000) { // 10 minutes
        const key = this._generateKey('lancement', codeLancement);
        await this.set(key, data, ttl);
    }

    async invalidateLancement(codeLancement) {
        const key = this._generateKey('lancement', codeLancement);
        await this.delete(key);
    }

    /**
     * Cache pour les informations d'opérateur
     */
    async getOperator(operatorCode) {
        const key = this._generateKey('operator', operatorCode);
        return await this.get(key);
    }

    async setOperator(operatorCode, data, ttl = 300000) { // 5 minutes
        const key = this._generateKey('operator', operatorCode);
        await this.set(key, data, ttl);
    }

    async invalidateOperator(operatorCode) {
        const key = this._generateKey('operator', operatorCode);
        await this.delete(key);
    }

    /**
     * Cache pour les historiques d'opérateur
     */
    async getOperatorHistory(operatorCode, page = 1, limit = 50) {
        const key = this._generateKey('history', operatorCode, page.toString(), limit.toString());
        return await this.get(key);
    }

    async setOperatorHistory(operatorCode, page, limit, data, ttl = 60000) { // 1 minute
        const key = this._generateKey('history', operatorCode, page.toString(), limit.toString());
        await this.set(key, data, ttl);
    }

    async invalidateOperatorHistory(operatorCode) {
        const pattern = this._generateKey('history', operatorCode, '*');
        await this.deleteByPattern(pattern);
    }

    /**
     * Cache pour les templates FSOP
     */
    async getFsopTemplate(templateCode) {
        const key = this._generateKey('fsop', 'template', templateCode);
        return await this.get(key);
    }

    async setFsopTemplate(templateCode, data, ttl = 3600000) { // 1 heure
        const key = this._generateKey('fsop', 'template', templateCode);
        await this.set(key, data, ttl);
    }

    /**
     * Nettoyer le cache mémoire périodiquement
     */
    startCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [key, cached] of this.memoryCache.entries()) {
                if (now - cached.timestamp > cached.ttl) {
                    this.memoryCache.delete(key);
                }
            }
        }, 60000); // Nettoyage toutes les minutes
    }

    /**
     * Fermer la connexion Redis
     */
    async close() {
        if (this.redisClient) {
            await this.redisClient.quit();
        }
    }
}

// Singleton
const cacheService = new CacheService();
cacheService.startCleanup();

module.exports = cacheService;
