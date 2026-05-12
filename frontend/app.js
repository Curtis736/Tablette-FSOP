// Classe principale de l'application
import OperateurInterface from './OperateurInterface.js';
import AdminPage from './AdminPage.js';

class App {
    constructor() {
        this.currentScreen = 'login';
        this.currentOperator = null;
        this.operateurInterface = null;
        this.adminPage = null;
        
        this.initializeApp();
        this.setupEventListeners();
    }

    initializeApp() {
        // Vérifier si un opérateur est déjà connecté
        const savedOperator = localStorage.getItem('currentOperator');
        if (savedOperator) {
            this.currentOperator = JSON.parse(savedOperator);
            this.showOperatorScreen();
        } else {
            this.showLoginScreen();
        }
    }

    setupEventListeners() {
        // Gestion de la connexion
        document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('logoutBtn').addEventListener('click', () => this.handleLogout());
        
        // Navigation entre les écrans
        document.getElementById('backToOperatorBtn').addEventListener('click', () => this.showOperatorScreen());
        
        // Raccourcis clavier
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'a') {
                e.preventDefault();
                this.showAdminScreen();
            }
        });
    }

    async handleLogin(e) {
        e.preventDefault();
        const operatorCode = document.getElementById('operatorCode').value.trim();
        
        if (!operatorCode) {
            this.showNotification('Veuillez saisir un code opérateur', 'error');
            return;
        }
        
        try {
            this.showLoading(true);
            const response = await fetch(`${this.getApiBaseUrl()}/operators/${operatorCode}`, {
                cache: 'no-store',
                headers: { Accept: 'application/json' }
            });
            
            if (response.ok) {
                const operator = await response.json();
                this.currentOperator = operator;
                localStorage.setItem('currentOperator', JSON.stringify(operator));
                this.showOperatorScreen();
                this.showNotification(`Bienvenue ${operator.nom}`, 'success');
            } else {
                this.showNotification('Code opérateur invalide', 'error');
            }
        } catch (error) {
            console.error('Erreur de connexion:', error);
            this.showNotification('Erreur de connexion au serveur', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    handleLogout() {
        this.currentOperator = null;
        localStorage.removeItem('currentOperator');
        this.showLoginScreen();
        this.showNotification('Déconnexion réussie', 'info');
    }

    showLoginScreen() {
        this.hideAllScreens();
        document.getElementById('loginScreen').classList.add('active');
        document.getElementById('operatorCode').value = '';
        this.currentScreen = 'login';
    }

    showOperatorScreen() {
        this.hideAllScreens();
        document.getElementById('operatorScreen').classList.add('active');
        this.currentScreen = 'operator';
        
        if (this.currentOperator) {
            document.getElementById('currentOperator').textContent = this.currentOperator.nom;
            
            if (!this.operateurInterface) {
                this.operateurInterface = new OperateurInterface(this.currentOperator, this);
            }
            this.operateurInterface.loadLancements();
        }
    }

    showAdminScreen() {
        this.hideAllScreens();
        document.getElementById('adminScreen').classList.add('active');
        this.currentScreen = 'admin';
        
        if (!this.adminPage) {
            this.adminPage = new AdminPage(this);
        }
        this.adminPage.loadData();
    }

    hideAllScreens() {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
    }

    getApiBaseUrl() {
        // Utiliser la même logique de détection que ApiService
        const currentPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
        const currentHost = window.location.hostname;
        const isLocalDev = (currentHost === 'localhost' || currentHost === '127.0.0.1') && currentPort === '8080';
        
        if (isLocalDev) {
            return 'http://localhost:3033/api';
        } else {
            return `${window.location.protocol}//${window.location.host}/api`;
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 600;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        
        const colors = {
            success: '#28a745',
            error: '#dc3545',
            warning: '#ffc107',
            info: '#17a2b8'
        };
        
        notification.style.backgroundColor = colors[type] || colors.info;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    showLoading(show) {
        const buttons = document.querySelectorAll('button');
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