// Page d'administration - v20251014-fixed-v4
import TimeUtils from '../utils/TimeUtils.js';

class AdminPage {
    constructor(app) {
        this.app = app;
        this.apiService = app.getApiService();
        this.notificationManager = app.getNotificationManager();
        this.operations = [];
        this.stats = {};
        this.pagination = null;
        this.currentPage = 1;
        this.transferSelectionIds = new Set(); // sélection dans la modale de transfert (TempsId)
        
        // Système de sauvegarde automatique
        this.autoSaveEnabled = true;
        this.autoSaveInterval = 30000; // 30 secondes
        this.pendingChanges = new Map(); // Map des modifications en attente
        this.autoSaveTimer = null;
        
        console.log('AdminPage constructor - Initialisation');
        console.log('ApiService:', this.apiService);
        console.log('NotificationManager:', this.notificationManager);
        
        // Initialisation immédiate (le DOM devrait être prêt maintenant)
        this.initializeElements();
        this.setupEventListeners();
        this.startAutoSave();
    }

    initializeElements() {
        console.log('AdminPage.initializeElements() - Recherche des éléments DOM');
        
        // Attendre que le DOM soit complètement chargé
        const elements = {
            refreshDataBtn: 'refreshDataBtn',
            totalOperators: 'totalOperators',
            activeLancements: 'activeLancements',
            pausedLancements: 'pausedLancements',
            completedLancements: 'completedLancements',
            operationsTableBody: 'operationsTableBody',
            operatorSelect: 'operatorFilter',

            // Modal transfert
            transferSelectionModal: 'transferSelectionModal',
            transferModalTableBody: 'transferModalTableBody',
            closeTransferModalBtn: 'closeTransferModalBtn',
            transferSelectedConfirmBtn: 'transferSelectedConfirmBtn',
            transferSelectAll: 'transferSelectAll'
        };
        
        // Initialiser les éléments avec vérification
        Object.keys(elements).forEach(key => {
            const elementId = elements[key];
            this[key] = document.getElementById(elementId);
            
            if (!this[key]) {
                console.warn(`⚠️ Élément non trouvé: ${elementId}`);
                // Créer un élément de fallback pour éviter les erreurs
                if (key === 'operationsTableBody') {
                    this[key] = document.createElement('tbody');
                    this[key].id = elementId;
                }
            } else {
                console.log(`✅ Élément trouvé: ${elementId}`);
            }
        });
        
        console.log('Éléments initialisés:', Object.keys(elements).map(key => ({
            name: key,
            found: !!this[key]
        })));
    }

    addEventListenerSafe(elementId, eventType, handler) {
        try {
            const element = document.getElementById(elementId);
            if (element && typeof element.addEventListener === 'function') {
                element.addEventListener(eventType, handler);
                console.log(`Listener ajouté: ${elementId} (${eventType})`);
            } else {
                console.warn(`Élément non trouvé ou invalide: ${elementId}`);
            }
        } catch (error) {
            console.error(`Erreur ajout listener ${elementId}:`, error);
        }
    }

