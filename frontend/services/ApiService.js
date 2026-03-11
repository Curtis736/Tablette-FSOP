// Service pour gérer les appels API - v20251014-fixed-v3
class ApiService {
    constructor() {
        // Détection automatique de l'environnement
        const currentPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        const currentHost = window.location.hostname;
        
        // Détection de l'environnement - FORCER LOCALHOST EN DÉVELOPPEMENT
        // Par défaut on passe par Nginx (Docker/prod). On ne force une connexion directe que
        // dans les scénarios de dev (ports Vite/React) ou si l'utilisateur l'a demandé explicitement.
        const searchParams = new URLSearchParams(window.location.search);
        const forceLocalBackend =
            searchParams.has('directBackend') ||
            window.localStorage?.getItem('sedi_force_local_backend') === '1';
        const devPorts = new Set(['5173', '4173', '3000', '5174', '8080']);
        const isClassicDevPort = devPorts.has(currentPort);
        const isLocalHost = currentHost === 'localhost' || currentHost === '127.0.0.1' || currentHost === '';
        // En local (localhost/127.0.0.1) avec port de dev OU port 8080 (http-server), utiliser backend direct
        const isLocalDev = forceLocalBackend || (isLocalHost && (isClassicDevPort || currentPort === '8080'));
        
        if (isLocalDev) {
            // Environnement de développement local - connexion directe au backend
            // Essayer d'abord le port de dev (3033), sinon le port standard (3001)
            this.baseUrl = `http://localhost:3033/api`;
            console.log('🔧 Mode développement local détecté - connexion directe au backend sur port 3033');
            if (forceLocalBackend && !isClassicDevPort) {
                console.log('⚠️ Force local backend activé via paramètre/stockage');
            }
        } else {
            // Environnement de production ou Docker - utiliser le proxy Nginx
            // Utiliser toujours le proxy pour éviter les problèmes de CORS et de connexion
            this.baseUrl = `${window.location.protocol}//${window.location.host}/api`;
            console.log('🌐 Mode production/Docker détecté - utilisation du proxy Nginx');
        }
        
        this.defaultHeaders = {
            'Content-Type': 'application/json'
        };
        
        // Rate limiting côté client
        this.requestQueue = [];
        this.isProcessing = false;
        this.lastRequestTime = 0;
        this.minRequestInterval = 100; // 100ms minimum entre les requêtes
        
        // Cache simple pour éviter les requêtes redondantes
        this.cache = new Map();
        this.cacheTimeout = 10000; // 10 secondes de cache par défaut
        
        console.log(`🔗 ApiService configuré pour: ${this.baseUrl}`);
        console.log(`🔍 Host détecté: ${currentHost}:${currentPort}`);
    }

    clearMemoryCacheByPrefix(prefix) {
        try {
            const p = String(prefix || '');
            if (!p) return;
            for (const k of this.cache.keys()) {
                if (String(k).startsWith(p)) this.cache.delete(k);
            }
        } catch (e) {
            // Non bloquant
        }
    }

    invalidateAfterMutation(endpoint) {
        const ep = String(endpoint || '');

        // Toute mutation opérateur / opérations peut impacter les vues admin (connectés / opérations)
        if (
            ep.startsWith('/operators/start') ||
            ep.startsWith('/operators/pause') ||
            ep.startsWith('/operators/resume') ||
            ep.startsWith('/operators/stop') ||
            ep.startsWith('/operators/login') ||
            ep.startsWith('/operators/logout')
        ) {
            this.clearMemoryCacheByPrefix('/admin/operators');
        }
    }

