// Classe principale de l'application
// Bump version to bust browser cache when OperateurInterface changes (session isolation, neutral LT state, etc.)
import OperateurInterface from './OperateurInterface.js?v=20260420-oi-v4';
// Bump to bust cache when AdminPage logic changes (auto consolidation, etc.)
import AdminPage from './AdminPage.js?v=20260408-admin-v2';
import ApiService from '../services/ApiService.js?v=20260420-session-context-v2';
import StorageService from '../services/StorageService.js?v=20251007-final';
import notificationManager from '../utils/NotificationManager.js';

// Bump this on deployments that change frontend behavior/state.
// When it changes, the app will auto-clear local caches to avoid stale UI states.
const APP_BUILD_ID = '2026-04-20.1';

class App {
    constructor() {
        this.currentScreen = 'login';
        this.currentOperator = null;
        this.isAdmin = false;
        this.operateurInterface = null;
        this.adminPage = null;
        this.apiService = new ApiService();
        this.storageService = new StorageService();
        this.notificationManager = notificationManager;
        
        // Rendre notificationManager accessible globalement
        window.notificationManager = notificationManager;
        
        this.initializeApp();
        this.setupEventListeners();
    }

    _scheduleMidnightLogout() {
        // À minuit (heure locale tablette), forcer retour écran login et vider l'état local
        const now = new Date();
        const next = new Date(now);
        next.setHours(0, 0, 0, 0);
        next.setDate(next.getDate() + 1);
        const delay = next.getTime() - now.getTime();

        if (this._midnightTimerId) clearTimeout(this._midnightTimerId);
        this._midnightTimerId = setTimeout(() => {
            try {
                console.log('🌙 Minuit: déconnexion locale forcée');
                const code = this.currentOperator?.code || this.currentOperator?.id;
                if (code) this.apiService.setOperatorSessionActive(code, false);
                this.currentOperator = null;
                this.isAdmin = false;
                window.sessionStorage?.removeItem('sedi_admin_token');
                this.storageService.clearCurrentOperator();
                this.showLoginScreen();
                notificationManager.info('Nouvelle journée: veuillez vous reconnecter');
            } finally {
                this._scheduleMidnightLogout();
            }
        }, delay);
    }

    async initializeApp() {
        // Auto-clear local cache on new deployments to avoid stale "residual cache" issues.
        try {
            const key = 'sedi_app_build_id';
            const prev = window.localStorage?.getItem(key) || '';
            if (prev && prev !== APP_BUILD_ID) {
                console.warn(`🧹 App build changed (${prev} -> ${APP_BUILD_ID}): clearing local caches`);
                window.sessionStorage?.removeItem('sedi_admin_token');
                this.apiService.clearOperatorSessions();
                this.storageService.clearCurrentOperator();
                this.storageService.clearAllCache?.();
            }
            window.localStorage?.setItem(key, APP_BUILD_ID);
        } catch (_) {
            // ignore
        }

        // Démarrer la déconnexion automatique quotidienne
        if (!this._midnightLogoutScheduled) {
            this._midnightLogoutScheduled = true;
            this._scheduleMidnightLogout();
        }

        // Sur un reload de page (même tablette), on restaure l'opérateur sans recréer de session.
        // La session reste valide côté serveur. Si elle a expiré, checkCurrentOperation() gérera
        // le cas et l'opérateur devra se reconnecter explicitement.
        const savedOperator = this.storageService.getCurrentOperator();
        if (savedOperator) {
            try {
                // Si l'opérateur a été sauvegardé un autre jour, ne jamais restaurer automatiquement
                const savedDate = this.storageService.getCurrentOperatorDate?.() || null;
                const today = new Date().toISOString().slice(0, 10);
                if (savedDate && savedDate !== today) {
                    this.storageService.clearCurrentOperator();
                    this.showLoginScreen();
                    return;
                }

                const code = savedOperator.code || savedOperator.id;
                console.log('🔍 Restauration opérateur (reload page):', code);
                // Simple vérification d'existence, sans créer de nouvelle session
                const validOperator = await this.apiService.getOperator(code);
                if (validOperator) {
                    // IMPORTANT: le backend exige maintenant x-operator-session-id
                    // sur /operators/* (hors login). Poser le contexte AVANT getCurrentOperation.
                    const restoredSessionId = savedOperator?.sessionId || null;
                    if (code && restoredSessionId) {
                        this.apiService.setCurrentOperatorContext(code, restoredSessionId);
                    }
                    // Vérifier que la session est bien valide côté serveur (sinon forcer login)
                    try {
                        await this.apiService.getCurrentOperation(code);
                    } catch (_) {
                        this.apiService.setCurrentOperatorContext(null, null);
                        this.storageService.clearCurrentOperator();
                        this.showLoginScreen();
                        return;
                    }
                    this.currentOperator = { ...savedOperator, ...validOperator };
                    const restoredCode = this.currentOperator?.code || this.currentOperator?.id;
                    const mergedSessionId = this.currentOperator?.sessionId || restoredSessionId || null;
                    if (restoredCode) this.apiService.setOperatorSessionActive(restoredCode, true);
                    if (restoredCode && mergedSessionId) this.apiService.setCurrentOperatorContext(restoredCode, mergedSessionId);
                    this.storageService.setCurrentOperator(this.currentOperator);
                    this.showOperatorScreen();
                    console.log('✅ Opérateur restauré:', validOperator.nom);
                } else {
                    this.storageService.clearCurrentOperator();
                    this.showLoginScreen();
                }
            } catch (error) {
                console.error('❌ Erreur restauration opérateur:', error);
                this.storageService.clearCurrentOperator();
                this.showLoginScreen();
            }
        } else {
            this.showLoginScreen();
        }
    }