    setupEventListeners() {
        console.log('setupEventListeners - Début');
        
        // Attendre un peu que le DOM soit complètement prêt
        setTimeout(() => {
            try {
                // Bouton Actualiser
                const refreshBtn = document.getElementById('refreshDataBtn');
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', () => {
                        // Réinitialiser le compteur d'erreurs pour permettre un nouveau chargement
                        this.resetConsecutiveErrors();
                        this.loadData();
                    });
                    console.log('Listener ajouté: refreshDataBtn');
                }

                // Modale transfert
                const closeTransferModalBtn = document.getElementById('closeTransferModalBtn');
                if (closeTransferModalBtn) {
                    closeTransferModalBtn.addEventListener('click', () => this.hideTransferModal());
                    console.log('Listener ajouté: closeTransferModalBtn');
                }

                const transferSelectedConfirmBtn = document.getElementById('transferSelectedConfirmBtn');
                if (transferSelectedConfirmBtn) {
                    transferSelectedConfirmBtn.addEventListener('click', () => this.confirmTransferFromModal());
                    console.log('Listener ajouté: transferSelectedConfirmBtn');
                }

                const transferSelectAll = document.getElementById('transferSelectAll');
                if (transferSelectAll) {
                    transferSelectAll.addEventListener('change', () => this.toggleTransferSelectAll(transferSelectAll.checked));
                    console.log('Listener ajouté: transferSelectAll');
                }
                
                // Menu déroulant opérateurs
                const operatorSelect = document.getElementById('operatorFilter');
                if (operatorSelect) {
                    operatorSelect.addEventListener('change', () => this.handleOperatorChange());
                    console.log('Listener ajouté: operatorSelect');
                }
                
                // Filtre de statut
                const statusFilter = document.getElementById('statusFilter');
                if (statusFilter) {
                    statusFilter.addEventListener('change', () => {
                        console.log('🔄 Filtre de statut changé:', statusFilter.value);
                        this.updateOperationsTable();
                    });
                    console.log('Listener ajouté: statusFilter');
                }
                
                // Filtre de recherche
                const searchFilter = document.getElementById('searchFilter');
                if (searchFilter) {
                    searchFilter.addEventListener('input', () => {
                        console.log('🔄 Filtre de recherche changé:', searchFilter.value);
                        this.updateOperationsTable();
                    });
                    console.log('Listener ajouté: searchFilter');
                }
                
                // Bouton effacer filtres
                const clearFiltersBtn = document.getElementById('clearFiltersBtn');
                if (clearFiltersBtn) {
                    clearFiltersBtn.addEventListener('click', () => {
                        if (operatorSelect) operatorSelect.value = '';
                        if (statusFilter) statusFilter.value = '';
                        if (searchFilter) searchFilter.value = '';
                        this.loadData();
                    });
                    console.log('Listener ajouté: clearFiltersBtn');
                }
                
                   // Bouton Transfert
                   const transferBtn = document.getElementById('transferBtn');
                   if (transferBtn) {
                       transferBtn.addEventListener('click', () => this.handleTransfer());
                       console.log('Listener ajouté: transferBtn');
                   }
                   
                   // Bouton Ajouter une ligne
                   const addOperationBtn = document.getElementById('addOperationBtn');
                   if (addOperationBtn) {
                       addOperationBtn.addEventListener('click', () => this.handleAddOperation());
                       console.log('Listener ajouté: addOperationBtn');
                   }
                
                // Tableau des opérations
                const tableBody = document.getElementById('operationsTableBody');
                if (tableBody) {
                    tableBody.addEventListener('click', (e) => {
                        if (e.target.closest('.btn-delete')) {
                            const btn = e.target.closest('.btn-delete');
                            const id = btn.dataset.id;
                            console.log('🗑️ Clic sur bouton supprimer, ID:', id);
                            this.deleteMonitoringRecord(id);
                        } else if (e.target.closest('.btn-edit')) {
                            e.preventDefault();
                            e.stopPropagation();
                            const btn = e.target.closest('.btn-edit');
                            const id = btn.dataset.id;
                            console.log('✏️ Clic sur bouton modifier détecté');
                            console.log('🔍 ID récupéré:', id, 'Type:', typeof id);
                            console.log('🔍 Bouton:', btn);
                            console.log('🔍 Dataset complet:', btn.dataset);
                            console.log('🔍 Opérations disponibles:', this.operations.length);
                            console.log('🔍 IDs disponibles:', this.operations.map(op => ({ id: op.id, type: typeof op.id })));
                            
                            if (!id) {
                                console.error('❌ ID manquant sur le bouton!');
                                this.notificationManager.error('Erreur: ID manquant sur le bouton d\'édition');
                                return;
                            }
                            
                            try {
                                this.editMonitoringRecord(id);
                            } catch (error) {
                                console.error('❌ Erreur lors de l\'édition:', error);
                                this.notificationManager.error(`Erreur lors de l'édition: ${error.message}`);
                            }
                        }
                    });
                    console.log('Listener ajouté: operationsTableBody');
                }
                
                console.log('Tous les listeners ajoutés avec succès');
                
            } catch (error) {
                console.error('Erreur lors de l\'ajout des listeners:', error);
            }
        }, 300);
        
        // Actualisation automatique avec retry en cas d'erreur
        // Auto-refresh plus fréquent pour les mises à jour temps réel
        this.lastEditTime = 0; // Timestamp de la dernière édition pour éviter le rechargement immédiat
        this.consecutiveErrors = 0; // Compteur d'erreurs consécutives
        this.maxConsecutiveErrors = 3; // Arrêter le refresh après 3 erreurs consécutives
        
        this.refreshInterval = setInterval(() => {
            // Ne pas recharger si trop d'erreurs consécutives
            if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                console.log(`⏸️ Refresh automatique désactivé (${this.consecutiveErrors} erreurs consécutives)`);
                return;
            }
            
            // Ne pas recharger si une édition vient d'être effectuée (dans les 5 dernières secondes)
            const timeSinceLastEdit = Date.now() - this.lastEditTime;
            if (!this.isLoading && timeSinceLastEdit > 5000) {
                this.loadDataWithRetry();
            } else if (timeSinceLastEdit <= 5000) {
                console.log(`⏸️ Rechargement automatique ignoré (édition récente il y a ${Math.round(timeSinceLastEdit/1000)}s)`);
            }
        }, 15000); // Toutes les 15 secondes (réduit pour éviter le rate limiting)

        // Mise à jour temps réel des opérateurs connectés (réduit pour éviter le rate limiting)
        this.lastOperatorsUpdate = 0; // Timestamp de la dernière mise à jour des opérateurs
        this.operatorsInterval = setInterval(() => {
            // Ne pas mettre à jour si trop d'erreurs
            if (this.consecutiveErrors < this.maxConsecutiveErrors) {
                // Vérifier si on a des données récentes (< 10 secondes) pour éviter les requêtes redondantes
                const timeSinceLastUpdate = Date.now() - this.lastOperatorsUpdate;
                if (timeSinceLastUpdate < 10000) {
                    console.log(`⏸️ Mise à jour opérateurs ignorée (données récentes il y a ${Math.round(timeSinceLastUpdate/1000)}s)`);
                    return;
                }
                this.updateOperatorsStatus();
            }
        }, 15000); // Toutes les 15 secondes (au lieu de 5) pour réduire le rate limiting
    }

    async loadData() {
        if (this.isLoading) {
            console.log('Chargement déjà en cours, ignorer...');
            return;
        }
        
        try {
            console.log('DEBUT loadData()');
            this.isLoading = true;
            
            // Charger les opérateurs connectés et les données admin en parallèle avec timeout
            // Utiliser la date du jour pour récupérer les données
            const today = new Date().toISOString().split('T')[0];
            
            // Créer des promesses avec timeout
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout: La requête a pris trop de temps')), 30000)
            );
            
            const dataPromise = Promise.all([
                this.apiService.getAdminData(today),
                this.apiService.getConnectedOperators(),
                this.loadMonitoringRecords(today)
            ]);
            
            const [adminData, operatorsData] = await Promise.race([
                dataPromise,
                timeoutPromise
            ]);
            
            // Les données sont déjà parsées par ApiService
            const data = adminData;
            
            console.log('DONNEES BRUTES:', data);
            console.log('OPERATEURS CONNECTES:', operatorsData);
            
            // Réinitialiser le compteur d'erreurs en cas de succès
            this.consecutiveErrors = 0;
            
            // Stats/pagination: proviennent de /api/admin
            this.pagination = data?.pagination || null;
            
            if (data && data.stats) {
                this.stats = data.stats;
                console.log('STATS ASSIGNEES:', this.stats);
            } else {
                console.log('PAS DE STATS DANS LA REPONSE - Utilisation des valeurs par défaut');
                this.stats = {
                    totalOperators: 0,
                    activeLancements: 0,
                    pausedLancements: 0,
                    completedLancements: 0
                };
            }
            
            // Mettre à jour le menu déroulant des opérateurs
            if (operatorsData && operatorsData.success && operatorsData.operators) {
                this.updateOperatorSelect(operatorsData.operators);
                this.lastOperatorsUpdate = Date.now(); // Mettre à jour le timestamp
            } else if (operatorsData && operatorsData.operators) {
                // Fallback si success n'est pas défini
                this.updateOperatorSelect(operatorsData.operators);
                this.lastOperatorsUpdate = Date.now(); // Mettre à jour le timestamp
            }
            
            console.log('🔄 APPEL updateStats()');
            this.updateStats();
            
            console.log('🔄 APPEL updateOperationsTable()');
            this.updateOperationsTable();
            
            console.log('🔄 APPEL updatePaginationInfo()');
            this.updatePaginationInfo();
            
            console.log('✅ FIN loadData()');
        } catch (error) {
            console.error('❌ ERREUR loadData():', error);
            
            // Incrémenter le compteur d'erreurs
            this.consecutiveErrors++;
            
            // Afficher un message d'erreur plus informatif
            let errorMessage = 'Erreur de connexion au serveur';
            if (error.message.includes('Timeout')) {
                errorMessage = 'Le serveur met trop de temps à répondre. Vérifiez votre connexion.';
            } else if (error.message.includes('HTTP')) {
                errorMessage = `Erreur serveur: ${error.message}`;
            } else if (error.message.includes('fetch')) {
                errorMessage = 'Impossible de contacter le serveur';
            }
            
            // Ne pas spammer les notifications si trop d'erreurs
            if (this.consecutiveErrors <= 2) {
                this.notificationManager.error(errorMessage);
            } else if (this.consecutiveErrors === this.maxConsecutiveErrors) {
                this.notificationManager.warning('Chargement automatique désactivé après plusieurs erreurs. Cliquez sur "Actualiser" pour réessayer.');
            }
            
            // Afficher les données en cache si disponibles
            if (this.operations.length > 0) {
                if (this.consecutiveErrors <= 2) {
                    this.notificationManager.info('Affichage des données en cache');
                }
                this.updateOperationsTable();
            } else {
                // Afficher un message dans le tableau
                this.showNoDataMessage();
            }
            
            // Relancer l'erreur pour que loadDataWithRetry puisse la gérer
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    async loadDataWithRetry(maxRetries = 1) {
        // Réduire les tentatives pour éviter les boucles infinies
        // Le setInterval se chargera de réessayer plus tard
        try {
            await this.loadData();
        } catch (error) {
            console.warn(`Échec du chargement:`, error.message);
            // Ne pas réessayer immédiatement, laisser le setInterval gérer
            // Cela évite les boucles infinies
        }
    }
    
    // Méthode pour réactiver le refresh automatique
    resetConsecutiveErrors() {
        this.consecutiveErrors = 0;
        console.log('✅ Compteur d\'erreurs réinitialisé, refresh automatique réactivé');
    }

    // ===== Monitoring (ABTEMPS_OPERATEURS) =====
    async loadMonitoringRecords(date) {
        try {
            const statutTraitement = document.getElementById('statusFilter')?.value || undefined;
            const operatorCode = document.getElementById('operatorFilter')?.value || undefined;
            const lancementCode = document.getElementById('searchFilter')?.value?.trim() || undefined;

            const filters = { date };
            if (statutTraitement) filters.statutTraitement = statutTraitement;
            if (operatorCode) filters.operatorCode = operatorCode;
            if (lancementCode) filters.lancementCode = lancementCode;

            // Charger les enregistrements consolidés depuis ABTEMPS_OPERATEURS
            const result = await this.apiService.getMonitoringTemps(filters);
            let consolidatedOps = [];
            if (result && result.success) {
                consolidatedOps = result.data || [];
            }
            
            // Si aucun enregistrement consolidé et pas de filtre de statut, charger aussi depuis ABHISTORIQUE_OPERATEURS
            // (les opérations non consolidées)
            if (consolidatedOps.length === 0 && !statutTraitement) {
                console.log('📊 Aucun enregistrement consolidé trouvé, chargement depuis ABHISTORIQUE_OPERATEURS...');
                try {
                    const adminData = await this.apiService.getAdminData(date);
                    if (adminData && adminData.operations && adminData.operations.length > 0) {
                        // Convertir les opérations admin au format monitoring
                        const unconsolidatedOps = adminData.operations.map(op => ({
                            TempsId: op.id, // Utiliser l'ID de l'événement comme TempsId temporaire
                            OperatorCode: op.operatorId,
                            OperatorName: op.operatorName,
                            LancementCode: op.lancementCode,
                            LancementName: op.article,
                            StartTime: op.startTime,
                            EndTime: op.endTime,
                            TotalDuration: op.duration ? parseInt(op.duration.replace(/[^0-9]/g, '')) : null,
                            PauseDuration: op.pauseDuration ? parseInt(op.pauseDuration.replace(/[^0-9]/g, '')) : 0,
                            ProductiveDuration: null,
                            EventsCount: op.events || 0,
                            Phase: op.phase || 'PRODUCTION',
                            CodeRubrique: op.operatorId,
                            StatutTraitement: null, // Non consolidé = non traité
                            DateCreation: new Date().toISOString().split('T')[0],
                            CalculatedAt: null,
                            CalculationMethod: null,
                            _isUnconsolidated: true // Marqueur pour indiquer que c'est une opération non consolidée
                        }));
                        
                        // Appliquer les filtres sur les opérations non consolidées
                        let filteredUnconsolidated = unconsolidatedOps;
                        if (operatorCode) {
                            filteredUnconsolidated = filteredUnconsolidated.filter(op => op.OperatorCode === operatorCode);
                        }
                        if (lancementCode) {
                            filteredUnconsolidated = filteredUnconsolidated.filter(op => 
                                op.LancementCode.toLowerCase().includes(lancementCode.toLowerCase())
                            );
                        }
                        
                        consolidatedOps = filteredUnconsolidated;
                        console.log(`📊 ${filteredUnconsolidated.length} opérations non consolidées chargées depuis ABHISTORIQUE_OPERATEURS`);
                    }
                } catch (error) {
                    console.error('❌ Erreur lors du chargement des opérations non consolidées:', error);
                }
            }
            
            this.operations = consolidatedOps;
            console.log(`📊 Total opérations chargées: ${this.operations.length}`);
        } catch (error) {
            console.error('❌ Erreur loadMonitoringRecords:', error);
            this.operations = [];
        }
    }

    updateStats() {
        // Vérifier que les éléments existent avant de les mettre à jour
        if (this.totalOperators) {
            this.totalOperators.textContent = this.stats.totalOperators || 0;
        }
        if (this.activeLancements) {
            this.activeLancements.textContent = this.stats.activeLancements || 0;
        }
        if (this.pausedLancements) {
            this.pausedLancements.textContent = this.stats.pausedLancements || 0;
        }
        if (this.completedLancements) {
            this.completedLancements.textContent = this.stats.completedLancements || 0;
        }
        
        // Log pour debug
        console.log('📊 Statistiques mises à jour:', {
            totalOperators: this.stats.totalOperators || 0,
            activeLancements: this.stats.activeLancements || 0,
            pausedLancements: this.stats.pausedLancements || 0,
            completedLancements: this.stats.completedLancements || 0
        });
    }

    showNoDataMessage() {
        if (!this.operationsTableBody) return;
        
        this.operationsTableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: #dc3545;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                    <br>
                    <strong>Erreur de chargement des données</strong>
                    <br>
                    <small>Vérifiez la connexion au serveur et réessayez</small>
                    <br>
                    <button onclick="window.adminPage.loadData()" class="btn btn-sm btn-outline-primary mt-2">
                        <i class="fas fa-refresh"></i> Réessayer
                    </button>
                </td>
            </tr>
        `;
    }

    showRateLimitWarning() {
        console.warn('⚠️ Rate limit atteint - affichage du message d\'avertissement');
        
        // Afficher un message d'erreur dans l'interface
        const errorDiv = document.createElement('div');
        errorDiv.className = 'rate-limit-warning';
        errorDiv.innerHTML = `
            <div style="
                background: linear-gradient(135deg, #ff6b6b, #ee5a52);
                color: white;
                padding: 16px 20px;
                border-radius: 12px;
                margin: 20px;
                text-align: center;
                box-shadow: 0 4px 12px rgba(255, 107, 107, 0.3);
                animation: slideIn 0.3s ease-out;
            ">
                <i class="fas fa-exclamation-triangle" style="font-size: 24px; margin-bottom: 8px;"></i>
                <h3 style="margin: 0 0 8px 0; font-size: 18px;">Trop de requêtes</h3>
                <p style="margin: 0; opacity: 0.9;">
                    Le serveur est temporairement surchargé. Veuillez patienter quelques secondes avant de recharger.
                </p>
                <button onclick="this.parentElement.parentElement.remove(); window.adminPage.loadData();" 
                        style="
                            background: rgba(255,255,255,0.2);
                            border: 1px solid rgba(255,255,255,0.3);
                            color: white;
                            padding: 8px 16px;
                            border-radius: 6px;
                            margin-top: 12px;
                            cursor: pointer;
                            transition: all 0.2s ease;
                        "
                        onmouseover="this.style.background='rgba(255,255,255,0.3)'"
                        onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                    <i class="fas fa-refresh"></i> Réessayer
                </button>
            </div>
        `;
        
        // Insérer le message au début du contenu principal
        const mainContent = document.querySelector('.admin-content') || document.querySelector('main');
        if (mainContent) {
            mainContent.insertBefore(errorDiv, mainContent.firstChild);
        }
        
        // Auto-supprimer après 10 secondes
        setTimeout(() => {
            if (errorDiv.parentElement) {
                errorDiv.remove();
            }
        }, 10000);
    }

    updateOperatorSelect(operators) {
        console.log('🔄 Mise à jour du menu déroulant des opérateurs:', operators.length);
        if (!this.operatorSelect) {
            console.error('ERREUR: operatorSelect non trouvé !');
            return;
        }
        // Vider le select et ajouter l'option par défaut
        this.operatorSelect.innerHTML = '<option value="">Tous les opérateurs connectés</option>';
        // Ajouter chaque opérateur
        operators.forEach(operator => {
            const option = document.createElement('option');
            option.value = operator.code;
            option.textContent = `${operator.name} (${operator.code})`;
            this.operatorSelect.appendChild(option);
        });
        console.log('✅ Menu déroulant mis à jour avec', operators.length, 'opérateurs');
    }

    updateOperatorSelect(operators) {
        console.log('🔄 Mise à jour du menu déroulant des opérateurs:', operators.length);
        
        // Vider le select et ajouter l'option par défaut
        this.operatorSelect.innerHTML = '<option value="">Tous les opérateurs connectés</option>';
        
        // Ajouter chaque opérateur avec validation
        operators.forEach(operator => {
            const option = document.createElement('option');
            option.value = operator.code;
            
            // Indicateur visuel pour les opérateurs mal associés et actifs
            let statusIcon = '';
            if (operator.isProperlyLinked === false) {
                statusIcon = ' ⚠️';
            } else if (operator.isProperlyLinked === true) {
                statusIcon = ' ✅';
            }
            
            // Indicateur d'activité
            if (operator.isActive) {
                statusIcon = ' 🟢' + statusIcon;
                option.style.fontWeight = 'bold';
                option.style.color = '#28a745';
            }
            
            option.textContent = `${operator.name} (${operator.code})${statusIcon}`;
            option.title = `Code: ${operator.code} | Ressource: ${operator.resourceCode || 'N/A'} | Statut: ${operator.currentStatus || 'N/A'}`;
            
            this.operatorSelect.appendChild(option);
        });
        
        console.log('✅ Menu déroulant mis à jour avec', operators.length, 'opérateurs');
    }

    // Nouvelle méthode pour mettre à jour le statut des opérateurs
    async updateOperatorsStatus() {
        // Éviter les requêtes si on vient de recevoir une erreur 429 récemment
        const timeSinceLastUpdate = Date.now() - this.lastOperatorsUpdate;
        if (timeSinceLastUpdate < 10000) {
            console.log(`⏸️ Mise à jour opérateurs ignorée (données récentes)`);
            return;
        }
        
        try {
            const response = await this.apiService.getConnectedOperators();
            if (response.success && response.operators) {
                this.updateOperatorSelect(response.operators);
                this.lastOperatorsUpdate = Date.now(); // Mettre à jour le timestamp
                
                // Mettre à jour l'affichage des opérateurs actifs
                this.updateActiveOperatorsDisplay(response.operators);
            }
        } catch (error) {
            console.error('Erreur lors de la mise à jour du statut des opérateurs:', error);
            // En cas d'erreur 429, attendre plus longtemps avant la prochaine tentative
            if (error.message && error.message.includes('Trop de requêtes')) {
                this.lastOperatorsUpdate = Date.now() - 5000; // Forcer une attente de 15 secondes minimum
                console.log('⏸️ Rate limit détecté, attente prolongée avant la prochaine mise à jour');
            }
        }
    }

    // Afficher les opérateurs actifs
    updateActiveOperatorsDisplay(operators) {
        const activeOperators = operators.filter(op => op.isActive);
        
        // Mettre à jour un indicateur visuel des opérateurs actifs
        const activeIndicator = document.getElementById('activeOperatorsIndicator');
        if (activeIndicator) {
            activeIndicator.innerHTML = `
                <span class="badge badge-success">
                    ${activeOperators.length} opérateur(s) en opération
                </span>
            `;
        }
        
        // Log pour debug
        if (activeOperators.length > 0) {
            console.log('🟢 Opérateurs actifs:', activeOperators.map(op => op.code).join(', '));
        }
    }

    async handleOperatorChange() {
        if (this.isLoading) {
            console.log('⚠️ Chargement en cours, ignorer le changement d\'opérateur');
            return;
        }
        
        const selectedOperator = this.operatorSelect.value;
        console.log('🔄 Changement d\'opérateur sélectionné:', selectedOperator);

        // En mode Monitoring, le filtre opérateur est appliqué via loadMonitoringRecords()
        this.selectedTempsIds.clear();
        const selectAll = document.getElementById('selectAllRows');
        if (selectAll) selectAll.checked = false;
        this.loadData();
    }

    async handleAddOperation() {
        try {
            // Demander les informations pour la nouvelle ligne
            const operatorCode = prompt('Code opérateur :');
            if (!operatorCode) return;
            
            const lancementCode = prompt('Code lancement :');
            if (!lancementCode) return;
            
            const phase = prompt('Phase (optionnel) :') || '';
            
            // Créer une nouvelle opération
            const newOperation = {
                operatorId: operatorCode,
                lancementCode: lancementCode,
                phase: phase,
                startTime: new Date().toISOString(),
                status: 'DEBUT'
            };
            
            console.log('Ajout d\'une nouvelle opération:', newOperation);
            
            // Appeler l'API pour ajouter l'opération
            const result = await this.apiService.post('/admin/operations', newOperation);
            
            if (result.success) {
                if (result.warning) {
                    this.notificationManager.warning(result.warning);
                    console.warn('⚠️ Avertissement:', result.warning);
                } else {
                    this.notificationManager.success(result.message || 'Opération ajoutée avec succès');
                }
                console.log('Opération ajoutée:', result);
                
                // Attendre un peu pour que le backend ait fini de traiter
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Recharger les données pour afficher la nouvelle ligne
                await this.loadData();
            } else {
                const errorMessage = result.error || 'Erreur inconnue lors de l\'ajout';
                this.notificationManager.error(`Erreur lors de l'ajout : ${errorMessage}`);
                console.error('Erreur d\'ajout:', result);
                
                // Si le lancement n'existe pas, suggérer de le créer
                if (errorMessage.includes('n\'existe pas dans la base de données')) {
                    const createLancement = confirm(
                        `${errorMessage}\n\nVoulez-vous créer le lancement dans LCTE maintenant ?`
                    );
                    if (createLancement) {
                        // TODO: Ouvrir un formulaire pour créer le lancement
                        console.log('Création du lancement demandée');
                    }
                }
            }
            
        } catch (error) {
            console.error('Erreur lors de l\'ajout d\'opération:', error);
            this.notificationManager.error('Erreur de connexion lors de l\'ajout');
        }
    }

    updateOperationsTable() {
        console.log('🔄 DEBUT updateOperationsTable()');
        console.log('📊 OPERATIONS TOTALES:', this.operations.length);
        console.log('📋 TABLEAU BODY:', this.operationsTableBody);
        
        if (!this.operationsTableBody) {
            console.error('❌ ERREUR: operationsTableBody est null!');
            return;
        }
        
        // Appliquer les filtres
        let filteredOperations = [...this.operations];
        
        // Filtre de statut (Monitoring = StatutTraitement)
        const statusFilter = document.getElementById('statusFilter');
        if (statusFilter && statusFilter.value) {
            const selected = statusFilter.value.toUpperCase().trim();
            filteredOperations = filteredOperations.filter(op => {
                const st = (op.StatutTraitement === null || op.StatutTraitement === undefined)
                    ? 'NULL'
                    : String(op.StatutTraitement).toUpperCase().trim();
                return st === selected;
            });
        }
        
        // Filtre de recherche (code lancement)
        const searchFilter = document.getElementById('searchFilter');
        if (searchFilter && searchFilter.value.trim()) {
            const searchTerm = searchFilter.value.trim().toLowerCase();
            console.log('🔍 Filtrage par recherche:', searchTerm);
            filteredOperations = filteredOperations.filter(op => {
                const lancementCode = (op.LancementCode || op.lancementCode || '').toLowerCase();
                return lancementCode.includes(searchTerm);
            });
            console.log(`📊 Après filtrage recherche: ${filteredOperations.length} opérations`);
        }
        
        this.operationsTableBody.innerHTML = '';
        console.log('🧹 TABLEAU VIDE');
        
        // Déterminer le message à afficher si aucune opération
        let emptyMessage = '';
        let emptySubMessage = '';
        
        if (filteredOperations.length === 0) {
            console.log('⚠️ AUCUNE OPERATION APRES FILTRAGE - AFFICHAGE MESSAGE');
            console.log('🔍 Filtres actifs:', {
                statusFilter: statusFilter?.value || 'aucun',
                searchFilter: searchFilter?.value || 'aucun',
                totalOperations: this.operations.length
            });
            
            // Message personnalisé selon les filtres actifs
            if (statusFilter && statusFilter.value) {
                const statusLabels = {
                    'NULL': 'non traités',
                    'O': 'validés',
                    'A': 'en attente',
                    'T': 'transmis'
                };
                const statusLabel = statusLabels[statusFilter.value] || statusFilter.value.toLowerCase();
                emptyMessage = 'Aucun enregistrement trouvé';
                emptySubMessage = `Il n'y a pas d'enregistrements ${statusLabel} pour la période sélectionnée`;
            } else if (searchFilter && searchFilter.value.trim()) {
                emptyMessage = 'Aucun lancement trouvé';
                emptySubMessage = `Aucun lancement ne correspond à "${searchFilter.value.trim()}"`;
            } else if (this.operations.length === 0) {
                emptyMessage = 'Aucun enregistrement trouvé';
                emptySubMessage = 'Il n\'y a pas d\'enregistrements pour la date sélectionnée';
            } else {
                emptyMessage = 'Aucun enregistrement trouvé';
                emptySubMessage = 'Aucun enregistrement ne correspond aux filtres sélectionnés';
            }
            
            const row = document.createElement('tr');
            row.className = 'empty-state-row';
            row.innerHTML = `
                <td colspan="7" class="empty-state">
                    <div style="text-align: center; padding: 3rem 2rem;">
                        <i class="fas fa-inbox" style="font-size: 3rem; color: #ccc; margin-bottom: 1rem; display: block;"></i>
                        <p style="font-size: 1.1rem; color: #666; margin: 0.5rem 0; font-weight: 500;">
                            ${emptyMessage}
                        </p>
                        <p style="font-size: 0.9rem; color: #999; margin: 0;">
                            ${emptySubMessage}
                        </p>
                    </div>
                </td>
            `;
            this.operationsTableBody.appendChild(row);
            console.log('✅ MESSAGE AJOUTE AU TABLEAU');
            return;
        }
        
        // Utiliser les opérations filtrées pour l'affichage
        const operationsToDisplay = filteredOperations;
        
        console.log('🔄 CREATION DES LIGNES POUR', operationsToDisplay.length, 'OPERATIONS');
        console.log('📋 DONNEES COMPLETES DES OPERATIONS:', operationsToDisplay);
        
        operationsToDisplay.forEach((operation, index) => {
            // Debug pour voir les données reçues (Monitoring)
            console.log(`🔍 Enregistrement ${index + 1}:`, {
                TempsId: operation.TempsId,
                OperatorName: operation.OperatorName,
                OperatorCode: operation.OperatorCode,
                LancementCode: operation.LancementCode,
                LancementName: operation.LancementName,
                StartTime: operation.StartTime,
                EndTime: operation.EndTime,
                StatutTraitement: operation.StatutTraitement
            });
            
            const formattedStartTime = this.formatDateTime(operation.StartTime);
            const formattedEndTime = this.formatDateTime(operation.EndTime);
            
            // Validation des heures incohérentes
            let timeWarning = '';
            if (formattedStartTime && formattedEndTime && formattedStartTime !== '-' && formattedEndTime !== '-') {
                const startMinutes = this.timeToMinutes(formattedStartTime);
                const endMinutes = this.timeToMinutes(formattedEndTime);
                
                // Si l'heure de fin est avant l'heure de début (et pas de traversée de minuit)
                if (endMinutes < startMinutes && endMinutes > 0) {
                    timeWarning = ' ⚠️';
                    console.warn(`⚠️ Heures incohérentes pour ${operation.lancementCode}: ${formattedStartTime} -> ${formattedEndTime}`);
                }
            }
            
            console.log(`⏰ Heures formatées pour ${operation.LancementCode}:`, {
                startTime: `${operation.StartTime} -> ${formattedStartTime}`,
                endTime: `${operation.EndTime} -> ${formattedEndTime}`,
                warning: timeWarning ? 'Heures incohérentes détectées' : 'OK'
            });
            
            const row = document.createElement('tr');
            
            // Ajouter l'ID de l'opération pour pouvoir la retrouver
            const tempsId = operation.TempsId;
            row.setAttribute('data-operation-id', tempsId);

            const statutCode = (operation.StatutTraitement === null || operation.StatutTraitement === undefined)
                ? 'NULL'
                : String(operation.StatutTraitement).toUpperCase();
            const statutLabel = this.getMonitoringStatusText(statutCode);
            
            row.innerHTML = `
                <td>${operation.OperatorName || operation.OperatorCode || '-'}</td>
                <td>${operation.LancementCode || '-'}</td>
                <td>${operation.LancementName || '-'}</td>
                <td>${formattedStartTime}</td>
                <td>${formattedEndTime}${timeWarning}</td>
                <td>
                    <span class="status-badge status-${statutCode}">${statutLabel}</span>
                </td>
                <td class="actions-cell">
                    <button class="btn-edit" data-id="${tempsId}" data-operation-id="${tempsId}" title="Corriger" type="button">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-delete" data-id="${tempsId}" data-operation-id="${tempsId}" title="Supprimer" type="button">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            this.operationsTableBody.appendChild(row);
        });
    }

    getMonitoringStatusText(code) {
        const map = {
            'NULL': 'NON TRAITÉ',
            'O': 'VALIDÉ',
            'A': 'EN ATTENTE',
            'T': 'TRANSMIS'
        };
        return map[code] || code;
    }

    // ===== Transfert: choix au moment du transfert =====
    async handleTransfer() {
        try {
            // Récupérer les lignes VALIDÉES (StatutTraitement = 'O') du jour
            const today = new Date().toISOString().split('T')[0];
            const validated = await this.apiService.getMonitoringTemps({ date: today, statutTraitement: 'O' });
            const records = validated?.data || [];

            if (records.length === 0) {
                this.notificationManager.warning('Aucune ligne VALIDÉE à transférer');
                return;
            }

            const transferAll = confirm(`Transférer TOUTES les lignes VALIDÉES (${records.length}) ?\n\nOK = tout transférer\nAnnuler = choisir les lignes`);
            if (transferAll) {
                const triggerEdiJob = confirm('Déclencher EDI_JOB après transfert ?');
                const ids = records.map(r => r.TempsId).filter(Boolean);
                const result = await this.apiService.validateAndTransmitMonitoringBatch(ids, { triggerEdiJob });
                if (result?.success) {
                    this.notificationManager.success('Transfert terminé');
                    await this.loadData();
                } else {
                    this.notificationManager.error(result?.error || 'Erreur transfert');
                }
                return;
            }

            // Sinon: ouvrir la modale de sélection
            this.openTransferModal(records);
        } catch (error) {
            console.error('Erreur lors du transfert (monitoring):', error);
            this.notificationManager.error('Erreur de connexion lors du transfert');
        }
    }

    openTransferModal(records) {
        const modal = document.getElementById('transferSelectionModal');
        const body = document.getElementById('transferModalTableBody');
        const selectAll = document.getElementById('transferSelectAll');
        if (!modal || !body) return;

        this.transferSelectionIds.clear();
        if (selectAll) selectAll.checked = true;

        body.innerHTML = '';
        for (const r of records) {
            const id = r.TempsId;
            const key = String(id);
            this.transferSelectionIds.add(key); // pré-sélectionner tout

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align:center; padding:10px; border-bottom:1px solid #f0f0f0;">
                    <input type="checkbox" class="transfer-row" data-id="${id}" checked />
                </td>
                <td style="padding:10px; border-bottom:1px solid #f0f0f0;">${r.OperatorName || r.OperatorCode || '-'}</td>
                <td style="padding:10px; border-bottom:1px solid #f0f0f0;">${r.LancementCode || '-'}</td>
                <td style="padding:10px; border-bottom:1px solid #f0f0f0;">${r.LancementName || '-'}</td>
                <td style="padding:10px; border-bottom:1px solid #f0f0f0;">${this.formatDateTime(r.StartTime)}</td>
                <td style="padding:10px; border-bottom:1px solid #f0f0f0;">${this.formatDateTime(r.EndTime)}</td>
            `;
            body.appendChild(tr);
        }

        // Delegation checkbox
        body.onclick = (e) => {
            const cb = e.target.closest('input.transfer-row');
            if (!cb) return;
            const id = String(cb.dataset.id);
            if (cb.checked) this.transferSelectionIds.add(id);
            else this.transferSelectionIds.delete(id);
        };

        modal.style.display = 'block';
    }

    hideTransferModal() {
        const modal = document.getElementById('transferSelectionModal');
        if (modal) modal.style.display = 'none';
        this.transferSelectionIds.clear();
    }

    toggleTransferSelectAll(checked) {
        const body = document.getElementById('transferModalTableBody');
        if (!body) return;
        const cbs = body.querySelectorAll('input.transfer-row');
        cbs.forEach(cb => {
            cb.checked = checked;
            const id = String(cb.dataset.id);
            if (checked) this.transferSelectionIds.add(id);
            else this.transferSelectionIds.delete(id);
        });
    }

    async confirmTransferFromModal() {
        const ids = Array.from(this.transferSelectionIds).map(x => parseInt(x, 10)).filter(n => !Number.isNaN(n));
        if (ids.length === 0) {
            this.notificationManager.warning('Aucune ligne sélectionnée');
            return;
        }
        const triggerEdiJob = confirm('Déclencher EDI_JOB après transfert ?');
        const result = await this.apiService.validateAndTransmitMonitoringBatch(ids, { triggerEdiJob });
        if (result?.success) {
            this.notificationManager.success('Transfert terminé');
            this.hideTransferModal();
            await this.loadData();
        } else {
            this.notificationManager.error(result?.error || 'Erreur transfert');
        }
    }

    async deleteMonitoringRecord(id) {
        if (!confirm('Supprimer cet enregistrement de temps ?')) return;
        try {
            const result = await this.apiService.deleteMonitoringTemps(id);
            if (result && result.success) {
                this.notificationManager.success('Enregistrement supprimé');
                this.selectedTempsIds.delete(String(id));
                await this.loadData();
            } else {
                this.notificationManager.error(result?.error || 'Erreur suppression');
            }
        } catch (error) {
            console.error('❌ Erreur suppression monitoring:', error);
            this.notificationManager.error('Erreur suppression');
        }
    }

    async editMonitoringRecord(id) {
        // Trouver l'enregistrement actuel pour pré-remplir les prompts
        const record = this.operations.find(op => op.TempsId == id);
        const currentPhase = record?.Phase || '';
        const currentCodeRubrique = record?.CodeRubrique || '';
        const currentStartTime = record?.StartTime ? this.formatDateTime(record.StartTime) : '';
        const currentEndTime = record?.EndTime ? this.formatDateTime(record.EndTime) : '';

        // Correction simple via prompts (Phase/CodeRubrique/Start/End)
        const phase = prompt(`Phase (actuel: ${currentPhase || 'vide'}) :`, currentPhase);
        const codeRubrique = prompt(`CodeRubrique (actuel: ${currentCodeRubrique || 'vide'}) :`, currentCodeRubrique);
        const startTime = prompt(`Heure début (actuel: ${currentStartTime || 'vide'}) (YYYY-MM-DDTHH:mm:ss ou HH:mm) :`, currentStartTime);
        const endTime = prompt(`Heure fin (actuel: ${currentEndTime || 'vide'}) (YYYY-MM-DDTHH:mm:ss ou HH:mm) :`, currentEndTime);

        const corrections = {};
        if (phase !== null && phase !== '' && phase !== currentPhase) corrections.Phase = phase;
        if (codeRubrique !== null && codeRubrique !== '' && codeRubrique !== currentCodeRubrique) corrections.CodeRubrique = codeRubrique;
        if (startTime !== null && startTime !== '' && startTime !== currentStartTime) corrections.StartTime = startTime;
        if (endTime !== null && endTime !== '' && endTime !== currentEndTime) corrections.EndTime = endTime;

        if (Object.keys(corrections).length === 0) {
            this.notificationManager.info('Aucune modification effectuée');
            return;
        }

        try {
            const result = await this.apiService.correctMonitoringTemps(id, corrections);
            if (result && result.success) {
                this.notificationManager.success('Enregistrement corrigé');
                
                // Mettre à jour l'enregistrement en mémoire immédiatement
                if (record) {
                    if (corrections.Phase !== undefined) record.Phase = corrections.Phase;
                    if (corrections.CodeRubrique !== undefined) record.CodeRubrique = corrections.CodeRubrique;
                    if (corrections.StartTime !== undefined) record.StartTime = corrections.StartTime;
                    if (corrections.EndTime !== undefined) record.EndTime = corrections.EndTime;
                    
                    // Mettre à jour la ligne dans le tableau sans tout recharger
                    this.updateMonitoringRowInTable(id, record);
                }
                
                // Recharger les données après un court délai pour s'assurer que tout est synchronisé
                setTimeout(async () => {
                    await this.loadMonitoringRecords(new Date().toISOString().split('T')[0]);
                    this.updateOperationsTable();
                }, 500);
            } else {
                this.notificationManager.error(result?.error || 'Erreur correction');
            }
        } catch (error) {
            console.error('❌ Erreur lors de la correction:', error);
            this.notificationManager.error('Erreur lors de la correction');
        }
    }

    updateMonitoringRowInTable(tempsId, record) {
        const row = document.querySelector(`tr[data-operation-id="${tempsId}"]`);
        if (!row) {
            console.warn(`⚠️ Ligne non trouvée pour TempsId ${tempsId}, rechargement complet`);
            this.updateOperationsTable();
            return;
        }

        const cells = row.querySelectorAll('td');
        if (cells.length >= 6) {
            // Mettre à jour les heures (cellules 3 et 4)
            const formattedStartTime = this.formatDateTime(record.StartTime);
            const formattedEndTime = this.formatDateTime(record.EndTime);
            
            cells[3].textContent = formattedStartTime;
            cells[4].textContent = formattedEndTime;
            
            console.log(`✅ Ligne ${tempsId} mise à jour dans le tableau:`, {
                StartTime: formattedStartTime,
                EndTime: formattedEndTime
            });
        }
    }

    formatDateTime(dateString) {
        // Si c'est null ou undefined, retourner un tiret
        if (!dateString) return '-';
        
        console.log(`🔧 formatDateTime input: "${dateString}" (type: ${typeof dateString})`);
        
        // Si c'est déjà au format HH:mm, le retourner directement
        if (typeof dateString === 'string') {
            const timeMatch = dateString.match(/^(\d{1,2}):(\d{2})$/);
            if (timeMatch) {
                const hours = timeMatch[1].padStart(2, '0');
                const minutes = timeMatch[2];
                const result = `${hours}:${minutes}`;
                console.log(`✅ formatDateTime: ${dateString} → ${result}`);
                return result;
            }
            
            // Si c'est au format HH:mm:ss, extraire HH:mm
            const timeWithSecondsMatch = dateString.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
            if (timeWithSecondsMatch) {
                const hours = timeWithSecondsMatch[1].padStart(2, '0');
                const minutes = timeWithSecondsMatch[2];
                const result = `${hours}:${minutes}`;
                console.log(`✅ formatDateTime: ${dateString} → ${result}`);
                return result;
            }
        }
        
        // Si c'est un objet Date, extraire l'heure avec fuseau horaire français
        if (dateString instanceof Date) {
            const result = dateString.toLocaleTimeString('fr-FR', {
                timeZone: 'Europe/Paris',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            console.log(`✅ formatDateTime: Date → ${result}`);
            return result;
        }
        
        // Sinon, essayer de formater comme une date complète avec fuseau horaire Paris
        try {
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                // Utiliser fuseau horaire français (Europe/Paris)
                const result = date.toLocaleTimeString('fr-FR', {
                    timeZone: 'Europe/Paris',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
                console.log(`✅ formatDateTime: Date string → ${result}`);
                return result;
            }
        } catch (error) {
            console.warn('Erreur formatage heure:', dateString, error);
        }
        
        // En dernier recours, retourner la valeur originale ou un tiret
        console.warn(`⚠️ Format non reconnu: ${dateString}`);
        return dateString || '-';
    }

    getStatusText(status) {
        const statusMap = {
            'active': 'En cours',
            'paused': 'En pause',
            'completed': 'Terminé',
            'started': 'Démarré',
            'TERMINE': 'Terminé',
            'PAUSE': 'En pause',
            'EN_COURS': 'En cours',
            'PAUSE_TERMINEE': 'Pause terminée'
        };
        return statusMap[status] || status;
    }
    
    // ===== SYSTÈME DE SAUVEGARDE AUTOMATIQUE =====
    
    startAutoSave() {
        if (this.autoSaveEnabled) {
            this.autoSaveTimer = setInterval(() => {
                this.processAutoSave();
            }, this.autoSaveInterval);
            
            console.log(`🔄 Sauvegarde automatique activée (${this.autoSaveInterval/1000}s)`);
        }
    }
    
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
            console.log('⏹️ Sauvegarde automatique désactivée');
        }
    }
    
    addPendingChange(operationId, field, value) {
        if (!this.pendingChanges.has(operationId)) {
            this.pendingChanges.set(operationId, {});
        }
        
        const operationChanges = this.pendingChanges.get(operationId);
        operationChanges[field] = value;
        
        console.log(`📝 Modification en attente pour ${operationId}:`, operationChanges);
        
        // Sauvegarde immédiate pour les modifications critiques
        if (field === 'startTime' || field === 'endTime') {
            this.saveOperationImmediately(operationId, operationChanges);
        }
    }
    
    async processAutoSave() {
        if (this.pendingChanges.size === 0) {
            return;
        }
        
        console.log(`💾 Sauvegarde automatique de ${this.pendingChanges.size} modifications...`);
        
        const savePromises = [];
        
        for (const [operationId, changes] of this.pendingChanges) {
            if (Object.keys(changes).length > 0) {
                savePromises.push(this.saveOperationChanges(operationId, changes));
            }
        }
        
        try {
            await Promise.all(savePromises);
            this.pendingChanges.clear();
            console.log('✅ Sauvegarde automatique terminée');
            
            // Notification discrète
            this.showAutoSaveNotification('Modifications sauvegardées automatiquement');
            
        } catch (error) {
            console.error('❌ Erreur sauvegarde automatique:', error);
            this.showAutoSaveNotification('Erreur lors de la sauvegarde automatique', 'error');
        }
    }
    
    async saveOperationImmediately(operationId, changes) {
        try {
            await this.saveOperationChanges(operationId, changes);
            this.pendingChanges.delete(operationId);
            console.log(`⚡ Sauvegarde immédiate réussie pour ${operationId}`);
        } catch (error) {
            console.error(`❌ Erreur sauvegarde immédiate ${operationId}:`, error);
        }
    }
    
    async saveOperationChanges(operationId, changes) {
        const operation = this.operations.find(op => op.id == operationId);
        if (!operation) {
            throw new Error(`Opération ${operationId} non trouvée`);
        }
        
        const updateData = {
            ...changes,
            id: operationId
        };
        
        const result = await this.apiService.updateOperation(updateData);
        
        if (result.success) {
            // Mettre à jour l'opération locale
            Object.assign(operation, changes);
            console.log(`✅ Opération ${operationId} mise à jour:`, changes);
        } else {
            throw new Error(result.error || 'Erreur lors de la mise à jour');
        }
        
        return result;
    }
    
    showAutoSaveNotification(message, type = 'success') {
        if (this.notificationManager) {
            this.notificationManager.show(message, type, 3000);
        } else {
            // Fallback si pas de notification manager
            console.log(`📢 ${message}`);
        }
    }
    
    // ===== VALIDATION AUTOMATIQUE DES CODES LANCEMENT =====
    
    async validateLancementCode(code) {
        if (!code || code.length < 3) {
            return { valid: false, error: 'Code trop court' };
        }
        
        try {
            const result = await this.apiService.validateLancementCode(code);
            return result;
        } catch (error) {
            console.error('❌ Erreur validation code:', error);
            return { valid: false, error: 'Erreur de validation' };
        }
    }
    
    setupLancementValidation(inputElement) {
        let validationTimeout;
        
        inputElement.addEventListener('input', (e) => {
            const code = e.target.value.trim();
            
            // Annuler la validation précédente
            if (validationTimeout) {
                clearTimeout(validationTimeout);
            }
            
            // Validation différée (éviter trop d'appels API)
            validationTimeout = setTimeout(async () => {
                if (code.length >= 3) {
                    await this.performLancementValidation(inputElement, code);
                } else {
                    this.clearValidationFeedback(inputElement);
                }
            }, 500);
        });
    }
    
    async performLancementValidation(inputElement, code) {
        // Ajouter indicateur de chargement
        inputElement.classList.add('validating');
        
        try {
            const result = await this.validateLancementCode(code);
            
            if (result.valid) {
                this.showValidationSuccess(inputElement, result.data);
            } else {
                this.showValidationError(inputElement, result.error);
            }
            
        } catch (error) {
            this.showValidationError(inputElement, 'Erreur de validation');
        } finally {
            inputElement.classList.remove('validating');
        }
    }
    
    showValidationSuccess(inputElement, data) {
        inputElement.classList.remove('validation-error');
        inputElement.classList.add('validation-success');
        
        // Ajouter un tooltip avec les infos
        const tooltip = document.createElement('div');
        tooltip.className = 'validation-tooltip success';
        tooltip.innerHTML = `
            <strong>✅ Code valide</strong><br>
            ${data.designation}<br>
            <small>Statut: ${data.statut}</small>
        `;
        
        inputElement.parentNode.appendChild(tooltip);
        
        // Supprimer le tooltip après 3 secondes
        setTimeout(() => {
            if (tooltip.parentNode) {
                tooltip.parentNode.removeChild(tooltip);
            }
        }, 3000);
    }
    
    showValidationError(inputElement, error) {
        inputElement.classList.remove('validation-success');
        inputElement.classList.add('validation-error');
        
        // Ajouter un tooltip d'erreur
        const tooltip = document.createElement('div');
        tooltip.className = 'validation-tooltip error';
        tooltip.innerHTML = `<strong>❌ ${error}</strong>`;
        
        inputElement.parentNode.appendChild(tooltip);
        
        // Supprimer le tooltip après 5 secondes
        setTimeout(() => {
            if (tooltip.parentNode) {
                tooltip.parentNode.removeChild(tooltip);
            }
        }, 5000);
    }
    
    clearValidationFeedback(inputElement) {
        inputElement.classList.remove('validation-success', 'validation-error', 'validating');
        
        // Supprimer les tooltips existants
        const existingTooltips = inputElement.parentNode.querySelectorAll('.validation-tooltip');
        existingTooltips.forEach(tooltip => tooltip.remove());
    }

    cleanTimeValue(timeString) {
        if (!timeString) return '';
        
        // Si c'est déjà au format HH:mm, le retourner directement
        if (typeof timeString === 'string' && /^\d{2}:\d{2}$/.test(timeString)) {
            return timeString;
        }
        
        // Si c'est au format HH:mm:ss, enlever les secondes
        if (typeof timeString === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(timeString)) {
            return timeString.substring(0, 5);
        }
        
        // Si c'est au format H:mm ou H:m, ajouter le zéro manquant
        if (typeof timeString === 'string' && /^\d{1,2}:\d{1,2}$/.test(timeString)) {
            const parts = timeString.split(':');
            const hours = parts[0].padStart(2, '0');
            const minutes = parts[1].padStart(2, '0');
            return `${hours}:${minutes}`;
        }
        
        console.warn(`⚠️ Format d'heure non reconnu pour nettoyage: "${timeString}"`);
        return '';
    }

    formatTimeForInput(timeString) {
        if (!timeString) return '';
        
        console.log(`🔧 formatTimeForInput: "${timeString}"`);
        
        // Si c'est déjà au format HH:mm, le retourner directement
        if (typeof timeString === 'string' && /^\d{2}:\d{2}$/.test(timeString)) {
            console.log(`✅ Format HH:mm direct: ${timeString}`);
            return timeString;
        }
        
        // Si c'est au format HH:mm:ss, enlever les secondes
        if (typeof timeString === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(timeString)) {
            const result = timeString.substring(0, 5);
            console.log(`✅ Format HH:mm:ss → HH:mm: ${timeString} → ${result}`);
            return result;
        }
        
        // Si c'est une date complète, extraire seulement l'heure
        if (typeof timeString === 'string' && timeString.includes('T')) {
            try {
                const date = new Date(timeString);
                if (!isNaN(date.getTime())) {
                    // Utiliser toLocaleTimeString avec fuseau horaire français
                    const formattedTime = date.toLocaleTimeString('fr-FR', {
                        timeZone: 'Europe/Paris',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    });
                    console.log(`✅ Date complète → HH:mm: ${timeString} → ${formattedTime}`);
                    return formattedTime;
                }
            } catch (error) {
                console.warn('Erreur parsing date:', timeString, error);
            }
        }
        
        // Si c'est un objet Date, extraire l'heure avec fuseau horaire français
        if (timeString instanceof Date) {
            const formattedTime = timeString.toLocaleTimeString('fr-FR', {
                timeZone: 'Europe/Paris',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            console.log(`✅ Date object → HH:mm: ${timeString} → ${formattedTime}`);
            return formattedTime;
        }
        
        console.warn(`⚠️ Format d'heure non reconnu: "${timeString}" (type: ${typeof timeString})`);
        return '';
    }

    formatDateTimeForInput(dateString) {
        if (!dateString) return '';
        
        // Si c'est déjà au format HH:mm, créer une date d'aujourd'hui avec cette heure
        if (typeof dateString === 'string' && /^\d{2}:\d{2}$/.test(dateString)) {
            const today = new Date();
            const [hours, minutes] = dateString.split(':');
            today.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            return today.toISOString().slice(0, 16); // Format YYYY-MM-DDTHH:mm
        }
        
        // Sinon, essayer de traiter comme une date complète
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            console.warn('Date invalide reçue:', dateString);
            return '';
        }
        
        return date.toISOString().slice(0, 16); // Format YYYY-MM-DDTHH:mm
    }

    editOperation(id) {
        console.log('🔧 Édition de l\'opération:', id, 'Type:', typeof id);
        
        // Convertir l'ID en nombre si nécessaire pour la comparaison
        const numericId = typeof id === 'string' ? parseInt(id, 10) : id;
        
        // Trouver la ligne correspondante - essayer plusieurs méthodes
        let row = document.querySelector(`tr[data-operation-id="${id}"]`);
        if (!row) {
            row = document.querySelector(`tr[data-operation-id="${numericId}"]`);
        }
        if (!row) {
            // Essayer de trouver via le bouton
            const button = document.querySelector(`button.btn-edit[data-id="${id}"]`) || 
                          document.querySelector(`button.btn-edit[data-id="${numericId}"]`);
            if (button) {
                row = button.closest('tr');
            }
        }
        
        if (!row) {
            console.error('❌ Ligne non trouvée pour l\'ID:', id);
            console.log('🔍 Opérations disponibles:', this.operations.map(op => ({ id: op.id, type: typeof op.id })));
            console.log('🔍 Lignes dans le tableau:', Array.from(document.querySelectorAll('tr[data-operation-id]')).map(tr => ({
                id: tr.getAttribute('data-operation-id'),
                buttons: Array.from(tr.querySelectorAll('button.btn-edit')).map(btn => btn.getAttribute('data-id'))
            })));
            this.notificationManager.warning(`Ligne non trouvée pour l'opération ${id}. Rechargement du tableau...`);
            this.loadData();
            return;
        }
        
        // Trouver l'opération dans les données - essayer avec l'ID original et numérique
        console.log('🔍 Recherche de l\'opération avec ID:', id, 'ou', numericId);
        console.log('🔍 Opérations dans this.operations:', this.operations.length);
        console.log('🔍 IDs disponibles:', this.operations.map(op => ({ 
            id: op.id, 
            type: typeof op.id,
            lancementCode: op.lancementCode 
        })));
        
        let operation = this.operations.find(op => {
            const match = op.id == id || op.id == numericId || String(op.id) === String(id) || String(op.id) === String(numericId);
            if (match) {
                console.log('✅ Opération trouvée avec correspondance:', {
                    opId: op.id,
                    opIdType: typeof op.id,
                    searchId: id,
                    searchIdType: typeof id,
                    numericId: numericId
                });
            }
            return match;
        });
        
        if (!operation) {
            console.error('❌ Opération non trouvée pour l\'ID:', id);
            console.log('🔍 Toutes les opérations:', this.operations);
            console.log('🔍 Comparaisons testées:', {
                'op.id == id': this.operations.map(op => ({ id: op.id, match: op.id == id })),
                'op.id == numericId': this.operations.map(op => ({ id: op.id, match: op.id == numericId })),
                'String(op.id) === String(id)': this.operations.map(op => ({ id: op.id, match: String(op.id) === String(id) })),
                'String(op.id) === String(numericId)': this.operations.map(op => ({ id: op.id, match: String(op.id) === String(numericId) }))
            });
            this.notificationManager.warning(`Opération ${id} non trouvée dans les données. Rechargement...`);
            this.loadData();
            return;
        }
        
        console.log('✅ Opération trouvée:', operation);
        console.log('✅ Ligne trouvée:', row);
        console.log('🔍 Structure de la ligne:', {
            cellCount: row.querySelectorAll('td').length,
            innerHTML: row.innerHTML.substring(0, 200)
        });
        
        // Sauvegarder et nettoyer les valeurs originales
        const originalStartTime = this.cleanTimeValue(operation.startTime || '');
        const originalEndTime = this.cleanTimeValue(operation.endTime || '');
        
        console.log(`🔧 Valeurs originales sauvegardées:`, {
            startTime: `${operation.startTime} → ${originalStartTime}`,
            endTime: `${operation.endTime} → ${originalEndTime}`
        });
        
        // Remplacer les cellules par des inputs
        const cells = row.querySelectorAll('td');
        
        if (cells.length < 7) {
            console.error(`❌ Nombre de cellules insuffisant: ${cells.length} (attendu: 7)`);
            console.log('🔍 Cellules trouvées:', Array.from(cells).map((cell, idx) => ({
                index: idx,
                content: cell.textContent.trim().substring(0, 50)
            })));
            this.notificationManager.error(`Erreur: La ligne a ${cells.length} cellules au lieu de 7. Rechargement...`);
            this.loadData();
            return;
        }
        
        console.log(`✅ ${cells.length} cellules trouvées, structure correcte`);
        
        // Heure Début (index 3)
        const startTimeCell = cells[3];
        startTimeCell.innerHTML = `
            <div class="time-input-container">
                <input type="time" 
                       value="${originalStartTime}" 
                       data-id="${id}" 
                       data-field="startTime"
                       data-original="${originalStartTime}"
                       class="time-input"
                       step="60">
            </div>
        `;
        
        // Heure Fin (index 4)
        const endTimeCell = cells[4];
        endTimeCell.innerHTML = `
            <div class="time-input-container">
                <input type="time" 
                       value="${originalEndTime}" 
                       data-id="${id}" 
                       data-field="endTime"
                       data-original="${originalEndTime}"
                       class="time-input"
                       step="60">
            </div>
        `;
        
        // Statut (index 5)
        const statusCell = cells[5];
        const currentStatus = operation.statusCode || 'EN_COURS';
        const originalStatus = currentStatus;
        statusCell.innerHTML = `
            <div class="status-input-container">
                <select data-id="${id}" 
                        data-field="status"
                        data-original="${originalStatus}"
                        class="status-select">
                    <option value="EN_COURS" ${currentStatus === 'EN_COURS' ? 'selected' : ''}>En cours</option>
                    <option value="EN_PAUSE" ${currentStatus === 'EN_PAUSE' ? 'selected' : ''}>En pause</option>
                    <option value="TERMINE" ${currentStatus === 'TERMINE' ? 'selected' : ''}>Terminé</option>
                    <option value="PAUSE_TERMINEE" ${currentStatus === 'PAUSE_TERMINEE' ? 'selected' : ''}>Pause terminée</option>
                    <option value="FORCE_STOP" ${currentStatus === 'FORCE_STOP' ? 'selected' : ''}>Arrêt forcé</option>
                </select>
            </div>
        `;
        
        // Actions (index 6)
        const actionsCell = cells[6];
        actionsCell.innerHTML = `
            <button class="btn-save" data-id="${id}" title="Sauvegarder">
                <i class="fas fa-save"></i>
            </button>
            <button class="btn-cancel" data-id="${id}" title="Annuler">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        // Ajouter les event listeners pour les nouveaux boutons
        const saveBtn = actionsCell.querySelector('.btn-save');
        const cancelBtn = actionsCell.querySelector('.btn-cancel');
        
        saveBtn.addEventListener('click', () => this.saveOperation(id));
        cancelBtn.addEventListener('click', () => this.cancelEdit(id));
        
        // Ajouter des event listeners pour détecter les modifications automatiques
        const timeInputs = row.querySelectorAll('.time-input');
        timeInputs.forEach(input => {
            const originalValue = input.getAttribute('data-original');
            
            // Détecter les changements automatiques
            input.addEventListener('change', () => {
                const currentValue = input.value;
                console.log(`🔍 Changement détecté sur ${input.dataset.field}:`, {
                    original: originalValue,
                    current: currentValue,
                    changed: currentValue !== originalValue
                });
                
                // Validation en temps réel des heures
                this.validateTimeInputs(row, id);
            });
            
            // Détecter les modifications par le navigateur
            input.addEventListener('input', () => {
                const currentValue = input.value;
                if (currentValue !== originalValue) {
                    console.log(`⚠️ Modification automatique détectée sur ${input.dataset.field}: ${originalValue} → ${currentValue}`);
                }
            });
        });
        
        // Event listener pour le select de statut
        const statusSelect = row.querySelector('.status-select');
        if (statusSelect) {
            const originalStatus = statusSelect.getAttribute('data-original');
            
            statusSelect.addEventListener('change', () => {
                const currentStatus = statusSelect.value;
                console.log(`🔍 Changement de statut détecté:`, {
                    original: originalStatus,
                    current: currentStatus,
                    changed: currentStatus !== originalStatus
                });
            });
        }
    }

    cancelEdit(id) {
        console.log('❌ Annulation de l\'édition:', id);
        // Recharger les données pour restaurer l'état original
        this.loadData();
    }

    validateTimeInputs(row, operationId) {
        const startTimeInput = row.querySelector('input[data-field="startTime"]');
        const endTimeInput = row.querySelector('input[data-field="endTime"]');
        
        if (!startTimeInput || !endTimeInput) return;

        const startTime = startTimeInput.value;
        const endTime = endTimeInput.value;

        if (startTime && endTime) {
            const startTimeObj = new Date(`2000-01-01 ${startTime}`);
            const endTimeObj = new Date(`2000-01-01 ${endTime}`);
            
            if (endTimeObj <= startTimeObj) {
                // Marquer les inputs comme invalides
                startTimeInput.style.borderColor = '#dc3545';
                startTimeInput.style.backgroundColor = '#f8d7da';
                endTimeInput.style.borderColor = '#dc3545';
                endTimeInput.style.backgroundColor = '#f8d7da';
                
                // Ajouter un message d'erreur
                this.showTimeValidationError(row, 'L\'heure de fin doit être postérieure à l\'heure de début');
            } else {
                // Restaurer l'apparence normale
                startTimeInput.style.borderColor = '';
                startTimeInput.style.backgroundColor = '';
                endTimeInput.style.borderColor = '';
                endTimeInput.style.backgroundColor = '';
                
                // Supprimer le message d'erreur
                this.hideTimeValidationError(row);
            }
        }
    }

    showTimeValidationError(row, message) {
        // Supprimer l'ancien message s'il existe
        this.hideTimeValidationError(row);
        
        // Créer le message d'erreur
        const errorDiv = document.createElement('div');
        errorDiv.className = 'time-validation-error';
        errorDiv.style.cssText = `
            color: #dc3545;
            font-size: 12px;
            margin-top: 5px;
            padding: 5px;
            background-color: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 4px;
        `;
        errorDiv.textContent = message;
        
        // Insérer après la ligne
        row.parentNode.insertBefore(errorDiv, row.nextSibling);
    }

    hideTimeValidationError(row) {
        const errorDiv = row.parentNode.querySelector('.time-validation-error');
        if (errorDiv) {
            errorDiv.remove();
        }
    }

    async saveOperation(id) {
        try {
            // Rechercher dans la ligne ciblée pour éviter les sélections globales nulles
            const row = document.querySelector(`tr[data-operation-id="${id}"]`);
            
            if (!row) {
                console.warn('⚠️ Ligne non trouvée pour l\'opération', id);
                this.notificationManager.warning('Ligne non trouvée');
                this.updateOperationsTable();
                return;
            }

            // Rechercher les inputs avec plusieurs sélecteurs possibles
            const startTimeInput = row.querySelector('input[data-field="startTime"]') || 
                                 row.querySelector('input[data-id="' + id + '"][data-field="startTime"]') ||
                                 row.querySelector('.time-input[data-field="startTime"]');
            const endTimeInput = row.querySelector('input[data-field="endTime"]') || 
                               row.querySelector('input[data-id="' + id + '"][data-field="endTime"]') ||
                               row.querySelector('.time-input[data-field="endTime"]');
            const statusSelect = row.querySelector('select[data-field="status"]') ||
                               row.querySelector('.status-select[data-field="status"]');

            console.log('🔍 Recherche des inputs:', {
                id,
                rowFound: !!row,
                startTimeInputFound: !!startTimeInput,
                endTimeInputFound: !!endTimeInput,
                statusSelectFound: !!statusSelect,
                rowHTML: row.innerHTML.substring(0, 200) + '...'
            });

            if (!startTimeInput || !endTimeInput) {
                console.warn('⚠️ Impossible de trouver les champs d\'heure pour la ligne', id);
                console.log('🔍 Contenu de la ligne:', row.innerHTML);
                this.notificationManager.warning('Aucune édition active pour cette ligne - Rechargement du tableau');
                this.updateOperationsTable();
                return;
            }
            
            // Le statut est optionnel (peut ne pas être en mode édition)
            if (!statusSelect) {
                console.log('ℹ️ Aucun select de statut trouvé - mode édition partielle');
            }

            // Récupérer les valeurs originales
            const originalStartTime = startTimeInput.getAttribute('data-original');
            const originalEndTime = endTimeInput.getAttribute('data-original');
            const originalStatus = statusSelect ? statusSelect.getAttribute('data-original') : null;
            
            // Validation des heures
            const startTime = startTimeInput.value;
            const endTime = endTimeInput.value;
            
            if (startTime && endTime) {
                const startTimeObj = new Date(`2000-01-01 ${startTime}`);
                const endTimeObj = new Date(`2000-01-01 ${endTime}`);
                
                if (endTimeObj <= startTimeObj) {
                    this.notificationManager.error('❌ L\'heure de fin doit être postérieure à l\'heure de début');
                    console.warn('⚠️ Heure de fin antérieure à l\'heure de début:', { startTime, endTime });
                    return;
                }
            }

            // Vérifier si les valeurs ont vraiment changé
            const startTimeChanged = startTimeInput.value !== originalStartTime;
            const endTimeChanged = endTimeInput.value !== originalEndTime;
            const statusChanged = statusSelect ? (statusSelect.value !== originalStatus) : false;
            
            console.log(`🔧 Comparaison des valeurs pour ${id}:`, {
                startTime: {
                    original: originalStartTime,
                    current: startTimeInput.value,
                    changed: startTimeChanged
                },
                endTime: {
                    original: originalEndTime,
                    current: endTimeInput.value,
                    changed: endTimeChanged
                },
                status: {
                    original: originalStatus,
                    current: statusSelect ? statusSelect.value : 'N/A',
                    changed: statusChanged
                }
            });
            
            // Si aucune valeur n'a changé, ne pas envoyer de requête
            if (!startTimeChanged && !endTimeChanged && !statusChanged) {
                console.log(`ℹ️ Aucune modification détectée pour l'opération ${id}`);
                this.notificationManager.info('Aucune modification détectée');
                this.loadData(); // Recharger pour revenir à l'état normal
                return;
            }
            
            const updateData = {};
            
            // Ajouter seulement les champs qui ont changé avec validation
            if (startTimeChanged) {
                const startTime = this.validateAndFormatTime(startTimeInput.value);
                if (startTime) {
                    updateData.startTime = startTime;
                } else {
                    this.notificationManager.error('Format d\'heure de début invalide');
                    return;
                }
            }
            
            if (endTimeChanged) {
                const endTime = this.validateAndFormatTime(endTimeInput.value);
                if (endTime) {
                    updateData.endTime = endTime;
                } else {
                    this.notificationManager.error('Format d\'heure de fin invalide');
                    return;
                }
            }
            
            // Ajouter le statut s'il a changé
            if (statusChanged && statusSelect) {
                updateData.status = statusSelect.value;
                console.log(`🔧 Statut changé: ${originalStatus} → ${statusSelect.value}`);
            }
            
            // Validation de cohérence des heures
            if (updateData.startTime && updateData.endTime) {
                if (!this.validateTimeConsistency(updateData.startTime, updateData.endTime)) {
                    this.notificationManager.warning('Attention: L\'heure de fin est antérieure à l\'heure de début');
                }
            }

            console.log(`💾 Sauvegarde opération ${id}:`, updateData);

            // Vérifier si c'est un enregistrement de monitoring (ABTEMPS_OPERATEURS) ou historique (ABHISTORIQUE_OPERATEURS)
            const record = this.operations.find(op => op.TempsId == id || op.id == id);
            const isMonitoringRecord = record && record.TempsId !== undefined;
            
            let response;
            if (isMonitoringRecord) {
                // C'est un enregistrement de monitoring - utiliser la route de correction
                const corrections = {};
                if (updateData.startTime) corrections.StartTime = updateData.startTime;
                if (updateData.endTime) corrections.EndTime = updateData.endTime;
                if (updateData.Phase) corrections.Phase = updateData.Phase;
                if (updateData.CodeRubrique) corrections.CodeRubrique = updateData.CodeRubrique;
                
                response = await this.apiService.correctMonitoringTemps(record.TempsId, corrections);
            } else {
                // C'est un enregistrement historique - utiliser la route operations
                response = await this.apiService.updateOperation(id, updateData);
            }
            
            if (response.success) {
                this.notificationManager.success('Opération mise à jour avec succès');
                
                // Enregistrer le temps de la dernière édition pour éviter le rechargement automatique
                this.lastEditTime = Date.now();
                
                // Mettre à jour en mémoire AVANT de mettre à jour l'affichage
                if (isMonitoringRecord) {
                    // Pour monitoring, mettre à jour avec les noms de champs corrects
                    if (updateData.startTime) record.StartTime = updateData.startTime;
                    if (updateData.endTime) record.EndTime = updateData.endTime;
                    if (updateData.Phase) record.Phase = updateData.Phase;
                    if (updateData.CodeRubrique) record.CodeRubrique = updateData.CodeRubrique;
                } else {
                    this.updateOperationInMemory(id, updateData);
                }
                
                // Vérifier que la mise à jour en mémoire a bien fonctionné
                const updatedOperation = this.operations.find(op => (op.TempsId == id || op.id == id));
                console.log('🔍 Opération après mise à jour en mémoire:', updatedOperation);
                
                // Mettre à jour l'affichage
                if (isMonitoringRecord) {
                    this.updateMonitoringRowInTable(record.TempsId, record);
                } else {
                    this.updateSingleRowInTable(id);
                }
                
                // Recharger les données après un court délai pour s'assurer de la synchronisation
                setTimeout(async () => {
                    const today = new Date().toISOString().split('T')[0];
                    await this.loadMonitoringRecords(today);
                    this.updateOperationsTable();
                }, 500);
            } else {
                const errorMessage = response.error || 'Erreur lors de la mise à jour';
                this.notificationManager.error(`Erreur: ${errorMessage}`);
                console.error('Erreur de mise à jour:', response);
            }
        } catch (error) {
            console.error('Erreur sauvegarde:', error);
            
            let errorMessage = 'Erreur lors de la sauvegarde';
            if (error.message.includes('fetch')) {
                errorMessage = 'Impossible de contacter le serveur';
            } else if (error.message.includes('HTTP')) {
                errorMessage = `Erreur serveur: ${error.message}`;
            }
            
            this.notificationManager.error(errorMessage);
            
            // Restaurer les valeurs originales en cas d'erreur
            this.loadData();
        }
    }

    updateOperationInMemory(operationId, updateData) {
        console.log(`🔄 Mise à jour en mémoire de l'opération ${operationId}:`, updateData);
        
        const operation = this.operations.find(op => op.id == operationId);
        if (!operation) {
            console.error(`❌ Opération ${operationId} non trouvée en mémoire`);
            return;
        }
        
        // Mettre à jour les champs modifiés
        if (updateData.startTime !== undefined) {
            operation.startTime = updateData.startTime;
            console.log(`✅ startTime mis à jour: ${operation.startTime}`);
        }
        
        if (updateData.endTime !== undefined) {
            operation.endTime = updateData.endTime;
            console.log(`✅ endTime mis à jour: ${operation.endTime}`);
        }
        
        // Mettre à jour le statut si modifié
        if (updateData.status !== undefined) {
            operation.statusCode = updateData.status;
            // Mettre à jour aussi le label du statut
            const statusLabels = {
                'EN_COURS': 'En cours',
                'EN_PAUSE': 'En pause',
                'TERMINE': 'Terminé',
                'PAUSE_TERMINEE': 'Pause terminée',
                'FORCE_STOP': 'Arrêt forcé'
            };
            operation.status = statusLabels[updateData.status] || updateData.status;
            console.log(`✅ Statut mis à jour: ${operation.statusCode} (${operation.status})`);
        }
        
        // Mettre à jour le timestamp de dernière modification
        operation.lastUpdate = new Date().toISOString();
        
        console.log(`✅ Opération ${operationId} mise à jour en mémoire`);
    }

    updateSingleRowInTable(operationId) {
        console.log(`🔄 Mise à jour de la ligne ${operationId} dans le tableau`);
        
        const operation = this.operations.find(op => op.id == operationId);
        if (!operation) {
            console.error(`❌ Opération ${operationId} non trouvée pour mise à jour du tableau`);
            return;
        }
        
        // Trouver la ligne existante
        const existingRow = document.querySelector(`tr[data-operation-id="${operationId}"]`);
        if (!existingRow) {
            console.warn(`⚠️ Ligne non trouvée pour l'opération ${operationId}, rechargement complet`);
            this.updateOperationsTable();
            return;
        }
        
        // Mettre à jour les cellules d'heures et statut
        const cells = existingRow.querySelectorAll('td');
        if (cells.length >= 6) {
            // Cellule heure début (index 3)
            const formattedStartTime = this.formatDateTime(operation.startTime);
            cells[3].innerHTML = formattedStartTime;
            
            // Cellule heure fin (index 4)
            const formattedEndTime = this.formatDateTime(operation.endTime);
            cells[4].innerHTML = formattedEndTime;
            
            // Cellule statut (index 5)
            // Utiliser le statut de l'opération, mais ne pas utiliser 'EN_COURS' par défaut si le statut est explicitement défini
            let statusCode = operation.statusCode;
            let statusLabel = operation.status;
            
            // Si le statut n'est pas défini, utiliser 'EN_COURS' seulement si c'est vraiment nécessaire
            if (!statusCode && operation.status) {
                // Essayer de déduire le statusCode depuis le status label
                const statusMap = {
                    'En cours': 'EN_COURS',
                    'En pause': 'EN_PAUSE',
                    'Terminé': 'TERMINE',
                    'Pause terminée': 'PAUSE_TERMINEE',
                    'Arrêt forcé': 'FORCE_STOP'
                };
                statusCode = statusMap[operation.status] || 'EN_COURS';
            } else if (!statusCode) {
                statusCode = 'EN_COURS';
                statusLabel = 'En cours';
            }
            
            console.log(`🔍 Mise à jour statut pour ${operationId}:`, {
                statusCode: statusCode,
                statusLabel: statusLabel,
                operationStatusCode: operation.statusCode,
                operationStatus: operation.status
            });
            
            cells[5].innerHTML = `<span class="status-badge status-${statusCode}">${statusLabel}</span>`;
            
            console.log(`✅ Ligne ${operationId} mise à jour: ${formattedStartTime} -> ${formattedEndTime}, statut: ${statusCode} (${statusLabel})`);
        } else {
            console.error(`❌ Pas assez de cellules dans la ligne ${operationId}: ${cells.length}`);
        }
    }

    debugTimeSync(operationId) {
        const operation = this.operations.find(op => op.id == operationId);
        const row = document.querySelector(`tr[data-operation-id="${operationId}"]`);
        
        if (!operation) {
            console.error(`❌ Opération ${operationId} non trouvée en mémoire`);
            return;
        }
        
        if (!row) {
            console.error(`❌ Ligne ${operationId} non trouvée dans le DOM`);
            return;
        }
        
        const cells = row.querySelectorAll('td');
        const displayedStartTime = cells[3] ? cells[3].textContent : 'N/A';
        const displayedEndTime = cells[4] ? cells[4].textContent : 'N/A';
        
        console.log(`🔍 Debug synchronisation ${operationId}:`, {
            memory: {
                startTime: operation.startTime,
                endTime: operation.endTime
            },
            displayed: {
                startTime: displayedStartTime,
                endTime: displayedEndTime
            },
            formatted: {
                startTime: this.formatDateTime(operation.startTime),
                endTime: this.formatDateTime(operation.endTime)
            }
        });
    }

    validateAndFormatTime(timeString) {
        if (!timeString) return null;
        
        // Nettoyer la chaîne
        const cleanTime = timeString.trim();
        
        // Vérifier le format HH:mm
        const timeMatch = cleanTime.match(/^(\d{1,2}):(\d{2})$/);
        if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            
            // Validation des valeurs
            if (hours < 0 || hours > 23) {
                console.error(`Heures invalides: ${hours}`);
                return null;
            }
            if (minutes < 0 || minutes > 59) {
                console.error(`Minutes invalides: ${minutes}`);
                return null;
            }
            
            // Retourner au format HH:mm
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        }
        
        console.error(`Format d'heure invalide: ${timeString}`);
        return null;
    }

    validateTimeConsistency(startTime, endTime) {
        if (!startTime || !endTime) return true; // Pas de validation si une heure manque
        
        const startMinutes = this.timeToMinutes(startTime);
        const endMinutes = this.timeToMinutes(endTime);
        
        return endMinutes >= startMinutes;
    }

    timeToMinutes(timeString) {
        if (!timeString) return 0;
        
        const parts = timeString.split(':');
        if (parts.length < 2) return 0;
        
        const hours = parseInt(parts[0]) || 0;
        const minutes = parseInt(parts[1]) || 0;
        
        return hours * 60 + minutes;
    }

    async deleteOperation(id) {
        if (!confirm('Êtes-vous sûr de vouloir supprimer cette opération ?')) {
            return;
        }

        try {
            console.log(` Suppression opération ${id}`);

            const response = await this.apiService.deleteOperation(id);
            
            if (response.success) {
                this.notificationManager.success('Opération supprimée avec succès');
                this.loadData(); // Recharger les données
            } else {
                this.notificationManager.error('Erreur lors de la suppression');
            }
        } catch (error) {
            console.error('Erreur suppression:', error);
            this.notificationManager.error('Erreur lors de la suppression');
        }
    }

    // Méthodes pour l'export des données
    exportToCSV() {
        if (this.operations.length === 0) {
            this.notificationManager.warning('Aucune donnée à exporter');
            return;
        }

        const headers = ['Opérateur', 'Code Lancement', 'Article', 'Début', 'Fin', 'Durée', 'Statut'];
        const csvContent = [
            headers.join(','),
            ...this.operations.map(op => [
                op.operatorName || '',
                op.lancementCode || '',
                op.article || '',
                this.formatDateTime(op.startTime),
                op.endTime ? this.formatDateTime(op.endTime) : '',
                op.duration || '',
                this.getStatusText(op.status)
            ].join(','))
        ].join('\n');

        const today = new Date().toISOString().split('T')[0];
        this.downloadCSV(csvContent, `operations_${today}.csv`);
    }

    downloadCSV(content, filename) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Méthodes pour les statistiques avancées
    getDailyStats() {
        const stats = {
            totalOperations: this.operations.length,
            totalDuration: 0,
            averageDuration: 0,
            operators: new Set(),
            lancements: new Set()
        };

        this.operations.forEach(op => {
            if (op.operatorName) stats.operators.add(op.operatorName);
            if (op.lancementCode) stats.lancements.add(op.lancementCode);
            if (op.duration) {
                const duration = this.parseDuration(op.duration);
                stats.totalDuration += duration;
            }
        });

        stats.uniqueOperators = stats.operators.size;
        stats.uniqueLancements = stats.lancements.size;
        stats.averageDuration = stats.totalOperations > 0 ? stats.totalDuration / stats.totalOperations : 0;

        return stats;
    }

    parseDuration(durationString) {
        return TimeUtils.parseDuration(durationString) / 60; // Convertir en minutes
    }

    formatDuration(minutes) {
        return TimeUtils.formatDuration(Math.floor(minutes * 60));
    }

    // Méthode pour filtrer les opérations
    filterOperations(filter) {
        let filtered = [...this.operations];

        if (filter.operator) {
            filtered = filtered.filter(op => 
                op.operatorName && op.operatorName.toLowerCase().includes(filter.operator.toLowerCase())
            );
        }

        if (filter.lancement) {
            filtered = filtered.filter(op => 
                op.lancementCode && op.lancementCode.toLowerCase().includes(filter.lancement.toLowerCase())
            );
        }

        if (filter.status) {
            filtered = filtered.filter(op => op.status === filter.status);
        }

        return filtered;
    }

    getOperations() {
        return this.operations;
    }

    getStats() {
        return this.stats;
    }

    async loadTablesData() {
        try {
            console.log('  Chargement des données des tables ERP...');
            
            const data = await this.apiService.getTablesInfo();
            
            if (data.success) {
                this.updateTablesDisplay(data.data, data.counts);
                this.notificationManager.success(`Données chargées: ${data.counts.pause} entrées Pause, ${data.counts.temp} entrées Temp`);
            } else {
                this.notificationManager.error('Erreur lors du chargement des tables ERP');
            }
        } catch (error) {
            console.error('Erreur lors du chargement des tables:', error);
            this.notificationManager.error('Erreur de connexion lors du chargement des tables ERP');
        }
    }

    updateTablesDisplay(data, counts) {
        // Mise à jour des compteurs
        document.getElementById('pauseCount').textContent = counts.pause;
        document.getElementById('tempCount').textContent = counts.temp;

        // Mise à jour de la table abetemps_Pause
        this.updateErpTable('pauseTableBody', data.abetemps_Pause);
        
        // Mise à jour de la table abetemps_temp
        this.updateErpTable('tempTableBody', data.abetemps_temp);
    }

    updateErpTable(tableBodyId, tableData) {
        const tableBody = document.getElementById(tableBodyId);
        tableBody.innerHTML = '';

        if (!tableData || tableData.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td colspan="7" style="text-align: center; padding: 1rem; color: #666;">
                    Aucune donnée trouvée
                </td>
            `;
            tableBody.appendChild(row);
            return;
        }

        tableData.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.NoEnreg || '-'}</td>
                <td><span class="badge badge-${this.getIdentBadgeClass(item.Ident)}">${item.Ident || '-'}</span></td>
                <td>${this.formatDateTime(item.DateTravail) || '-'}</td>
                <td>${item.CodeLanctImprod || '-'}</td>
                <td>${item.Phase || '-'}</td>
                <td>${item.CodePoste || '-'}</td>
                <td><strong>${item.CodeOperateur || '-'}</strong></td>
                <td>${item.NomOperateur || 'Non assigné'}</td>
            `;
            tableBody.appendChild(row);
        });
    }

    getIdentBadgeClass(ident) {
        const classMap = {
            'DEBUT': 'success',
            'PAUSE': 'warning', 
            'REPRISE': 'info',
            'FIN': 'secondary',
            'ARRET': 'danger'
        };
        return classMap[ident] || 'light';
    }

    // Méthodes de pagination
    async loadPage(page) {
        if (this.isLoading) return;
        
        try {
            this.isLoading = true;
            this.currentPage = page;
            
            const data = await this.apiService.get(`/admin/operations?page=${page}&limit=25`);
            
            if (data.operations) {
                this.operations = data.operations;
                this.pagination = data.pagination;
                this.updateOperationsTable();
                this.updatePaginationInfo();
            }
        } catch (error) {
            console.error('Erreur lors du chargement de la page:', error);
            this.notificationManager.error('Erreur lors du chargement de la page');
        } finally {
            this.isLoading = false;
        }
    }

    updatePaginationInfo() {
        const paginationInfo = document.getElementById('paginationInfo');
        if (paginationInfo && this.pagination) {
            paginationInfo.innerHTML = `
                <div class="pagination-info">
                    <span>Page ${this.pagination.currentPage} sur ${this.pagination.totalPages}</span>
                    <span>(${this.pagination.totalItems} éléments au total)</span>
                    <div class="pagination-controls">
                        <button class="btn btn-sm btn-outline-primary" 
                                onclick="window.adminPage.loadPage(${this.pagination.currentPage - 1})"
                                ${!this.pagination.hasPrevPage ? 'disabled' : ''}>
                            ← Précédent
                        </button>
                        <button class="btn btn-sm btn-outline-primary"
                                onclick="window.adminPage.loadPage(${this.pagination.currentPage + 1})"
                                ${!this.pagination.hasNextPage ? 'disabled' : ''}>
                            Suivant →
                        </button>
                    </div>
                </div>
            `;
        }
    }
}

export default AdminPage;
