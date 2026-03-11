// Service pour gérer le stockage local
class StorageService {
    constructor() {
        this.keys = {
            CURRENT_OPERATOR: 'currentOperator',
            CURRENT_OPERATOR_DATE: 'currentOperatorDate',
            USER_PREFERENCES: 'userPreferences',
            APP_SETTINGS: 'appSettings',
            CACHE_DATA: 'cacheData'
        };
    }

    // Opérateur actuel
    getCurrentOperator() {
        try {
            const operator = localStorage.getItem(this.keys.CURRENT_OPERATOR);
            return operator ? JSON.parse(operator) : null;
        } catch (error) {
            console.error('Erreur lors de la récupération de l\'opérateur:', error);
            return null;
        }
    }

    setCurrentOperator(operator) {
        try {
            if (operator) {
                localStorage.setItem(this.keys.CURRENT_OPERATOR, JSON.stringify(operator));
                // Marquer le jour où l'opérateur a été mis en session locale
                const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
                localStorage.setItem(this.keys.CURRENT_OPERATOR_DATE, today);
            } else {
                localStorage.removeItem(this.keys.CURRENT_OPERATOR);
                localStorage.removeItem(this.keys.CURRENT_OPERATOR_DATE);
            }
        } catch (error) {
            console.error('Erreur lors de la sauvegarde de l\'opérateur:', error);
        }
    }

    clearCurrentOperator() {
        localStorage.removeItem(this.keys.CURRENT_OPERATOR);
        localStorage.removeItem(this.keys.CURRENT_OPERATOR_DATE);
    }

    getCurrentOperatorDate() {
        try {
            return localStorage.getItem(this.keys.CURRENT_OPERATOR_DATE) || null;
        } catch (_) {
            return null;
        }
    }

    // Préférences utilisateur
    getUserPreferences() {
        try {
            const preferences = localStorage.getItem(this.keys.USER_PREFERENCES);
            return preferences ? JSON.parse(preferences) : this.getDefaultPreferences();
        } catch (error) {
            console.error('Erreur lors de la récupération des préférences:', error);
            return this.getDefaultPreferences();
        }
    }

    setUserPreferences(preferences) {
        try {
            const currentPrefs = this.getUserPreferences();
            const updatedPrefs = { ...currentPrefs, ...preferences };
            localStorage.setItem(this.keys.USER_PREFERENCES, JSON.stringify(updatedPrefs));
        } catch (error) {
            console.error('Erreur lors de la sauvegarde des préférences:', error);
        }
    }

    getDefaultPreferences() {
        return {
            theme: 'light',
            language: 'fr',
            autoRefresh: true,
            refreshInterval: 30000,
            notifications: true,
            soundEnabled: true,
            dateFormat: 'DD/MM/YYYY',
            timeFormat: '24h'
        };
    }

    // Paramètres de l'application
    getAppSettings() {
        try {
            const settings = localStorage.getItem(this.keys.APP_SETTINGS);
            return settings ? JSON.parse(settings) : this.getDefaultSettings();
        } catch (error) {
            console.error('Erreur lors de la récupération des paramètres:', error);
            return this.getDefaultSettings();
        }
    }

    setAppSettings(settings) {
        try {
            const currentSettings = this.getAppSettings();
            const updatedSettings = { ...currentSettings, ...settings };
            localStorage.setItem(this.keys.APP_SETTINGS, JSON.stringify(updatedSettings));
        } catch (error) {
            console.error('Erreur lors de la sauvegarde des paramètres:', error);
        }
    }

    getDefaultSettings() {
        // Utiliser une URL relative pour éviter les problèmes de connexion
        // L'ApiService gère la détection de l'environnement
        const currentPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        const currentHost = window.location.hostname;
        const isLocalDev = (currentHost === 'localhost' || currentHost === '127.0.0.1') && currentPort === '8080';
        
        return {
            apiUrl: isLocalDev ? 'http://localhost:3033/api' : `${window.location.protocol}//${window.location.host}/api`,
            timeout: 30000,
            retryAttempts: 3,
            cacheEnabled: true,
            cacheTimeout: 300000, // 5 minutes
            debugMode: false
        };
    }

    // Cache de données
    setCacheData(key, data, ttl = 300000) { // TTL par défaut: 5 minutes
        try {
            const cacheItem = {
                data,
                timestamp: Date.now(),
                ttl
            };
            localStorage.setItem(`${this.keys.CACHE_DATA}_${key}`, JSON.stringify(cacheItem));
        } catch (error) {
            console.error('Erreur lors de la mise en cache:', error);
        }
    }

    getCacheData(key) {
        try {
            const cacheItem = localStorage.getItem(`${this.keys.CACHE_DATA}_${key}`);
            if (!cacheItem) return null;

            const parsed = JSON.parse(cacheItem);
            const now = Date.now();
            
            // Vérifier si le cache a expiré
            if (now - parsed.timestamp > parsed.ttl) {
                this.clearCacheData(key);
                return null;
            }

            return parsed.data;
        } catch (error) {
            console.error('Erreur lors de la récupération du cache:', error);
            return null;
        }
    }

    clearCacheData(key) {
        localStorage.removeItem(`${this.keys.CACHE_DATA}_${key}`);
    }

    clearAllCache() {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(this.keys.CACHE_DATA)) {
                localStorage.removeItem(key);
            }
        });
    }

    // Méthodes utilitaires
    clearAll() {
        localStorage.clear();
    }

    getStorageSize() {
        let total = 0;
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                total += localStorage[key].length + key.length;
            }
        }
        return total;
    }

    isStorageAvailable() {
        try {
            const test = 'test';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (error) {
            return false;
        }
    }

    // Gestion des sessions
    createSession(operatorId) {
        const session = {
            operatorId,
            startTime: new Date().toISOString(),
            lastActivity: new Date().toISOString()
        };
        localStorage.setItem('currentSession', JSON.stringify(session));
    }

    getCurrentSession() {
        try {
            const session = localStorage.getItem('currentSession');
            return session ? JSON.parse(session) : null;
        } catch (error) {
            return null;
        }
    }

    updateSessionActivity() {
        const session = this.getCurrentSession();
        if (session) {
            session.lastActivity = new Date().toISOString();
            localStorage.setItem('currentSession', JSON.stringify(session));
        }
    }

    clearSession() {
        localStorage.removeItem('currentSession');
    }
}

export default StorageService;