    setupEventListeners() {
        // Gestion de la connexion
        document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('adminLoginForm').addEventListener('submit', (e) => this.handleAdminLogin(e));
        document.getElementById('logoutBtn').addEventListener('click', () => this.handleLogout());
        
        // Navigation entre les écrans
        document.getElementById('backToOperatorBtn').addEventListener('click', () => this.showOperatorScreen());
        document.getElementById('adminModeBtn').addEventListener('click', () => this.showAdminLoginScreen());
        
        // Bouton retour de la page admin login
        const backToLoginBtn = document.getElementById('backToLoginBtn');
        if (backToLoginBtn) {
            backToLoginBtn.addEventListener('click', () => this.showLoginScreen());
        }
        
        // Raccourcis clavier
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'a') {
                e.preventDefault();
                this.showAdminLoginScreen();
            }
        });

        // Gestion des erreurs globales
        window.addEventListener('error', (e) => {
            console.error('Erreur globale:', e.error);
            notificationManager.error('Une erreur inattendue s\'est produite');
        });

        // Vérification de la connexion (seulement si un opérateur est connecté)
        this.lastHealthStatus = true;
        this._healthCheckInterval = setInterval(() => this.runHealthCheck(), 30000);

        // Session expirée côté serveur -> retour login + nettoyage local
        window.addEventListener('sedi:session-expired', () => {
            try {
                this.currentOperator = null;
                this.storageService.clearCurrentOperator();
                this.showLoginScreen();
                this.apiService.clearOperatorSessions();
                notificationManager.warning('Session expirée: veuillez vous reconnecter');
            } catch (_) {
                // ignore
            }
        });

    }

    async runHealthCheck() {
        if (!this.currentOperator) return;
        try {
            const health = await this.apiService.healthCheck();
            const isAccessible = health.accessible !== false && health.status !== 'error';
            if (this.lastHealthStatus && !isAccessible) {
                notificationManager.warning('Connexion au serveur perdue. Vérifiez votre connexion réseau.');
            } else if (!this.lastHealthStatus && isAccessible) {
                notificationManager.success('Connexion au serveur rétablie');
            }
            this.lastHealthStatus = isAccessible;
        } catch (error) {
            if (error.message !== 'SERVER_NOT_ACCESSIBLE') {
                console.debug('Health check échoué:', error);
            }
            if (this.lastHealthStatus) {
                this.lastHealthStatus = false;
            }
        }
    }

    async handleLogin(e) {
        e.preventDefault();
        const operatorCode = document.getElementById('operatorCode').value.trim();
        
        if (!operatorCode) {
            notificationManager.error('Veuillez saisir un code opérateur');
            return;
        }
        
        try {
            this.showLoading(true);
            // Mode tablette mono-opérateur: repartir d'un état local propre à chaque login.
            this.apiService.clearOperatorSessions();
            this.storageService.clearCurrentOperator();
            const loginResp = await this.apiService.operatorLogin(operatorCode);
            const operator = loginResp?.operator || loginResp?.data?.operator || null;
            if (!operator) {
                throw new Error('Connexion opérateur impossible');
            }

            this.currentOperator = operator;
            const code = operator.code || operator.id;
            const sessionId = operator.sessionId || null;
            if (code) this.apiService.setOperatorSessionActive(code, true);
            if (code && sessionId) this.apiService.setCurrentOperatorContext(code, sessionId);
            this.storageService.setCurrentOperator(operator);
            this.showOperatorScreen();
            notificationManager.success(`Bienvenue ${operator.nom}`);
        } catch (error) {
            console.error('Erreur de connexion:', error);
            notificationManager.error(error.message || 'Erreur de connexion au serveur');
        } finally {
            this.showLoading(false);
        }
    }

    async handleAdminLogin(e) {
        e.preventDefault();
        const username = document.getElementById('adminUsername').value.trim();
        const password = document.getElementById('adminPassword').value.trim();
        
        if (!username || !password) {
            notificationManager.error('Veuillez saisir le nom d\'utilisateur et le mot de passe');
            return;
        }
        
        try {
            this.showLoading(true);
            const response = await this.apiService.adminLogin(username, password);
            
            if (response.success) {
                console.log('✅ Connexion admin réussie');
                if (response.token) this.apiService.setAdminToken(response.token);
                this.isAdmin = true;
                this.showAdminScreen();
                notificationManager.success(`Bienvenue ${response.user.name}`);
            } else {
                console.log('❌ Identifiants invalides');
                notificationManager.error('Identifiants invalides');
            }
        } catch (error) {
            console.error('❌ Erreur de connexion admin:', error);
            notificationManager.error(error.message || 'Erreur de connexion au serveur');
        } finally {
            this.showLoading(false);
        }
    }

    handleLogout() {
        // Nettoyer l'UI immédiatement (ne pas bloquer sur le réseau)
        const code = this.currentOperator?.code || this.currentOperator?.id || null;
        this.currentOperator = null;
        this.isAdmin = false;
        this.apiService.setAdminToken('');
        this.apiService.clearOperatorSessions();
        this.storageService.clearCurrentOperator();
        this.showLoginScreen();
        notificationManager.info('Déconnexion réussie');

        // Fermer la session opérateur côté serveur en arrière-plan
        if (code) {
            Promise.resolve()
                .then(() => this.apiService.operatorLogout(code))
                .catch(() => {});
        }
    }

    showLoginScreen() {
        // Détruire proprement l'interface opérateur courante (arrête timers, intervals, etc.)
        if (this.operateurInterface) {
            try { this.operateurInterface.destroy(); } catch (e) { /* non bloquant */ }
            this.operateurInterface = null;
        }

        this.hideAllScreens();
        const loginScreenEl = document.getElementById('loginScreen');
        if (loginScreenEl && loginScreenEl.classList) {
            loginScreenEl.classList.add('active');
        }
        const operatorCodeEl = document.getElementById('operatorCode');
        if (operatorCodeEl) {
            operatorCodeEl.value = '';
        }
        this.currentScreen = 'login';

        this.currentOperator = null;

        // Vider le cache local pour éviter les données persistantes
        this.storageService.clearCurrentOperator();
        this.storageService.clearAllCache();
        this.apiService.cache?.clear?.();
        console.log('🧹 Cache local + mémoire API vidés');
    }

    showOperatorScreen() {
        this.hideAllScreens();
        const operatorScreenEl = document.getElementById('operatorScreen');
        if (operatorScreenEl && operatorScreenEl.classList) {
            operatorScreenEl.classList.add('active');
        }
        this.currentScreen = 'operator';

        if (this.currentOperator) {
            const currentOperatorEl = document.getElementById('currentOperator');
            if (currentOperatorEl) currentOperatorEl.textContent = this.currentOperator.nom;

            // Toujours recréer une interface fraîche pour éviter les fuites de timers/état
            if (this.operateurInterface) {
                try { this.operateurInterface.destroy(); } catch (e) { /* non bloquant */ }
                this.operateurInterface = null;
            }
            this.operateurInterface = new OperateurInterface(this.currentOperator, this);
            this.operateurInterface.loadLancements();
        }
    }

    showAdminLoginScreen() {
        this.hideAllScreens();
        document.getElementById('adminLoginScreen').classList.add('active');
        this.currentScreen = 'adminLogin';
        document.getElementById('adminUsername').value = '';
        document.getElementById('adminPassword').value = '';
    }

    showAdminScreen() {
        console.log('🔄 App.showAdminScreen() - Début');
        this.hideAllScreens();
        document.getElementById('adminScreen').classList.add('active');
        this.currentScreen = 'admin';
        
        console.log('🏗️ Création/récupération AdminPage...');
        
        // Attendre que l'écran soit complètement affiché avant de créer AdminPage
        setTimeout(() => {
            if (!this.adminPage) {
                console.log('🆕 Création nouvelle AdminPage');
                this.adminPage = new AdminPage(this);
                // Rendre adminPage accessible globalement pour la pagination
                window.adminPage = this.adminPage;
            } else {
                console.log('♻️ Utilisation AdminPage existante');
            }
            
            console.log('📊 Chargement des données admin...');
            this.adminPage.loadData();
        }, 200);
        console.log('✅ App.showAdminScreen() - Terminé');
    }

    hideAllScreens() {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
    }

    getApiService() {
        return this.apiService;
    }

    getNotificationManager() {
        return this.notificationManager;
    }

    getStorageService() {
        return this.storageService;
    }

    showNotification(message, type = 'info') {
        notificationManager.show(message, type);
    }

    showLoading(show) {
        // Limiter le chargement aux boutons des formulaires de connexion
        const selectors = ['#loginForm button', '#adminLoginForm button'];
        const buttons = document.querySelectorAll(selectors.join(','));
        buttons.forEach(btn => {
            if (show) {
                btn.disabled = true;
                const originalText = btn.innerHTML;
                btn.setAttribute('data-original-text', originalText);
                btn.innerHTML = '<span class="loading"></span> Chargement...';
            } else {
                btn.disabled = false;
                const originalText = btn.getAttribute('data-original-text');
                if (originalText) {
                    btn.innerHTML = originalText;
                }
            }
        });
    }

    getCurrentOperator() {
        return this.currentOperator;
    }

    getCurrentScreen() {
        return this.currentScreen;
    }
}

export default App;