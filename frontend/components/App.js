// Classe principale de l'application
// Bump version to bust browser cache when OperateurInterface changes (sleep/wake prompt removal, timer, etc.)
import OperateurInterface from './OperateurInterface.js?v=20260309-cache-bust';
// Bump to bust cache when AdminPage logic changes (auto consolidation, etc.)
import AdminPage from './AdminPage.js?v=20260309-cache-bust';
import ApiService from '../services/ApiService.js?v=20260309-operator-session-cache-v2';
import StorageService from '../services/StorageService.js?v=20251007-final';
import notificationManager from '../utils/NotificationManager.js';

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

        setTimeout(() => {
            try {
                console.log('🌙 Minuit: déconnexion locale forcée');
                // Ne pas dépendre du réseau: vider local + UI
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
                    // Vérifier que la session est bien valide côté serveur (sinon forcer login)
                    try {
                        await this.apiService.getCurrentOperation(code);
                    } catch (_) {
                        this.storageService.clearCurrentOperator();
                        this.showLoginScreen();
                        return;
                    }
                    this.currentOperator = { ...savedOperator, ...validOperator };
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
        setInterval(() => this.runHealthCheck(), 30000);

        // Session expirée côté serveur -> retour login + nettoyage local
        window.addEventListener('sedi:session-expired', () => {
            try {
                this.currentOperator = null;
                this.storageService.clearCurrentOperator();
                this.showLoginScreen();
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
            const loginResp = await this.apiService.operatorLogin(operatorCode);
            const operator = loginResp?.operator || loginResp?.data?.operator || null;
            if (!operator) {
                throw new Error('Connexion opérateur impossible');
            }

            this.currentOperator = operator;
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
            console.log('🔐 Tentative de connexion admin:', username);
            this.showLoading(true);
            const response = await this.apiService.adminLogin(username, password);
            
            console.log('📡 Réponse du serveur:', response);
            
            if (response.success) {
                console.log('✅ Connexion admin réussie');
                if (response.token) {
                    window.sessionStorage?.setItem('sedi_admin_token', response.token);
                }
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

    async handleLogout() {
        // Fermer la session opérateur côté serveur (ne pas bloquer l'UI si erreur réseau)
        try {
            const code = this.currentOperator?.code || this.currentOperator?.id || null;
            if (code) await this.apiService.operatorLogout(code);
        } catch (e) {
            // Non bloquant
        }
        this.currentOperator = null;
        this.isAdmin = false;
        window.sessionStorage?.removeItem('sedi_admin_token');
        this.storageService.clearCurrentOperator();
        this.showLoginScreen();
        notificationManager.info('Déconnexion réussie');
    }

    showLoginScreen() {
        // Détruire proprement l'interface opérateur courante (arrête timers, intervals, etc.)
        if (this.operateurInterface) {
            try { this.operateurInterface.destroy(); } catch (e) { /* non bloquant */ }
            this.operateurInterface = null;
        }

        this.hideAllScreens();
        document.getElementById('loginScreen').classList.add('active');
        document.getElementById('operatorCode').value = '';
        this.currentScreen = 'login';

        this.currentOperator = null;

        // Vider le cache local pour éviter les données persistantes
        this.storageService.clearCurrentOperator();
        this.storageService.clearAllCache();
        this.apiService.cache.clear();
        console.log('🧹 Cache local + mémoire API vidés');
    }

    showOperatorScreen() {
        this.hideAllScreens();
        document.getElementById('operatorScreen').classList.add('active');
        this.currentScreen = 'operator';

        if (this.currentOperator) {
            document.getElementById('currentOperator').textContent = this.currentOperator.nom;

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
        let buttons = document.querySelectorAll(selectors.join(','));
        if (!buttons || buttons.length === 0) {
            // Fallback pour compatibilité si les sélecteurs ne trouvent rien
            buttons = document.querySelectorAll('button');
        }
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