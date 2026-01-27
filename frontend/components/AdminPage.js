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
        this.selectedTempsIds = new Set(); // sélection de lignes dans le tableau principal (TempsId)
        
        // Debug (désactivé par défaut pour éviter de spammer la console)
        // Activer via URL: ?debugTime=1  ou via localStorage: sedi_debug_time=1
        this.debugTime = false;
        try {
            const sp = new URLSearchParams(window.location.search);
            this.debugTime =
                sp.get('debugTime') === '1' ||
                window.localStorage?.getItem('sedi_debug_time') === '1';
        } catch (e) {
            // noop
        }
        
        // Flags pour éviter les appels simultanés
        this._isTransferring = false;
        this._isConsolidating = false;
        
        // Système de sauvegarde automatique
        this.autoSaveEnabled = true;
        this.autoSaveInterval = 30000; // 30 secondes
        this.pendingChanges = new Map(); // Map des modifications en attente
        this.autoSaveTimer = null;
        
        // Initialisation silencieuse
        
        // Initialisation immédiate (le DOM devrait être prêt maintenant)
        this.initializeElements();
        this.setupEventListeners();
        this.startAutoSave();
    }

    initializeElements() {
        // Recherche des éléments DOM
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
            }
        });
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
        // Attendre un peu que le DOM soit complètement prêt
        setTimeout(() => {
            try {
                // Bouton Actualiser
                const refreshBtn = document.getElementById('refreshDataBtn');
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', () => {
                        this.resetConsecutiveErrors();
                        this.loadData();
                    });
                }

                // Modale transfert
                const closeTransferModalBtn = document.getElementById('closeTransferModalBtn');
                if (closeTransferModalBtn) {
                    closeTransferModalBtn.addEventListener('click', () => this.hideTransferModal());
                }

                const transferSelectedConfirmBtn = document.getElementById('transferSelectedConfirmBtn');
                if (transferSelectedConfirmBtn) {
                    transferSelectedConfirmBtn.addEventListener('click', () => this.confirmTransferFromModal());
                }

                const transferSelectAll = document.getElementById('transferSelectAll');
                if (transferSelectAll) {
                    transferSelectAll.addEventListener('change', () => this.toggleTransferSelectAll(transferSelectAll.checked));
                }
                
                // Menu déroulant opérateurs
                const operatorSelect = document.getElementById('operatorFilter');
                if (operatorSelect) {
                    operatorSelect.addEventListener('change', () => this.handleOperatorChange());
                }
                
                // Filtre de statut
                const statusFilter = document.getElementById('statusFilter');
                if (statusFilter) {
                    statusFilter.addEventListener('change', () => {
                        // Recharger depuis le backend car ABTEMPS_OPERATEURS est filtré côté API
                        this.loadData();
                    });
                }

                // Filtre de période
                const periodFilter = document.getElementById('periodFilter');
                if (periodFilter) {
                    periodFilter.addEventListener('change', () => {
                        this.loadData();
                    });
                }
                
                // Filtre de recherche
                const searchFilter = document.getElementById('searchFilter');
                if (searchFilter) {
                    searchFilter.addEventListener('input', () => {
                        // Recharger depuis le backend car le filtre lancement peut être appliqué côté API
                        this.loadData();
                    });
                }
                
                // Bouton effacer filtres
                const clearFiltersBtn = document.getElementById('clearFiltersBtn');
                if (clearFiltersBtn) {
                    clearFiltersBtn.addEventListener('click', () => {
                        if (operatorSelect) operatorSelect.value = '';
                        if (statusFilter) statusFilter.value = '';
                        if (periodFilter) periodFilter.value = 'today';
                        if (searchFilter) searchFilter.value = '';
                        this.loadData();
                    });
                }
                
                   // Bouton Transfert
                   const transferBtn = document.getElementById('transferBtn');
                   if (transferBtn) {
                       transferBtn.addEventListener('click', () => this.handleTransfer());
                   }
                   
                   // Bouton Ajouter une ligne
                   const addOperationBtn = document.getElementById('addOperationBtn');
                   if (addOperationBtn) {
                       addOperationBtn.addEventListener('click', () => this.handleAddOperation());
                   }
                
                // Tableau des opérations
                const tableBody = document.getElementById('operationsTableBody');
                if (tableBody) {
                    tableBody.addEventListener('click', async (e) => {
                        if (e.target.closest('.btn-delete')) {
                            const btn = e.target.closest('.btn-delete');
                            const tempsId = btn.dataset.tempsId ? parseInt(btn.dataset.tempsId, 10) : null;
                            const eventId = btn.dataset.eventId ? btn.dataset.eventId : null;
                            const id = btn.dataset.id || btn.dataset.operationId;
                            const isUnconsolidated = (btn.dataset.unconsolidated === 'true') || !tempsId;

                            if (isUnconsolidated) {
                                await this.deleteOperation(eventId || id);
                            } else {
                                await this.deleteMonitoringRecord(tempsId || id);
                            }
                        } else if (e.target.closest('.btn-edit')) {
                            e.preventDefault();
                            e.stopPropagation();
                            const btn = e.target.closest('.btn-edit');
                            const tempsId = btn.dataset.tempsId ? parseInt(btn.dataset.tempsId, 10) : null;
                            const eventId = btn.dataset.eventId ? btn.dataset.eventId : null;
                            const id = btn.dataset.id || btn.dataset.operationId;
                            const isUnconsolidated = (btn.dataset.unconsolidated === 'true') || !tempsId;
                            
                            if (!id) {
                                console.error('❌ ID manquant sur le bouton!');
                                this.notificationManager.error('Erreur: ID manquant sur le bouton d\'édition');
                                return;
                            }
                            
                            try {
                                if (isUnconsolidated) {
                                    await this.editOperation(eventId || id);
                                } else {
                                    await this.editMonitoringRecord(tempsId || id);
                                }
                            } catch (error) {
                                console.error('❌ Erreur lors de l\'édition:', error);
                                this.notificationManager.error(`Erreur lors de l'édition: ${error.message}`);
                            }
                        }
                    });
                }
                
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

    async loadData(enableAutoConsolidate = true) {
        if (this.isLoading) {
            console.log('Chargement déjà en cours, ignorer...');
            return;
        }
        
        try {
            this.isLoading = true;
            
            // Charger les opérateurs connectés et les données admin en parallèle avec timeout
            // Appliquer la période sélectionnée pour la partie monitoring (ABTEMPS_OPERATEURS)
            const now = new Date();
            const today = now.toISOString().split('T')[0];
            const period = document.getElementById('periodFilter')?.value || 'today';

            const toDateOnly = (d) => d.toISOString().split('T')[0];
            const startOfWeekMonday = (d) => {
                const x = new Date(d);
                x.setHours(0, 0, 0, 0);
                const day = x.getDay(); // 0=dim, 1=lun...
                const diff = (day === 0 ? -6 : 1) - day; // revenir au lundi
                x.setDate(x.getDate() + diff);
                return x;
            };
            const startOfMonth = (d) => {
                const x = new Date(d.getFullYear(), d.getMonth(), 1);
                x.setHours(0, 0, 0, 0);
                return x;
            };

            const periodRange = (() => {
                if (period === 'yesterday') {
                    const y = new Date(now);
                    y.setDate(y.getDate() - 1);
                    return { date: toDateOnly(y) };
                }
                if (period === 'week') {
                    const start = startOfWeekMonday(now);
                    return { dateStart: toDateOnly(start), dateEnd: today };
                }
                if (period === 'month') {
                    const start = startOfMonth(now);
                    return { dateStart: toDateOnly(start), dateEnd: today };
                }
                // today / custom (non implémenté): fallback sur aujourd'hui
                return { date: today };
            })();
            
            // Créer des promesses avec timeout
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout: La requête a pris trop de temps')), 30000)
            );
            
            // Charger les données en parallèle avec timeout
            const dataPromises = Promise.all([
                this.apiService.getAdminData(today),
                this.apiService.getConnectedOperators(),
                this.apiService.getAllOperators() // Charger aussi la liste globale
            ]);
            
            const [adminData, operatorsData, allOperatorsData] = await Promise.race([
                dataPromises,
                timeoutPromise
            ]);
            
            // Les données sont déjà parsées par ApiService
            const data = adminData;
            
            // Charger les opérations consolidées depuis ABTEMPS_OPERATEURS
            const statutTraitement = document.getElementById('statusFilter')?.value || undefined;
            const operatorCode = document.getElementById('operatorFilter')?.value || undefined;
            const lancementCode = document.getElementById('searchFilter')?.value?.trim() || undefined;

            const filters = { ...periodRange };
            if (statutTraitement) filters.statutTraitement = statutTraitement;
            if (operatorCode) filters.operatorCode = operatorCode;
            if (lancementCode) filters.lancementCode = lancementCode;

            // Charger les enregistrements consolidés depuis ABTEMPS_OPERATEURS
            const monitoringResult = await this.apiService.getMonitoringTemps(filters);
            let consolidatedOps = [];
            if (monitoringResult && monitoringResult.success) {
                consolidatedOps = monitoringResult.data || [];
            }
            
            // Convertir les opérations de getAdminData au format monitoring (non consolidées)
            let adminOps = [];
            if (data && data.operations && data.operations.length > 0) {
                adminOps = data.operations.map(op => ({
                    // IMPORTANT:
                    // - TempsId = identifiant de ABTEMPS_OPERATEURS (consolidé)
                    // - EventId / id = identifiant de ABHISTORIQUE_OPERATEURS (non consolidé)
                    // Ne JAMAIS surcharger TempsId avec un NoEnreg, sinon les routes /admin/monitoring/:tempsId feront 404.
                    TempsId: null,
                    EventId: op.id,
                    id: op.id,
                    OperatorCode: op.operatorId,
                    OperatorName: op.operatorName,
                    LancementCode: op.lancementCode,
                    LancementName: op.article,
                    StartTime: op.startTime,
                    EndTime: op.endTime,
                    startTime: op.startTime,
                    endTime: op.endTime,
                    TotalDuration: op.duration ? parseInt(op.duration.replace(/[^0-9]/g, '')) : null,
                    PauseDuration: op.pauseDuration ? parseInt(op.pauseDuration.replace(/[^0-9]/g, '')) : 0,
                    ProductiveDuration: null,
                    EventsCount: op.events || 0,
                    Phase: op.phase || 'PRODUCTION',
                    CodeRubrique: op.codeRubrique || op.operatorId,
                    StatutTraitement: null,
                    Status: op.status || 'En cours',
                    StatusCode: op.statusCode || 'EN_COURS',
                    status: op.status || 'En cours',
                    statusCode: op.statusCode || 'EN_COURS',
                    DateCreation: today,
                    CalculatedAt: null,
                    CalculationMethod: null,
                    _isUnconsolidated: true
                }));
            }
            
            // Appliquer les filtres sur les opérations non consolidées
            let filteredAdminOps = adminOps;
            if (operatorCode) {
                filteredAdminOps = filteredAdminOps.filter(op => op.OperatorCode === operatorCode);
            }
            if (lancementCode) {
                filteredAdminOps = filteredAdminOps.filter(op => 
                    op.LancementCode.toLowerCase().includes(lancementCode.toLowerCase())
                );
            }
            
            // Fusionner les opérations SANS doublons:
            // - Une seule ligne par (OperatorCode, LancementCode)
            // - On garde automatiquement la "meilleure" version (heures non 00:00, consolidée, etc.)
            const mergedMap = new Map();

            const normalizeKey = (op) => {
                const operator = (op?.OperatorCode ?? op?.operatorId ?? op?.OperatorId ?? '').toString().trim();
                const lancement = (op?.LancementCode ?? op?.lancementCode ?? op?.lancementCode ?? '').toString().trim().toUpperCase();
                const phase = (op?.Phase ?? op?.phase ?? '').toString().trim().toUpperCase();
                const rubrique = (op?.CodeRubrique ?? op?.codeRubrique ?? '').toString().trim().toUpperCase();
                return `${operator}_${lancement}_${phase}_${rubrique}`;
            };

            const toHHmm = (dt) => {
                const f = this.formatDateTime(dt);
                return (f && f !== '-') ? f : '';
            };

            const isMidnight = (dt) => toHHmm(dt) === '00:00';

            const scoreOp = (op) => {
                // Score plus élevé = on garde cet enregistrement
                let score = 0;
                if (op?.TempsId) score += 100; // consolidé
                if (op?._isUnconsolidated) score -= 1;

                const st = op?.StartTime ?? op?.startTime;
                const et = op?.EndTime ?? op?.endTime;

                if (st) score += isMidnight(st) ? -20 : 10;
                if (et) score += isMidnight(et) ? -20 : 10;

                // Bonus si opération réellement terminée
                if (this.isOperationTerminated(op)) score += 5;
                return score;
            };

            const chooseBest = (a, b) => {
                const sa = scoreOp(a);
                const sb = scoreOp(b);
                if (sa !== sb) return sa > sb ? a : b;

                // Tie-break: TempsId le plus récent si présent
                const ta = a?.TempsId ? parseInt(a.TempsId, 10) : 0;
                const tb = b?.TempsId ? parseInt(b.TempsId, 10) : 0;
                if (ta !== tb) return ta > tb ? a : b;

                return a; // stable
            };
            
            // Vérifier si l'utilisateur veut voir les opérations transmises
            const statusFilter = document.getElementById('statusFilter');
            const showTransmitted = statusFilter?.value === 'T';
            
            // D'abord ajouter les opérations de monitoring (consolidées)
            // Exclure par défaut les opérations transmises (StatutTraitement = 'T')
            consolidatedOps.forEach(op => {
                // Si on ne veut pas voir les transmises et que cette opération est transmise, la sauter
                if (!showTransmitted && op.StatutTraitement === 'T') {
                    return; // Skip cette opération
                }
                const key = normalizeKey(op);
                const existing = mergedMap.get(key);
                mergedMap.set(key, existing ? chooseBest(existing, op) : op);
            });
            
            // Ensuite ajouter les opérations admin (non consolidées)
            filteredAdminOps.forEach(op => {
                const key = normalizeKey(op);
                const existing = mergedMap.get(key);
                mergedMap.set(key, existing ? chooseBest(existing, op) : op);
            });
            
            this.operations = Array.from(mergedMap.values());
            
            // Réinitialiser le compteur d'erreurs en cas de succès
            this.consecutiveErrors = 0;
            
            // Stats/pagination: proviennent de /api/admin
            this.pagination = data?.pagination || null;
            
            if (data && data.stats) {
                this.stats = data.stats;
            } else {
                this.stats = {
                    totalOperators: 0,
                    activeLancements: 0,
                    pausedLancements: 0,
                    completedLancements: 0
                };
            }
            
            // Mettre à jour le menu déroulant des opérateurs avec les deux listes
            const connectedOps = operatorsData && (operatorsData.success ? operatorsData.operators : operatorsData.operators) || [];
            const allOps = allOperatorsData && (allOperatorsData.success ? allOperatorsData.operators : allOperatorsData.operators) || [];
            
            if (connectedOps.length > 0 || allOps.length > 0) {
                this.updateOperatorSelect(connectedOps, allOps);
                this.lastOperatorsUpdate = Date.now(); // Mettre à jour le timestamp
            }
            
            // Mettre à jour l'affichage des opérateurs connectés (toujours, même si vide)
            this.updateActiveOperatorsDisplay(connectedOps);
            
            this.updateStats();
            this.updateOperationsTable();
            this.updatePaginationInfo();
        } catch (error) {
            console.error('❌ ERREUR loadData():', error);
            
            // Vérifier si c'est une erreur 429 (Too Many Requests)
            const isRateLimitError = error.message && (
                error.message.includes('429') || 
                error.message.includes('Too Many Requests') ||
                error.message.includes('Trop de requêtes')
            );
            
            if (isRateLimitError) {
                // Pour les erreurs 429, augmenter significativement le compteur d'erreurs
                // pour désactiver le refresh automatique plus rapidement
                this.consecutiveErrors += 3; // Équivalent à 3 erreurs normales
                
                // Augmenter l'intervalle de refresh temporairement
                if (this.refreshInterval) {
                    clearInterval(this.refreshInterval);
                    // Augmenter l'intervalle à 60 secondes au lieu de 15
                    this.refreshInterval = setInterval(() => {
                        if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                            console.log(`⏸️ Refresh automatique désactivé (${this.consecutiveErrors} erreurs consécutives)`);
                            return;
                        }
                        const timeSinceLastEdit = Date.now() - this.lastEditTime;
                        if (!this.isLoading && timeSinceLastEdit > 5000) {
                            this.loadDataWithRetry();
                        }
                    }, 60000); // 60 secondes au lieu de 15
                }
                
                // Afficher un message spécifique pour le rate limiting
                if (this.consecutiveErrors <= 3) {
                    this.notificationManager.warning('Trop de requêtes. Le rafraîchissement automatique est ralenti. Veuillez patienter...');
                }
            } else {
                // Pour les autres erreurs, incrémenter normalement
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
            }
            
            // Mettre à jour l'indicateur des opérateurs même en cas d'erreur
            this.updateActiveOperatorsDisplay([]);
            
            // Afficher les données en cache si disponibles
            if (this.operations.length > 0) {
                if (this.consecutiveErrors <= 2 && !isRateLimitError) {
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
        
        // Réinitialiser l'intervalle de refresh à 15 secondes
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = setInterval(() => {
                if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                    console.log(`⏸️ Refresh automatique désactivé (${this.consecutiveErrors} erreurs consécutives)`);
                    return;
                }
                const timeSinceLastEdit = Date.now() - this.lastEditTime;
                if (!this.isLoading && timeSinceLastEdit > 5000) {
                    this.loadDataWithRetry();
                }
            }, 15000); // Retour à 15 secondes
        }
        
        console.log('✅ Compteur d\'erreurs réinitialisé, refresh automatique réactivé');
    }

    // ===== Monitoring (ABTEMPS_OPERATEURS) =====
    // NOTE: Cette fonction est maintenant principalement utilisée pour le rechargement après modifications
    // Le chargement principal est fait dans loadData() pour éviter les doubles appels API
    async loadMonitoringRecords(date) {
        try {
            const statutTraitement = document.getElementById('statusFilter')?.value || undefined;
            const operatorCode = document.getElementById('operatorFilter')?.value || undefined;
            const lancementCode = document.getElementById('searchFilter')?.value?.trim() || undefined;

            const filters = { date };
            if (statutTraitement) filters.statutTraitement = statutTraitement;
            if (operatorCode) filters.operatorCode = operatorCode;
            if (lancementCode) filters.lancementCode = lancementCode;

            // Charger uniquement les enregistrements consolidés depuis ABTEMPS_OPERATEURS
            const result = await this.apiService.getMonitoringTemps(filters);
            if (result && result.success) {
                this.operations = result.data || [];
            } else {
                this.operations = [];
            }
        } catch (error) {
            console.error('❌ Erreur loadMonitoringRecords:', error);
            this.operations = [];
        }
    }

    updateStats() {
        // Calculer les statistiques depuis les opérations affichées dans le tableau
        // Cela garantit la cohérence entre le tableau et les statistiques
        const allOps = this.operations || [];
        
        // Compter les opérations par statut depuis les données réelles
        const activeOps = allOps.filter(op => {
            const status = (op.StatusCode || op.statusCode || '').toUpperCase();
            const statusLabel = (op.Status || op.status || '').toUpperCase();
            return status === 'EN_COURS' || statusLabel.includes('EN COURS');
        });
        
        const pausedOps = allOps.filter(op => {
            const status = (op.StatusCode || op.statusCode || '').toUpperCase();
            const statusLabel = (op.Status || op.status || '').toUpperCase();
            return status === 'EN_PAUSE' || status === 'PAUSE' || statusLabel.includes('PAUSE');
        });
        
        const completedOps = allOps.filter(op => {
            const status = (op.StatusCode || op.statusCode || '').toUpperCase();
            const statusLabel = (op.Status || op.status || '').toUpperCase();
            const hasEndTime = op.EndTime && op.EndTime !== '-' && op.EndTime !== 'N/A' && op.EndTime.trim() !== '';
            return status === 'TERMINE' || statusLabel.includes('TERMIN') || hasEndTime;
        });
        
        // Utiliser les stats du backend pour totalOperators, mais calculer les autres depuis les données locales
        const stats = {
            totalOperators: this.stats?.totalOperators || 0,
            activeLancements: activeOps.length,
            pausedLancements: pausedOps.length,
            completedLancements: completedOps.length
        };
        
        // Mettre à jour les éléments DOM
        if (this.totalOperators) {
            this.totalOperators.textContent = stats.totalOperators;
        }
        if (this.activeLancements) {
            this.activeLancements.textContent = stats.activeLancements;
        }
        if (this.pausedLancements) {
            this.pausedLancements.textContent = stats.pausedLancements;
        }
        if (this.completedLancements) {
            this.completedLancements.textContent = stats.completedLancements;
        }
        
        // Mettre à jour this.stats pour la cohérence
        this.stats = stats;
        
        // Log pour debug
        console.log('📊 Statistiques mises à jour depuis les données du tableau:', stats);
    }

    showNoDataMessage() {
        if (!this.operationsTableBody) return;
        
        this.operationsTableBody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 2rem; color: #dc3545;">
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

    updateOperatorSelect(connectedOperators = [], allOperators = []) {
        console.log('🔄 Mise à jour du menu déroulant des opérateurs:', {
            connectés: connectedOperators.length,
            globaux: allOperators.length
        });
        
        // Vider le select et ajouter l'option par défaut
        this.operatorSelect.innerHTML = '<option value="">Tous les opérateurs</option>';
        
        // Créer un Set des codes d'opérateurs connectés pour vérification rapide
        const connectedCodes = new Set(connectedOperators.map(op => op.code));
        
        // Section 1: Opérateurs connectés (en opération)
        if (connectedOperators.length > 0) {
            const optgroupConnected = document.createElement('optgroup');
            optgroupConnected.label = `🟢 Opérateurs connectés (${connectedOperators.length})`;
            
            connectedOperators.forEach(operator => {
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
                    statusIcon = ' 🔴' + statusIcon;
                option.style.fontWeight = 'bold';
                    option.style.color = '#dc3545';
                } else {
                    statusIcon = ' 🟢' + statusIcon;
            }
            
            option.textContent = `${operator.name} (${operator.code})${statusIcon}`;
            option.title = `Code: ${operator.code} | Ressource: ${operator.resourceCode || 'N/A'} | Statut: ${operator.currentStatus || 'N/A'}`;
            
                optgroupConnected.appendChild(option);
            });
            
            this.operatorSelect.appendChild(optgroupConnected);
        }
        
        // Section 2: Tous les opérateurs (globale)
        if (allOperators.length > 0) {
            const optgroupAll = document.createElement('optgroup');
            optgroupAll.label = `📋 Tous les opérateurs (${allOperators.length})`;
            
            allOperators.forEach(operator => {
                // Ne pas dupliquer les opérateurs déjà dans la liste connectés
                if (connectedCodes.has(operator.code)) {
                    return;
                }
                
                const option = document.createElement('option');
                option.value = operator.code;
                
                // Indicateur de connexion
                let statusIcon = operator.isConnected ? ' 🟢' : ' ⚪';
                
                option.textContent = `${operator.name} (${operator.code})${statusIcon}`;
                option.title = `Code: ${operator.code} | Type: ${operator.type || 'N/A'} | ${operator.isConnected ? 'Connecté' : 'Non connecté'}`;
                
                optgroupAll.appendChild(option);
            });
            
            this.operatorSelect.appendChild(optgroupAll);
        }
        
        console.log('✅ Menu déroulant mis à jour avec', connectedOperators.length, 'connectés et', allOperators.length, 'globaux');
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
            const [connectedResponse, allOperatorsResponse] = await Promise.all([
                this.apiService.getConnectedOperators(),
                this.apiService.getAllOperators()
            ]);
            
            const connectedOps = connectedResponse && (connectedResponse.success ? connectedResponse.operators : connectedResponse.operators) || [];
            const allOps = allOperatorsResponse && (allOperatorsResponse.success ? allOperatorsResponse.operators : allOperatorsResponse.operators) || [];
            
            if (connectedOps.length > 0 || allOps.length > 0) {
                this.updateOperatorSelect(connectedOps, allOps);
                this.lastOperatorsUpdate = Date.now(); // Mettre à jour le timestamp
            }
            
            // Mettre à jour l'affichage des opérateurs actifs (toujours, même si vide)
            this.updateActiveOperatorsDisplay(connectedOps);
        } catch (error) {
            console.error('Erreur lors de la mise à jour du statut des opérateurs:', error);
            // Mettre à jour l'indicateur avec un état d'erreur
            this.updateActiveOperatorsDisplay([]);
            // En cas d'erreur 429, attendre plus longtemps avant la prochaine tentative
            if (error.message && error.message.includes('Trop de requêtes')) {
                this.lastOperatorsUpdate = Date.now() - 5000; // Forcer une attente de 15 secondes minimum
                console.log('⏸️ Rate limit détecté, attente prolongée avant la prochaine mise à jour');
            }
        }
    }

    // Afficher les opérateurs actifs
    updateActiveOperatorsDisplay(operators = []) {
        const activeOperators = operators.filter(op => op.isActive);
        
        // Mettre à jour un indicateur visuel des opérateurs actifs
        const activeIndicator = document.getElementById('activeOperatorsIndicator');
        if (activeIndicator) {
            if (activeOperators.length > 0) {
                // Afficher les noms (max 3) + compteur
                const names = activeOperators
                    .slice(0, 3)
                    .map(op => `${op.name || op.code} (${op.code})`)
                    .join(', ');
                const more = activeOperators.length > 3 ? ` +${activeOperators.length - 3}` : '';
            activeIndicator.innerHTML = `
                <span class="badge badge-success">
                         🟢 ${names}${more}
                    </span>
                `;
            } else if (operators.length > 0) {
                // Des opérateurs sont connectés mais aucun n'est actif
                const names = operators
                    .slice(0, 3)
                    .map(op => `${op.name || op.code} (${op.code})`)
                    .join(', ');
                const more = operators.length > 3 ? ` +${operators.length - 3}` : '';
                activeIndicator.innerHTML = `
                    <span class="badge badge-secondary">
                         🟢 Connecté(s): ${names}${more}
                    </span>
                `;
            } else {
                // Aucun opérateur connecté
                activeIndicator.innerHTML = `
                    <span class="badge badge-secondary">
                        Aucun opérateur connecté
                </span>
            `;
            }
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
        if (this.selectedTempsIds && typeof this.selectedTempsIds.clear === 'function') {
        this.selectedTempsIds.clear();
        } else {
            this.selectedTempsIds = new Set();
        }
        const selectAll = document.getElementById('selectAllRows');
        if (selectAll) selectAll.checked = false;
        await this.loadData();
    }

    async handleAddOperation() {
        try {
            // Demander les informations pour la nouvelle ligne
            const operatorCode = prompt('Code opérateur :');
            if (!operatorCode) return;
            
            const lancementCode = prompt('Code lancement :');
            if (!lancementCode) return;

            // Étape / fabrication (CodeOperation) : ne demander que s'il y a plusieurs fabrications distinctes
            let codeOperation = null;
            try {
                const stepsRes = await this.apiService.getLancementSteps(lancementCode);
                const uniqueOps = stepsRes?.uniqueOperations || [];
                const opCount = stepsRes?.operationCount ?? uniqueOps.length;

                if (Array.isArray(uniqueOps) && opCount > 1) {
                    const lines = uniqueOps.map((op, idx) => `${idx + 1}) ${op}`);
                    const answer = window.prompt(
                        `Plusieurs fabrications sont disponibles pour ${lancementCode}.\nChoisis le numéro:\n\n${lines.join('\n')}\n\nNuméro:`
                    );
                    const choiceIdx = Number.parseInt(String(answer || '').trim(), 10) - 1;
                    const chosen = uniqueOps[choiceIdx];
                    if (!chosen) {
                        this.notificationManager.error('Aucune fabrication sélectionnée (CodeOperation)');
                        return;
                    }
                    codeOperation = chosen;
                } else if (Array.isArray(uniqueOps) && uniqueOps.length === 1) {
                    codeOperation = uniqueOps[0];
                }
            } catch (e) {
                // Best effort: si l'endpoint steps échoue, on laisse l'admin créer une ligne "ADMIN"
                console.warn('⚠️ Impossible de récupérer les étapes (CodeOperation) pour admin:', e?.message || e);
            }

            const phase = prompt('Phase (optionnel - laisser vide pour ERP/auto) :') || '';
            
            // Créer une nouvelle opération
            const newOperation = {
                operatorId: operatorCode,
                lancementCode: lancementCode,
                phase: phase,
                codeOperation,
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
        
        // Par défaut, exclure les opérations transmises (StatutTraitement = 'T')
        // Sauf si l'utilisateur a explicitement sélectionné le filtre "Transmis"
        const statusFilter = document.getElementById('statusFilter');
        const selectedStatus = statusFilter?.value?.toUpperCase().trim();
        
        if (selectedStatus === 'T') {
            // Si l'utilisateur veut voir les transmises, ne filtrer que celles-ci
            filteredOperations = filteredOperations.filter(op => {
                const st = (op.StatutTraitement === null || op.StatutTraitement === undefined)
                    ? 'NULL'
                    : String(op.StatutTraitement).toUpperCase().trim();
                return st === 'T';
            });
        } else {
            // Par défaut, exclure les opérations transmises
            filteredOperations = filteredOperations.filter(op => {
                const st = (op.StatutTraitement === null || op.StatutTraitement === undefined)
                    ? 'NULL'
                    : String(op.StatutTraitement).toUpperCase().trim();
                return st !== 'T'; // Exclure les transmises
            });
            
            // Si un autre filtre de statut est sélectionné, l'appliquer
            if (selectedStatus && selectedStatus !== '') {
                filteredOperations = filteredOperations.filter(op => {
                    const st = (op.StatutTraitement === null || op.StatutTraitement === undefined)
                        ? 'NULL'
                        : String(op.StatutTraitement).toUpperCase().trim();
                    return st === selectedStatus;
                });
            }
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
                <td colspan="9" class="empty-state">
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
            
            // Identifiants (ne pas confondre):
            // - TempsId: ABTEMPS_OPERATEURS (consolidé)
            // - EventId/id: ABHISTORIQUE_OPERATEURS (non consolidé)
            const tempsId = operation.TempsId ?? null;
            const eventId = operation.EventId ?? operation.id ?? null;
            const isUnconsolidated = operation._isUnconsolidated === true || !tempsId;

            // data-operation-id sert aux recherches DOM (édition inline / update row)
            const rowId = tempsId || eventId;
            row.setAttribute('data-operation-id', rowId);
            row.dataset.tempsId = tempsId ? String(tempsId) : '';
            row.dataset.eventId = eventId ? String(eventId) : '';
            row.dataset.unconsolidated = isUnconsolidated ? 'true' : 'false';

            // Déterminer le statut à afficher :
            // 1. Priorité au statut de l'opération (Status/StatusCode) - indique si l'opération est Terminé, En cours, En pause
            // 2. Sinon, utiliser le statut de traitement/consolidation (StatutTraitement) - indique si l'opération est consolidée/transférée
            let statutCode, statutLabel;
            
            // Vérifier d'abord le statut de l'opération (Status/StatusCode)
            if (operation.StatusCode && operation.Status) {
                statutCode = operation.StatusCode.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
                statutLabel = operation.Status;
            } 
            // Si pas de statut explicite mais une heure de fin valide, l'opération est terminée
            else if (formattedEndTime && formattedEndTime !== '-' && formattedEndTime.trim() !== '' && formattedEndTime !== 'N/A') {
                statutCode = 'TERMINE';
                statutLabel = 'Terminé';
            } 
            // Sinon, utiliser le statut de traitement/consolidation
            else {
                statutCode = (operation.StatutTraitement === null || operation.StatutTraitement === undefined)
                ? 'NULL'
                : String(operation.StatutTraitement).toUpperCase();
                statutLabel = this.getMonitoringStatusText(statutCode);
            }
            
            row.innerHTML = `
                <td>${operation.OperatorName || operation.OperatorCode || '-'}</td>
                <td>${operation.LancementCode || '-'}</td>
                <td>${operation.LancementName || '-'}</td>
                <td>${operation.Phase || operation.phase || '-'}</td>
                <td>${operation.CodeRubrique || operation.codeRubrique || '-'}</td>
                <td>${formattedStartTime}</td>
                <td>${formattedEndTime}${timeWarning}</td>
                <td>
                    <span class="status-badge status-${statutCode}">${statutLabel}</span>
                </td>
                <td class="actions-cell">
                    <button class="btn-edit"
                        data-id="${rowId}"
                        data-operation-id="${rowId}"
                        data-temps-id="${tempsId || ''}"
                        data-event-id="${eventId || ''}"
                        data-unconsolidated="${isUnconsolidated ? 'true' : 'false'}"
                        title="Corriger"
                        type="button">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-delete"
                        data-id="${rowId}"
                        data-operation-id="${rowId}"
                        data-temps-id="${tempsId || ''}"
                        data-event-id="${eventId || ''}"
                        data-unconsolidated="${isUnconsolidated ? 'true' : 'false'}"
                        title="Supprimer"
                        type="button">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            this.operationsTableBody.appendChild(row);
            
            // Afficher les problèmes détectés pour cette opération
            this.showOperationIssues(operation, row);
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

    // ===== Helper: déterminer si une opération est Terminé (même logique que dans updateOperationsTable) =====
    isOperationTerminated(operation) {
        // Si StatusCode/Status existe et indique "Terminé"
        if (operation.StatusCode && operation.Status) {
            const statusUpper = String(operation.Status).toUpperCase();
            if (statusUpper.includes('TERMIN') || statusUpper === 'TERMINE') {
                return true;
            }
        }
        
        // Sinon, vérifier EndTime formaté (même logique que dans updateOperationsTable)
        const formattedEndTime = this.formatDateTime(operation.EndTime);
        if (formattedEndTime && formattedEndTime !== '-' && formattedEndTime.trim() !== '' && formattedEndTime !== 'N/A') {
            return true;
        }
        
        return false;
    }

    // ===== Transfert: une seule consolidation puis transfert, sans boucle =====
    async handleTransfer() {
        // Empêcher les appels simultanés
        if (this._isTransferring) {
            console.log('⏸️ Transfert déjà en cours, ignoré');
            return;
        }

        try {
            this._isTransferring = true;
            const allRecordsData = this.operations || [];
            console.log(`📊 Total opérations dans le tableau: ${allRecordsData.length}`);

            // 1) Prendre uniquement les opérations TERMINÉES non déjà transférées
            let terminatedOps = allRecordsData.filter(
                op => this.isOperationTerminated(op) && op.StatutTraitement !== 'T'
            );

            console.log(`📊 Opérations TERMINÉES non transférées: ${terminatedOps.length}`);

            if (terminatedOps.length === 0) {
                const alreadyTransferred = allRecordsData.filter(op => op.StatutTraitement === 'T').length;
                const terminated = allRecordsData.filter(op => this.isOperationTerminated(op)).length;
                this.notificationManager.warning(
                    `Aucune opération TERMINÉE à transférer (${terminated} terminées, ${alreadyTransferred} déjà transférées)`
                );
                return;
            }

            // 2) Un seul batch de consolidation pour celles sans TempsId
            const opsWithoutTempsId = terminatedOps.filter(op => !op.TempsId);
            // Garder une trace des éléments ignorés/erreurs du batch de consolidation
            // pour expliquer correctement l'absence de TempsId après reload.
            let lastConsolidationSkipped = [];
            let lastConsolidationErrors = [];
            if (opsWithoutTempsId.length > 0) {
                console.log(`🔄 Consolidation de ${opsWithoutTempsId.length} opération(s) terminée(s) sans TempsId avant transfert...`);
                const operationsToConsolidate = opsWithoutTempsId.map(op => ({
                    OperatorCode: op.OperatorCode,
                    LancementCode: op.LancementCode
                }));
                
                // Marquer la consolidation en cours pour éviter les appels récursifs
                this._isConsolidating = true;
                try {
                    const consolidateResult = await this.apiService.consolidateMonitoringBatch(operationsToConsolidate);
                    const ok = consolidateResult?.results?.success || [];
                    const errors = consolidateResult?.results?.errors || [];
                    const skipped = consolidateResult?.results?.skipped || [];
                    lastConsolidationSkipped = skipped;
                    lastConsolidationErrors = errors;

                    console.log(
                        `✅ Consolidation pré-transfert: ${ok.length} réussie(s), ` +
                        `${skipped.length} ignorée(s), ` +
                        `${errors.length} erreur(s)`
                    );

                    if (errors.length > 0) {
                        // Construire un message détaillé avec les erreurs
                        const errorDetails = errors.map(err => {
                            const op = err.operation || {};
                            return `• ${op.OperatorCode || '?'}/${op.LancementCode || '?'}: ${err.error || 'Erreur inconnue'}`;
                        }).join('\n');
                        
                        const errorMessage = 
                            `${errors.length} opération(s) n'ont pas pu être consolidée(s):\n\n${errorDetails}\n\n` +
                            `Vérifiez que les opérations ont bien des événements DEBUT et FIN dans ABHISTORIQUE_OPERATEURS.`;
                        
                        console.error('❌ Erreurs de consolidation:', errors);
                        
                        // Utiliser alert() pour afficher le message complet
                        alert(errorMessage);
                        
                        // Aussi afficher une notification courte
                        this.notificationManager.warning(
                            `${errors.length} opération(s) n'ont pas pu être consolidée(s). Voir l'alerte pour les détails.`,
                            8000
                        );
                    }

                    // Recharger une seule fois les données pour récupérer les nouveaux TempsId
                    // Désactiver la consolidation automatique pendant le rechargement
                    await this.loadData(false); // Passer false pour désactiver autoConsolidate
                    terminatedOps = (this.operations || []).filter(
                        op => this.isOperationTerminated(op) && op.StatutTraitement !== 'T'
                    );
                } finally {
                    this._isConsolidating = false;
                }
            }

            // 3) Ne garder pour le transfert que les opérations qui ont maintenant un TempsId
            const terminatedWithTempsId = terminatedOps.filter(op => op.TempsId);

            if (terminatedWithTempsId.length === 0) {
                // Afficher les détails des opérations qui ont échoué
                const failedOps = terminatedOps.filter(op => !op.TempsId);

                // Si la consolidation a "ignoré" toutes les opérations (cas normal: lancement soldé/composant/absent de V_LCTC),
                // ne pas afficher un message d'erreur DEBUT/FIN trompeur.
                const skippedKeySet = new Set(
                    (lastConsolidationSkipped || []).map(s => `${s.OperatorCode}/${s.LancementCode}`)
                );
                const failedNotSkipped = failedOps.filter(op => !skippedKeySet.has(`${op.OperatorCode}/${op.LancementCode}`));
                const onlySkipped = failedOps.length > 0 && failedNotSkipped.length === 0 && (lastConsolidationErrors || []).length === 0;
                if (onlySkipped) {
                    const reasonCounts = (lastConsolidationSkipped || []).reduce((acc, s) => {
                        const r = s.reason || 'Ignoré';
                        acc[r] = (acc[r] || 0) + 1;
                        return acc;
                    }, {});
                    const reasonsText = Object.entries(reasonCounts)
                        .map(([k, v]) => `- ${k}: ${v}`)
                        .join('\n');

                    let msg = `Aucune opération terminée n'est éligible au transfert.\n\n` +
                        `${failedOps.length} opération(s) ont été ignorée(s) (normal):\n`;
                    failedOps.forEach(op => {
                        msg += `• ${op.OperatorCode || '?'}/${op.LancementCode || '?'} - ${op.OperatorName || 'Opérateur inconnu'}\n`;
                    });
                    msg += `\nRaisons d'ignorance (consolidation):\n${reasonsText || '- (non précisé)'}\n\n` +
                        `Exemples de causes normales: lancement soldé (LancementSolde <> 'N'), composant (TypeRubrique <> 'O'), ou lancement absent de V_LCTC.`;

                    alert(msg);
                    this.notificationManager.warning(
                        `${failedOps.length} opération(s) ignorée(s) (normal). Voir l'alerte pour les détails.`,
                        9000
                    );
                    return;
                }
                
                // Construire un message détaillé pour alert() (qui gère mieux les multi-lignes)
                let errorDetails = 'Aucune opération terminée n\'a un TempsId valide après consolidation.\n\n';
                
                if (failedOps.length > 0) {
                    errorDetails += `Opérations en échec (${failedOps.length}):\n`;
                    failedOps.forEach(op => {
                        errorDetails += `• ${op.OperatorCode || '?'}/${op.LancementCode || '?'} - ${op.OperatorName || 'Opérateur inconnu'}\n`;
                    });
                    errorDetails += '\n';
                }
                
                errorDetails += 'Causes possibles:\n';
                errorDetails += '• Événements DEBUT ou FIN manquants dans ABHISTORIQUE_OPERATEURS\n';
                errorDetails += '• Heures incohérentes (fin < début)\n';
                errorDetails += '• Données invalides dans la base de données\n\n';
                errorDetails += 'Vérifiez les logs backend pour plus de détails.';
                
                console.error('❌ Aucune opération consolidée:', {
                    totalTerminated: terminatedOps.length,
                    failedOps: failedOps.map(op => ({
                        OperatorCode: op.OperatorCode,
                        LancementCode: op.LancementCode,
                        Status: op.Status,
                        StatusCode: op.StatusCode,
                        TempsId: op.TempsId,
                        EventId: op.EventId
                    }))
                });
                
                // Utiliser alert() pour afficher le message complet (meilleur pour les multi-lignes)
                alert(errorDetails);
                
                // Aussi afficher une notification courte
                this.notificationManager.error(
                    `${failedOps.length} opération(s) n'ont pas pu être consolidée(s). Voir la console pour les détails.`,
                    10000
                );
                return;
            }

            console.log(
                `✅ Opérations éligibles au transfert (avec TempsId): ${terminatedWithTempsId.length} ` +
                `sur ${terminatedOps.length} opérations terminées`
            );

            // 4) Demander si on transfère tout ou si on passe par la sélection
            const message = `Transférer ${terminatedWithTempsId.length} opération(s) TERMINÉE(S) ?\n\nOK = tout transférer\nAnnuler = choisir les lancements`;
            const transferAll = confirm(message);
            
            if (transferAll) {
                // Transférer toutes les opérations terminées AVEC TempsId
                const ids = terminatedWithTempsId
                    .map(op => op.TempsId)
                    .filter(id => !!id);

                if (ids.length === 0) {
                    this.notificationManager.error('Aucune opération n\'a pu être consolidée pour le transfert');
                    return;
                }
                
                const triggerEdiJob = confirm('Déclencher EDI_JOB après transfert ?');
                const result = await this.apiService.validateAndTransmitMonitoringBatch(ids, { triggerEdiJob });
                if (result?.success) {
                    this.notificationManager.success(`Transfert terminé: ${result.count || ids.length} opération(s) transférée(s)`);
                    // Recharger les données pour mettre à jour l'affichage (les opérations transmises seront masquées)
                    await this.loadData(false); // Désactiver autoConsolidate après transfert
                    // S'assurer que le filtre de statut n'est pas sur "Transmis" pour masquer les opérations transférées
                    const statusFilter = document.getElementById('statusFilter');
                    if (statusFilter && statusFilter.value === 'T') {
                        statusFilter.value = ''; // Réinitialiser le filtre pour masquer les transmises
                    }
                    // Mettre à jour le tableau pour refléter les changements
                    this.updateOperationsTable();
                } else {
                    this.notificationManager.error(result?.error || 'Erreur lors du transfert');
                }
            } else {
                // Ouvrir la modale pour sélectionner les lancements
                this.openTransferModal(terminatedWithTempsId);
            }
        } catch (error) {
            console.error('Erreur lors du transfert:', error);
            this.notificationManager.error('Erreur de connexion lors du transfert');
        } finally {
            this._isTransferring = false;
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
        // Réinitialiser le flag de transfert si la modale est fermée sans transférer
        // (le flag sera réinitialisé dans le finally de handleTransfer si le transfert a été fait)
        if (this._isTransferring) {
            console.log('⚠️ Modale fermée sans transfert, réinitialisation du flag');
            this._isTransferring = false;
        }
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
        
        try {
        const triggerEdiJob = confirm('Déclencher EDI_JOB après transfert ?');
        const result = await this.apiService.validateAndTransmitMonitoringBatch(ids, { triggerEdiJob });
        if (result?.success) {
                this.notificationManager.success(`Transfert terminé: ${result.count || ids.length} opération(s) transférée(s)`);
            this.hideTransferModal();
                await this.loadData(false); // Désactiver autoConsolidate après transfert
        } else {
            this.notificationManager.error(result?.error || 'Erreur transfert');
            }
        } catch (error) {
            console.error('❌ Erreur lors du transfert depuis la modale:', error);
            this.notificationManager.error('Erreur de connexion lors du transfert');
        }
    }

    async deleteOperation(id) {
        // Supprimer une opération non consolidée (depuis ABHISTORIQUE_OPERATEURS)
        if (!confirm('Supprimer cette opération ? Tous les événements associés seront supprimés.')) return;
        
        try {
            const result = await this.apiService.deleteOperation(id);
            if (result && result.success) {
                this.notificationManager.success('Opération supprimée avec succès');
                await this.loadData();
            } else {
                this.notificationManager.error(result?.error || 'Erreur lors de la suppression');
            }
        } catch (error) {
            console.error('❌ Erreur suppression opération:', error);
            this.notificationManager.error('Erreur lors de la suppression');
        }
    }

    async deleteMonitoringRecord(id) {
        // Supprimer un enregistrement consolidé (depuis ABTEMPS_OPERATEURS)
        // Convertir l'ID en nombre pour éviter les problèmes de type
        const tempsId = parseInt(id, 10);
        if (isNaN(tempsId)) {
            console.error('❌ ID invalide:', id);
            this.notificationManager.error('ID d\'enregistrement invalide');
            return;
        }

        if (!confirm('Supprimer cet enregistrement de temps ?')) return;
        
        try {
            const result = await this.apiService.deleteMonitoringTemps(tempsId);
            if (result && result.success) {
                this.notificationManager.success('Enregistrement supprimé');
                this.selectedTempsIds.delete(String(id));
                await this.loadData();
            } else {
                // Si l'enregistrement n'existe pas, rafraîchir les données (peut-être déjà supprimé)
                if (result?.error && result.error.includes('non trouvé')) {
                    this.notificationManager.warning('Cet enregistrement n\'existe plus (peut-être déjà supprimé). Actualisation...');
                    await this.loadData();
                } else {
                    this.notificationManager.error(result?.error || 'Erreur lors de la suppression');
                }
            }
        } catch (error) {
            console.error('❌ Erreur suppression monitoring:', error);
            // Si c'est une erreur 404, l'enregistrement n'existe probablement plus
            if (error.message && error.message.includes('non trouvé')) {
                this.notificationManager.warning('Cet enregistrement n\'existe plus. Actualisation...');
                await this.loadData();
            } else {
                this.notificationManager.error('Erreur lors de la suppression');
            }
        }
    }

    async editMonitoringRecord(id) {
        // Convertir l'ID en nombre pour éviter les problèmes de type
        const tempsId = parseInt(id, 10);
        if (isNaN(tempsId)) {
            console.error('❌ ID invalide:', id);
            this.notificationManager.error('ID d\'enregistrement invalide');
            return;
        }

        // Trouver l'enregistrement actuel pour pré-remplir les prompts
        const record = this.operations.find(op => op.TempsId == tempsId);
        
        if (!record) {
            console.warn(`⚠️ Enregistrement avec TempsId ${tempsId} non trouvé dans les données locales. Actualisation...`);
            this.notificationManager.warning('Enregistrement non trouvé. Actualisation des données...');
            await this.loadData();
            return;
        }

        // Si l'enregistrement est non consolidé, utiliser editOperation à la place
        if (record._isUnconsolidated) {
            console.log('⚠️ Enregistrement non consolidé, redirection vers editOperation');
            await this.editOperation(id);
            return;
        }

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
            const result = await this.apiService.correctMonitoringTemps(tempsId, corrections);
            if (result && result.success) {
                this.notificationManager.success('Enregistrement corrigé');
                
                // Mettre à jour l'enregistrement en mémoire immédiatement
                if (record) {
                    if (corrections.Phase !== undefined) record.Phase = corrections.Phase;
                    if (corrections.CodeRubrique !== undefined) record.CodeRubrique = corrections.CodeRubrique;
                    if (corrections.StartTime !== undefined) record.StartTime = corrections.StartTime;
                    if (corrections.EndTime !== undefined) record.EndTime = corrections.EndTime;
                    
                    // Mettre à jour la ligne dans le tableau sans tout recharger
                    this.updateMonitoringRowInTable(tempsId, record);
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
            
            // Si c'est une erreur 404 (enregistrement non trouvé), rafraîchir les données
            if (error.message && error.message.includes('non trouvé')) {
                this.notificationManager.warning('Cet enregistrement n\'existe plus (peut-être déjà supprimé). Actualisation...');
                await this.loadData();
            } else {
                this.notificationManager.error(`Erreur lors de la correction: ${error.message || 'Erreur inconnue'}`);
            }
        }
    }

    /**
     * Valide une opération avant édition
     * @param {Object} operation - Opération à valider
     * @returns {Object} { valid: boolean, errors: Array, warnings: Array }
     */
    validateOperationBeforeEdit(operation) {
        const errors = [];
        const warnings = [];
        
        if (!operation) {
            return { valid: false, errors: ['Opération non trouvée'], warnings: [] };
        }
        
        // Vérifier les heures
        const startTime = operation.startTime || operation.StartTime;
        const endTime = operation.endTime || operation.EndTime;
        
        if (startTime && endTime) {
            const start = this.parseTime(startTime);
            const end = this.parseTime(endTime);
            
            if (start && end && end <= start) {
                warnings.push('Heure de fin antérieure ou égale à l\'heure de début (peut être valide si traverse minuit)');
            }
        }
        
        // Vérifier les durées pour les opérations consolidées
        if (operation.TempsId && !operation._isUnconsolidated) {
            const totalDuration = operation.TotalDuration || 0;
            const pauseDuration = operation.PauseDuration || 0;
            const productiveDuration = operation.ProductiveDuration || 0;
            const calculatedProductive = totalDuration - pauseDuration;
            
            if (Math.abs(productiveDuration - calculatedProductive) > 1) {
                warnings.push(`Incohérence des durées: TotalDuration (${totalDuration}) - PauseDuration (${pauseDuration}) = ${calculatedProductive}, mais ProductiveDuration = ${productiveDuration}`);
            }
            
            if (totalDuration < 0 || pauseDuration < 0 || productiveDuration < 0) {
                errors.push('Durées négatives détectées');
            }
        }
        
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
    
    /**
     * Affiche les problèmes détectés pour une opération
     * @param {Object} operation - Opération à vérifier
     * @param {HTMLElement} row - Ligne du tableau
     */
    showOperationIssues(operation, row) {
        // Supprimer les anciens badges d'avertissement
        const existingBadge = row.querySelector('.operation-issue-badge');
        if (existingBadge) {
            existingBadge.remove();
        }
        
        const validation = this.validateOperationBeforeEdit(operation);
        
        if (!validation.valid || validation.warnings.length > 0) {
            // Créer un badge d'avertissement
            const badge = document.createElement('span');
            badge.className = 'operation-issue-badge badge badge-warning';
            badge.style.cssText = 'margin-left: 5px; cursor: pointer;';
            badge.title = [...validation.errors, ...validation.warnings].join('\n');
            badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
            
            badge.addEventListener('click', () => {
                const message = [
                    'Problèmes détectés:',
                    ...validation.errors.map(e => `❌ ${e}`),
                    ...validation.warnings.map(w => `⚠️ ${w}`)
                ].join('\n');
                alert(message);
            });
            
            // Ajouter le badge dans la cellule statut ou actions
            const statusCell = row.querySelector('td:nth-child(6)'); // Colonne statut
            if (statusCell) {
                statusCell.appendChild(badge);
            }
        }
    }
    
    /**
     * Parse un format d'heure (HH:mm ou HH:mm:ss)
     * @param {string} timeString - Chaîne d'heure
     * @returns {number|null} Minutes depuis minuit ou null si invalide
     */
    parseTime(timeString) {
        if (!timeString) return null;
        
        const timeStr = String(timeString).trim();
        const parts = timeStr.split(':');
        
        if (parts.length < 2) return null;
        
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        
        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return null;
        }
        
        return hours * 60 + minutes;
    }

    async editOperation(id) {
        // Éditer une opération non consolidée (ABHISTORIQUE_OPERATEURS) avec des popups (prompts)
        // id = EventId (NoEnreg)
        console.log('✏️ Édition (popup) opération non consolidée, EventId:', id);
        
        const record = this.operations.find(op => 
            (op.EventId && op.EventId == id) || 
            (op.id && op.id == id) ||
            (op._isUnconsolidated && (op.EventId == id || op.id == id))
        );
        
        if (!record) {
            console.warn(`⚠️ Opération avec EventId ${id} non trouvée. Actualisation...`);
            this.notificationManager.warning('Opération non trouvée. Actualisation des données...');
            await this.loadData();
            return;
        }

        // Si l'opération est en fait consolidée, rediriger vers l'édition monitoring
        if (!record._isUnconsolidated && record.TempsId) {
            console.warn(`⚠️ Opération ${id} est consolidée, redirection vers editMonitoringRecord`);
            await this.editMonitoringRecord(record.TempsId);
            return;
        }

        const eventId = record.EventId || record.id || id;

        // Préparer les valeurs actuelles pour les popups
        const currentStart = this.cleanTimeValue(record.startTime || record.StartTime || '');
        const currentEnd = this.cleanTimeValue(record.endTime || record.EndTime || '');

        const newStart = prompt(
            `Heure début (actuel: ${currentStart || 'vide'}) - format HH:mm :`,
            currentStart
        );
        if (newStart === null) {
            // Annulé par l'utilisateur
            return;
        }

        const newEnd = prompt(
            `Heure fin (actuel: ${currentEnd || 'vide'}) - format HH:mm :`,
            currentEnd
        );
        if (newEnd === null) {
            // Annulé par l'utilisateur
            return;
        }

        const updateData = {};
        if (newStart && newStart !== currentStart) updateData.startTime = newStart;
        if (newEnd && newEnd !== currentEnd) updateData.endTime = newEnd;

        if (Object.keys(updateData).length === 0) {
            this.notificationManager.info('Aucune modification effectuée');
            return;
        }

        try {
            const result = await this.apiService.updateOperation(eventId, updateData);
            if (result && result.success) {
                this.notificationManager.success('Opération modifiée avec succès');
                await this.loadData();
            } else {
                this.notificationManager.error(result?.error || 'Erreur lors de la modification');
            }
        } catch (error) {
            console.error('❌ Erreur lors de la modification de l’opération:', error);
            this.notificationManager.error('Erreur lors de la modification');
        }
    }
    
    // Fonction d'édition inline (non-async car manipulation DOM directe)
    editOperationInline(id) {
        console.log('🔧 Édition inline de l\'opération:', id, 'Type:', typeof id);
        
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
            this.notificationManager.warning(`Ligne non trouvée pour l'opération ${id}. Rechargement du tableau...`);
            this.loadData();
            return;
        }
        
        // Trouver l'opération dans les données
        const operation = this.operations.find(op => {
            const match = op.id == id || op.id == numericId || 
                         op.EventId == id || op.EventId == numericId ||
                         op.TempsId == id || op.TempsId == numericId ||
                         String(op.id) === String(id) || String(op.id) === String(numericId) ||
                         String(op.EventId) === String(id) || String(op.EventId) === String(numericId);
            return match;
        });
        
        if (!operation) {
            console.error('❌ Opération non trouvée pour l\'ID:', id);
            this.notificationManager.warning(`Opération ${id} non trouvée dans les données. Rechargement...`);
            this.loadData();
            return;
        }
        
        // Sauvegarder les valeurs originales
        const startTimeValue = operation.startTime || operation.StartTime || '';
        const endTimeValue = operation.endTime || operation.EndTime || '';
        const originalStartTime = this.cleanTimeValue(startTimeValue);
        const originalEndTime = this.cleanTimeValue(endTimeValue);
        
        // Remplacer les cellules par des inputs (même logique que dans l'ancienne fonction)
        const cells = row.querySelectorAll('td');
        if (cells.length >= 6) {
            // Cellule heure début (index 5)
            cells[5].innerHTML = `
                <input type="time" 
                       data-field="startTime" 
                       data-id="${id}"
                       data-original="${originalStartTime}"
                       value="${originalStartTime || ''}" 
                       class="time-input form-control" 
                       style="width: 100%; padding: 4px;">
            `;
            
            // Cellule heure fin (index 6)
            cells[6].innerHTML = `
                <input type="time" 
                       data-field="endTime" 
                       data-id="${id}"
                       data-original="${originalEndTime}"
                       value="${originalEndTime || ''}" 
                       class="time-input form-control" 
                       style="width: 100%; padding: 4px;"
                       onchange="window.adminPage.validateTimeInput(this)">
            `;
            
            // Cellule actions (index 8) - remplacer par boutons sauvegarder/annuler
            cells[8].innerHTML = `
                <button class="btn btn-sm btn-success" onclick="window.adminPage.saveOperation('${id}')" title="Sauvegarder">
                    <i class="fas fa-check"></i>
                </button>
                <button class="btn btn-sm btn-secondary" onclick="window.adminPage.cancelEdit('${id}')" title="Annuler" style="margin-left: 5px;">
                    <i class="fas fa-times"></i>
                </button>
            `;
        }
    }
    
    cancelEdit(id) {
        // Recharger les données pour annuler l'édition et restaurer l'état normal
        this.loadData();
    }

    updateMonitoringRowInTable(tempsId, record) {
        const row = document.querySelector(`tr[data-operation-id="${tempsId}"]`);
        if (!row) {
            console.warn(`⚠️ Ligne non trouvée pour TempsId ${tempsId}, rechargement complet`);
            this.updateOperationsTable();
            return;
        }

        const cells = row.querySelectorAll('td');
        if (cells.length >= 8) {
            // Mettre à jour les heures (cellules 5 et 6)
            const formattedStartTime = this.formatDateTime(record.StartTime);
            const formattedEndTime = this.formatDateTime(record.EndTime);
            
            cells[5].textContent = formattedStartTime;
            cells[6].textContent = formattedEndTime;
            
            console.log(`✅ Ligne ${tempsId} mise à jour dans le tableau:`, {
                StartTime: formattedStartTime,
                EndTime: formattedEndTime
            });
        }
    }

    formatDateTime(dateString) {
        // Si c'est null ou undefined, retourner un tiret
        if (!dateString) return '-';
        
        if (this.debugTime) {
            console.log(`🔧 formatDateTime input: "${dateString}" (type: ${typeof dateString}) and value:`, dateString);
        }
        
        // Si c'est déjà au format HH:mm, le retourner directement
        if (typeof dateString === 'string') {
            const timeMatch = dateString.match(/^(\d{1,2}):(\d{2})$/);
            if (timeMatch) {
                const hours = timeMatch[1].padStart(2, '0');
                const minutes = timeMatch[2];
                const result = `${hours}:${minutes}`;
                if (this.debugTime) console.log(`✅ formatDateTime: ${dateString} → ${result}`);
                return result;
            }
            
            // Si c'est au format HH:mm:ss, extraire HH:mm
            const timeWithSecondsMatch = dateString.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
            if (timeWithSecondsMatch) {
                const hours = timeWithSecondsMatch[1].padStart(2, '0');
                const minutes = timeWithSecondsMatch[2];
                const result = `${hours}:${minutes}`;
                if (this.debugTime) console.log(`✅ formatDateTime: ${dateString} → ${result}`);
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
            if (this.debugTime) console.log(`✅ formatDateTime: Date → ${result}`);
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
                if (this.debugTime) console.log(`✅ formatDateTime: Date string → ${result}`);
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
        
        if (this.debugTime) console.log(`🔧 formatTimeForInput: "${timeString}"`);
        
        // Si c'est déjà au format HH:mm, le retourner directement
        if (typeof timeString === 'string' && /^\d{2}:\d{2}$/.test(timeString)) {
            if (this.debugTime) console.log(`✅ Format HH:mm direct: ${timeString}`);
            return timeString;
        }
        
        // Si c'est au format HH:mm:ss, enlever les secondes
        if (typeof timeString === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(timeString)) {
            const result = timeString.substring(0, 5);
            if (this.debugTime) console.log(`✅ Format HH:mm:ss → HH:mm: ${timeString} → ${result}`);
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
                    if (this.debugTime) console.log(`✅ Date complète → HH:mm: ${timeString} → ${formattedTime}`);
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
            if (this.debugTime) console.log(`✅ Date object → HH:mm: ${timeString} → ${formattedTime}`);
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

    // Fonction wrapper pour les appels inline (onchange)
    validateTimeInput(inputElement) {
        const row = inputElement.closest('tr');
        if (!row) return;
        
        const operationId = row.dataset.id || row.dataset.tempsId || row.dataset.eventId;
        this.validateTimeInputs(row, operationId);
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
            
            // Si aucune valeur n'a changé, ne pas envoyer de requête mais restaurer l'état normal
            if (!startTimeChanged && !endTimeChanged && !statusChanged) {
                console.log(`ℹ️ Aucune modification détectée pour l'opération ${id}`);
                this.notificationManager.info('Aucune modification détectée');
                // Recharger les données pour restaurer l'état normal (sortir du mode édition)
                await this.loadData();
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
            // Utiliser la ligne déjà trouvée (row déclarée plus haut)
            const tempsIdFromRow = row?.dataset?.tempsId ? parseInt(row.dataset.tempsId, 10) : null;
            const eventIdFromRow = row?.dataset?.eventId || null;
            const isUnconsolidatedFromRow = row?.dataset?.unconsolidated === 'true';
            
            // Trouver l'enregistrement dans la liste
            const record = this.operations.find(op => {
                if (tempsIdFromRow && op.TempsId == tempsIdFromRow) return true;
                if (eventIdFromRow && (op.EventId == eventIdFromRow || op.id == eventIdFromRow)) return true;
                if (op.TempsId == id || op.EventId == id || op.id == id) return true;
                return false;
            });
            
            const isMonitoringRecord = record && record.TempsId && !record._isUnconsolidated;
            
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
                // C'est un enregistrement historique (non consolidé) - utiliser la route operations
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
                
                // Recharger complètement les données pour restaurer l'état normal (sortir du mode édition)
                await this.loadData();
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
        
        // Chercher l'opération par id ou TempsId (pour les opérations non consolidées)
        const operation = this.operations.find(op => op.id == operationId || op.TempsId == operationId);
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
        if (cells.length >= 8) {
            // Cellule heure début (index 5) - utiliser startTime ou StartTime
            const startTimeValue = operation.startTime || operation.StartTime;
            const formattedStartTime = this.formatDateTime(startTimeValue);
            cells[5].innerHTML = formattedStartTime;
            
            // Cellule heure fin (index 6) - utiliser endTime ou EndTime
            const endTimeValue = operation.endTime || operation.EndTime;
            const formattedEndTime = this.formatDateTime(endTimeValue);
            cells[6].innerHTML = formattedEndTime;
            
            // Cellule statut (index 7)
            // Utiliser le statut de l'opération, mais ne pas utiliser 'EN_COURS' par défaut si le statut est explicitement défini
            let statusCode = operation.statusCode || operation.StatusCode;
            let statusLabel = operation.status || operation.Status;
            
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
            
            cells[7].innerHTML = `<span class="status-badge status-${statusCode}">${statusLabel}</span>`;
            
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
        const displayedStartTime = cells[5] ? cells[5].textContent : 'N/A';
        const displayedEndTime = cells[6] ? cells[6].textContent : 'N/A';
        
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