    // Méthode générique pour les requêtes avec rate limiting
    async request(endpoint, options = {}) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ endpoint, options, resolve, reject });
            this.processQueue();
        });
    }

    // Traitement de la file d'attente avec rate limiting
    async processQueue() {
        if (this.isProcessing || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.requestQueue.length > 0) {
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            
            if (timeSinceLastRequest < this.minRequestInterval) {
                await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
            }

            const { endpoint, options, resolve, reject } = this.requestQueue.shift();
            this.lastRequestTime = Date.now();

            try {
                const result = await this.executeRequest(endpoint, options);
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }

        this.isProcessing = false;
    }

    // Exécution réelle de la requête
    async executeRequest(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;

        // Admin auth token (si présent) - envoyé uniquement sur /auth et /admin
        const adminToken = window.sessionStorage?.getItem('sedi_admin_token') || '';
        const shouldAttachAdminToken = adminToken && (endpoint.startsWith('/admin') || endpoint.startsWith('/auth'));
        const authHeaders = shouldAttachAdminToken ? { Authorization: `Bearer ${adminToken}` } : {};

        const config = {
            headers: { ...this.defaultHeaders, ...authHeaders, ...options.headers },
            ...options
        };

        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                // Gestion spéciale pour l'erreur 429
                if (response.status === 429) {
                    const method = (config.method || 'GET').toUpperCase();
                    const retryAfterHeader = response.headers?.get?.('Retry-After');
                    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : null;
                    const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                        ? Math.min(retryAfterSeconds * 1000, 30000)
                        : 3000;
                    
                    console.warn(`⚠️ Rate limit atteint pour ${endpoint} (${method}), attente de ${Math.round(waitMs/1000)}s...`);
                    
                    // Essayer de récupérer le message d'erreur du serveur
                    let errorMessage = 'Trop de requêtes, veuillez patienter';
                    try {
                        const errorData = await response.json();
                        errorMessage = errorData.error || errorMessage;
                    } catch (e) {
                        // Ignorer si on ne peut pas parser le JSON
                    }

                    // ⚠️ Ne PAS retry automatiquement sur le login (évite les boucles et le spam)
                    if (endpoint === '/auth/login') {
                        const e = new Error(errorMessage);
                        e.errorCode = 'RATE_LIMIT';
                        e.retryAfterSeconds = retryAfterSeconds || Math.ceil(waitMs / 1000);
                        throw e;
                    }

                    // Retry uniquement pour les requêtes idempotentes (GET/HEAD)
                    if (method === 'GET' || method === 'HEAD') {
                        await new Promise(resolve => setTimeout(resolve, waitMs));
                        console.log(`🔄 Retry pour ${endpoint}...`);
                        const retryResponse = await fetch(url, config);
                        if (!retryResponse.ok) {
                            if (retryResponse.status === 429) {
                                const e = new Error(errorMessage);
                                e.errorCode = 'RATE_LIMIT';
                                e.retryAfterSeconds = retryAfterSeconds || Math.ceil(waitMs / 1000);
                                throw e;
                            }
                            throw new Error(`HTTP ${retryResponse.status}: ${retryResponse.statusText}`);
                        }
                        return await retryResponse.json();
                    }

                    const e = new Error(errorMessage);
                    e.errorCode = 'RATE_LIMIT';
                    e.retryAfterSeconds = retryAfterSeconds || Math.ceil(waitMs / 1000);
                    throw e;
                }
                
                const errorData = await response.json().catch(() => ({}));

                // Session opérateur expirée -> notifier l'app pour forcer retour écran login
                if (response.status === 401 && errorData && (errorData.security === 'SESSION_REQUIRED' || errorData.error === 'SESSION_REQUIRED')) {
                    try {
                        window.dispatchEvent(new CustomEvent('sedi:session-expired', { detail: { endpoint, errorData } }));
                    } catch (_) {
                        // ignore
                    }
                }
                
                // Build a comprehensive error message
                let errorMessage = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
                
                // Add message if available
                if (errorData.message) {
                    errorMessage += `: ${errorData.message}`;
                } else if (errorData.hint) {
                    errorMessage += `: ${errorData.hint}`;
                } else if (errorData.details) {
                    // Beaucoup de routes backend renvoient "details" (ex: erreurs SQL)
                    errorMessage += `: ${errorData.details}`;
                }
                
                // For specific errors, include additional context
                if (errorData.error === 'LT_DIR_NOT_FOUND' && errorData.launchNumber) {
                    errorMessage = `LT_DIR_NOT_FOUND: Le répertoire pour le lancement ${errorData.launchNumber} est introuvable`;
                    if (errorData.traceRoot) {
                        errorMessage += ` dans ${errorData.traceRoot}`;
                    }
                }
                
                const error = new Error(errorMessage);
                // Attach the full error data for detailed error handling
                error.errorCode = errorData.error;
                error.errorData = errorData;
                throw error;
            }

            const data = await response.json();
            // Invalider les caches mémoire qui deviennent faux après mutation
            if ((options.method || 'GET').toUpperCase() !== 'GET') {
                this.invalidateAfterMutation(endpoint);
            }
            return data;
        } catch (error) {
            // Ne pas logger les erreurs de réseau pour les health checks (évite le spam)
            if (endpoint === '/health' && (error.name === 'TypeError' || error.message.includes('Failed to fetch'))) {
                // Erreur silencieuse pour le health check - c'est normal si le serveur n'est pas accessible
                console.debug(`Health check échoué (serveur non accessible): ${url}`);
                throw new Error('SERVER_NOT_ACCESSIBLE');
            }
            
            console.error(`Erreur API ${endpoint}:`, error);
            throw error;
        }
    }

    // GET request
    async get(endpoint, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `${endpoint}?${queryString}` : endpoint;
        return this.request(url);
    }

    // POST request
    async post(endpoint, data = {}) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // PUT request
    async put(endpoint, data = {}) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    // DELETE request
    async delete(endpoint) {
        return this.request(endpoint, {
            method: 'DELETE'
        });
    }

    // Vérifier la santé du serveur
    async healthCheck() {
        try {
            return await this.get('/health');
        } catch (error) {
            // Si c'est une erreur de connexion, retourner un objet indiquant que le serveur n'est pas accessible
            if (error.message === 'SERVER_NOT_ACCESSIBLE' || error.name === 'TypeError') {
                return {
                    status: 'error',
                    message: 'Serveur non accessible',
                    accessible: false
                };
            }
            throw error;
        }
    }

    // Authentification admin
    async adminLogin(username, password) {
        return this.post('/auth/login', { username, password });
    }

    async adminLogout() {
        return this.post('/auth/logout');
    }

    async verifyAdmin() {
        return this.get('/auth/verify');
    }

    // Sessions opérateurs (pour cohérence et sécurité côté backend)
    async operatorLogin(code) {
        return this.post('/operators/login', { code });
    }

    async operatorLogout(code) {
        return this.post('/operators/logout', { code });
    }

    // Opérateurs
    async getOperator(code) {
        return this.get(`/operators/${code}`);
    }

    async createOperator(operatorData) {
        return this.post('/operators', operatorData);
    }

    async updateOperator(code, operatorData) {
        return this.put(`/operators/${code}`, operatorData);
    }

    async deleteOperator(code) {
        return this.delete(`/operators/${code}`);
    }

    // Lancements
    async getLancements(search = '', limit = 100) {
        return this.get('/lancements', { search, limit });
    }

    async getLancement(code) {
        return this.get(`/operators/lancement/${code}`);
    }

    async getActiveLancements() {
        return this.get('/lancements/active');
    }

    async getLancementsByOperator(operatorId, date = null) {
        return this.get(`/lancements/by-operator/${operatorId}`, { date });
    }

    async createLancement(lancementData) {
        return this.post('/lancements', lancementData);
    }

    async updateLancement(code, lancementData) {
        return this.put(`/lancements/${code}`, lancementData);
    }

    // Opérations
    async getLancementSteps(lancementCode) {
        return this.get(`/operators/steps/${encodeURIComponent(lancementCode)}`);
    }

    async startOperation(operatorId, lancementCode, { codeOperation } = {}) {
        return this.post('/operators/start', { operatorId, lancementCode, codeOperation });
    }

    async pauseOperation(operatorId, lancementCode, { codeOperation } = {}) {
        return this.post('/operators/pause', { operatorId, lancementCode, codeOperation });
    }

    async resumeOperation(operatorId, lancementCode, { codeOperation } = {}) {
        return this.post('/operators/resume', { operatorId, lancementCode, codeOperation });
    }

    async stopOperation(operatorId, lancementCode, { codeOperation } = {}) {
        return this.post('/operators/stop', { operatorId, lancementCode, codeOperation });
    }

    async getCurrentOperation(operatorId) {
        return this.get(`/operators/current/${operatorId}`);
    }

    async getOperationHistory(operatorId, date = null, limit = 50) {
        return this.get(`/operations/history/${operatorId}`, { date, limit });
    }

    // Admin
    async getAdminData(date) {
        return this.get('/admin', { date });
    }

    async getAdminStats(date) {
        return this.get('/admin/stats', { date });
    }

    // Modifier une opération (admin)
    async updateOperation(id, data) {
        return this.put(`/admin/operations/${id}`, data);
    }

    // Supprimer une opération (admin)
    async deleteOperation(id) {
        return this.delete(`/admin/operations/${id}`);
    }

    // Ajouter une nouvelle opération (admin)
    async addOperation(data) {
        return this.post('/admin/operations', data);
    }

    // Récupérer les informations des tables abetemps
    async getTablesInfo() {
        return this.get('/admin/tables-info');
    }

    // Récupérer la liste des opérateurs connectés (avec cache pour éviter le rate limiting)
    async getConnectedOperators(forceRefresh = false) {
        const cacheKey = '/admin/operators';
        const cached = this.cache.get(cacheKey);
        
        // Utiliser le cache si disponible et récent (< 10 secondes) et qu'on ne force pas le refresh
        if (!forceRefresh && cached && (Date.now() - cached.timestamp) < 10000) {
            console.log('📦 Utilisation du cache pour /admin/operators');
            return cached.data;
        }
        
        // Faire la requête
        const data = await this.get('/admin/operators');
        
        // Mettre en cache
        this.cache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
        
        return data;
    }

    // Récupérer tous les opérateurs (liste globale depuis RESSOURC)
    async getAllOperators(forceRefresh = false) {
        const cacheKey = '/admin/operators/all';
        const cached = this.cache.get(cacheKey);
        
        // Utiliser le cache si disponible et récent (< 10 minutes) car cette liste change rarement
        if (!forceRefresh && cached && (Date.now() - cached.timestamp) < 10 * 60 * 1000) {
            console.log('📦 Utilisation du cache pour /admin/operators/all');
            return cached.data;
        }
        
        // Faire la requête
        const data = await this.get('/admin/operators/all');
        
        // Mettre en cache
        this.cache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
        
        return data;
    }

    // Récupérer les lancements d'un opérateur spécifique
    async getOperatorOperations(operatorCode) {
        return this.get(`/admin/operators/${operatorCode}/operations`);
    }

    async getAdminOperations(date, filters = {}) {
        return this.get('/admin/operations', { date, ...filters });
    }

    // ===== Monitoring (ABTEMPS_OPERATEURS) =====
    async getMonitoringTemps(filters = {}) {
        return this.get('/admin/monitoring', filters);
    }

    async correctMonitoringTemps(tempsId, corrections = {}) {
        return this.put(`/admin/monitoring/${tempsId}`, corrections);
    }

    async deleteMonitoringTemps(tempsId) {
        return this.delete(`/admin/monitoring/${tempsId}`);
    }

    async validateMonitoringTemps(tempsId) {
        return this.post(`/admin/monitoring/${tempsId}/validate`, {});
    }

    async onHoldMonitoringTemps(tempsId) {
        return this.post(`/admin/monitoring/${tempsId}/on-hold`, {});
    }

    async transmitMonitoringTemps(tempsId, { triggerEdiJob = false, codeTache = null } = {}) {
        return this.post(`/admin/monitoring/${tempsId}/transmit`, { triggerEdiJob, codeTache });
    }

    async consolidateMonitoringBatch(operations) {
        return this.post('/admin/monitoring/consolidate-batch', { operations });
    }

    async validateAndTransmitMonitoringBatch(tempsIds, { triggerEdiJob = true, codeTache = null } = {}) {
        return this.post('/admin/monitoring/validate-and-transmit-batch', { tempsIds, triggerEdiJob, codeTache });
    }

    // ===== FSOP =====
    async getFsopLots(launchNumber) {
        return this.get(`/fsop/lots/${encodeURIComponent(launchNumber)}`);
    }

    // Export
    async exportOperations(date, format = 'csv') {
        return this.get(`/admin/export/${format}`, { date });
    }
    
    // Commentaires
    async addComment(operatorCode, operatorName, lancementCode, comment) {
        return this.post('/comments', {
            operatorCode,
            operatorName,
            lancementCode,
            comment
        });
    }

    async getCommentsByOperator(operatorCode, limit = 50) {
        return this.get(`/comments/operator/${operatorCode}`, { limit });
    }

    async getCommentsByLancement(lancementCode, limit = 50) {
        return this.get(`/comments/lancement/${lancementCode}`, { limit });
    }

    async getAllComments(limit = 100) {
        return this.get('/comments', { limit });
    }

    async deleteComment(commentId, operatorCode) {
        return this.delete(`/comments/${commentId}`, {
            body: JSON.stringify({ operatorCode })
        });
    }

    async testEmail() {
        return this.post('/comments/test-email');
    }

    async getCommentStats(period = 'today') {
        return this.get('/comments/stats', { period });
    }
    
    // Validation automatique d'un code de lancement
    async validateLancementCode(code) {
        try {
            console.log(`🔍 Validation du code: ${code}`);
            
            const response = await fetch(`${this.baseUrl}/admin/validate-lancement/${encodeURIComponent(code)}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.defaultHeaders
                }
            });
            
            if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
            }
            
            const result = await response.json();
            console.log(`✅ Résultat validation:`, result);
            
            return result;
            
        } catch (error) {
            console.error('❌ Erreur validation code lancement:', error);
            return {
                success: false,
                valid: false,
                error: 'Erreur de connexion lors de la validation'
            };
        }
    }

    async loadFsopData(launchNumber, templateCode, serialNumber) {
        return this.post('/fsop/load-data', {
            launchNumber,
            templateCode,
            serialNumber
        });
    }
}

export default ApiService;
