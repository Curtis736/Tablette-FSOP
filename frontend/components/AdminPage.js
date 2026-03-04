// Page d'administration - v20251014-fixed-v4-refactored
import TimeUtils from '../utils/TimeUtils.js';
import Logger from '../utils/Logger.js';
import DOMCache from '../utils/DOMCache.js';
import ErrorHandler from '../utils/ErrorHandler.js';
import Validator from '../utils/Validator.js';
import LoadingIndicator from '../utils/LoadingIndicator.js';
import { debounce } from '../utils/debounce.js';
import { createElement, createTableCell, createButton, createBadge, clearElement } from '../utils/DOMHelper.js';
import { ADMIN_CONFIG, STATUS_CODES, STATUS_LABELS } from '../utils/Constants.js';

class AdminPage {
    constructor(app) {
        this.app = app;
        this.apiService = app.getApiService();
        this.notificationManager = app.getNotificationManager();
        
        // Initialiser les utilitaires
        this.logger = new Logger();
        this.domCache = new DOMCache();
        this.errorHandler = new ErrorHandler(this.notificationManager, this.logger);
        this.validator = new Validator();
        this.loadingIndicator = new LoadingIndicator();
        
        // Données
        this.operations = [];
        this.stats = {};
        this.pagination = null;
        this.currentPage = 1;
        this.transferSelectionIds = new Set(); // sélection dans la modale de transfert (TempsId)
        this.selectedTempsIds = new Set(); // sélection de lignes dans le tableau principal (TempsId)
        
        // Flags pour éviter les appels simultanés
        this._isTransferring = false;
        this._isConsolidating = false;
        this.isLoading = false;
        
        // Système de sauvegarde automatique
        this.autoSaveEnabled = true;
        this.autoSaveInterval = ADMIN_CONFIG.AUTO_SAVE_INTERVAL;
        this.pendingChanges = new Map(); // Map des modifications en attente
        this.autoSaveTimer = null;
        
        // Gestion des erreurs et refresh
        this.lastEditTime = 0;
        this.consecutiveErrors = 0;
        this.maxConsecutiveErrors = ADMIN_CONFIG.MAX_CONSECUTIVE_ERRORS;
        this.refreshInterval = null;
        this.operatorsInterval = null;
        this.lastOperatorsUpdate = 0;
        this.timeoutId = null;
        
        // Cache des opérateurs
        this._allOperatorsCache = [];
        this._allOperatorsCacheAt = 0;
        
        // Initialisation immédiate (le DOM devrait être prêt maintenant)
        this.initializeElements();
        this.setupEventListeners();
        this.startAutoSave();
    }

    initializeElements() {
        // Initialiser le cache DOM
        this.domCache.initialize();
        
        // Mapper les éléments du cache vers les propriétés de la classe
        const elementMap = {
            refreshDataBtn: 'refreshDataBtn',
            totalOperators: 'totalOperators',
            activeLancements: 'activeLancements',
            pausedLancements: 'pausedLancements',
            completedLancements: 'completedLancements',
            operationsTableBody: 'operationsTableBody',
            operatorSelect: 'operatorFilter',
            transferSelectionModal: 'transferSelectionModal',
            transferModalTableBody: 'transferModalTableBody',
            closeTransferModalBtn: 'closeTransferModalBtn',
            transferSelectedConfirmBtn: 'transferSelectedConfirmBtn',
            transferSelectAll: 'transferSelectAll'
        };
        
        // Initialiser les éléments avec vérification
        Object.keys(elementMap).forEach(key => {
            const elementId = elementMap[key];
            this[key] = this.domCache.get(elementId);
            
            if (!this[key]) {
                this.logger.warn(`⚠️ Élément non trouvé: ${elementId}`);
                // Créer un élément de fallback pour éviter les erreurs
                if (key === 'operationsTableBody') {
                    this[key] = createElement('tbody', { id: elementId });
                    this.domCache.set(elementId, this[key]);
                }
            }
        });
    }

    addEventListenerSafe(elementId, eventType, handler) {
        try {
            const element = this.domCache.get(elementId);
            if (element && typeof element.addEventListener === 'function') {
                element.addEventListener(eventType, handler);
                this.logger.log(`Listener ajouté: ${elementId} (${eventType})`);
            } else {
                this.logger.warn(`Élément non trouvé ou invalide: ${elementId}`);
            }
        } catch (error) {
            this.errorHandler.handle(error, 'addEventListenerSafe', `Erreur lors de l'ajout du listener ${elementId}`);
        }
    }

    setupEventListeners() {
        // Attendre un peu que le DOM soit complètement prêt
        setTimeout(() => {
            try {
                // Bouton Actualiser
                const refreshBtn = this.domCache.get('refreshDataBtn');
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', () => {
                        this.resetConsecutiveErrors();
                        this.loadData();
                    });
                }

                // Modale transfert
                const closeTransferModalBtn = this.domCache.get('closeTransferModalBtn');
                if (closeTransferModalBtn) {
                    closeTransferModalBtn.addEventListener('click', () => this.hideTransferModal());
                }

                const transferSelectedConfirmBtn = this.domCache.get('transferSelectedConfirmBtn');
                if (transferSelectedConfirmBtn) {
                    transferSelectedConfirmBtn.addEventListener('click', () => this.confirmTransferFromModal());
                }

                const transferSelectAll = this.domCache.get('transferSelectAll');
                if (transferSelectAll) {
                    transferSelectAll.addEventListener('change', () => this.toggleTransferSelectAll(transferSelectAll.checked));
                }
                
                // Menu déroulant opérateurs
                const operatorSelect = this.domCache.get('operatorFilter');
                if (operatorSelect) {
                    operatorSelect.addEventListener('change', () => this.handleOperatorChange());
                }
                
                // Filtre de statut
                const statusFilter = this.domCache.get('statusFilter');
                if (statusFilter) {
                    statusFilter.addEventListener('change', () => {
                        // Statut opération: filtrage local
                        this.updateOperationsTable();
                        this.updateStats();
                    });
                }


                // Filtre de période
                const periodFilter = this.domCache.get('periodFilter');
                if (periodFilter) {
                    periodFilter.addEventListener('change', () => {
                        this.loadData();
                    });
                }
                
                // Filtre de recherche avec debounce
                const searchFilter = this.domCache.get('searchFilter');
                if (searchFilter) {
                    const debouncedLoadData = debounce(() => {
                        // Recharger depuis le backend car le filtre lancement peut être appliqué côté API
                        this.loadData();
                    }, ADMIN_CONFIG.SEARCH_DEBOUNCE_DELAY);
                    searchFilter.addEventListener('input', debouncedLoadData);
                }
                
                // Bouton effacer filtres
                const clearFiltersBtn = this.domCache.get('clearFiltersBtn');
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
                   const transferBtn = this.domCache.get('transferBtn');
                   if (transferBtn) {
                       transferBtn.addEventListener('click', () => this.handleTransfer());
                   }
                   
                   // Bouton Ajouter une ligne
                   const addOperationBtn = this.domCache.get('addOperationBtn');
                   if (addOperationBtn) {
                       addOperationBtn.addEventListener('click', () => this.handleAddOperation());
                   }
                
                // Tableau des opérations
                const tableBody = this.domCache.get('operationsTableBody');
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
                                this.errorHandler.handle(
                                    new Error('ID manquant sur le bouton'),
                                    'setupEventListeners',
                                    'Erreur: ID manquant sur le bouton d\'édition'
                                );
                                return;
                            }
                            
                            try {
                                if (isUnconsolidated) {
                                    await this.editOperation(eventId || id);
                                } else {
                                    await this.editMonitoringRecord(tempsId || id);
                                }
                            } catch (error) {
                                this.errorHandler.handle(error, 'setupEventListeners', 'Erreur lors de l\'édition');
                            }
                        }
                    });
                }
                
            } catch (error) {
                this.errorHandler.handle(error, 'setupEventListeners', 'Erreur lors de l\'ajout des listeners');
            }
        }, 300);
        
        // Actualisation automatique avec retry en cas d'erreur
        this.refreshInterval = setInterval(() => {
            // Ne pas recharger si trop d'erreurs consécutives
            if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                this.logger.log(`⏸️ Refresh automatique désactivé (${this.consecutiveErrors} erreurs consécutives)`);
                return;
            }
            
            // Ne pas recharger si une édition vient d'être effectuée (dans les 5 dernières secondes)
            const timeSinceLastEdit = Date.now() - this.lastEditTime;
            if (!this.isLoading && timeSinceLastEdit > ADMIN_CONFIG.EDIT_COOLDOWN) {
                this.loadDataWithRetry();
            } else if (timeSinceLastEdit <= ADMIN_CONFIG.EDIT_COOLDOWN) {
                this.logger.log(`⏸️ Rechargement automatique ignoré (édition récente il y a ${Math.round(timeSinceLastEdit/1000)}s)`);
            }
        }, ADMIN_CONFIG.REFRESH_INTERVAL);

        // Mise à jour temps réel des opérateurs connectés
        this.operatorsInterval = setInterval(() => {
            // Ne pas mettre à jour si trop d'erreurs
            if (this.consecutiveErrors < this.maxConsecutiveErrors) {
                if (this.isLoading) {
                    // Éviter d'empiler des requêtes pendant un loadData en cours
                    return;
                }
                // Vérifier si on a des données récentes pour éviter les requêtes redondantes
                const timeSinceLastUpdate = Date.now() - this.lastOperatorsUpdate;
                if (timeSinceLastUpdate < ADMIN_CONFIG.MIN_UPDATE_INTERVAL) {
                    this.logger.log(`⏸️ Mise à jour opérateurs ignorée (données récentes il y a ${Math.round(timeSinceLastUpdate/1000)}s)`);
                    return;
                }
                this.updateOperatorsStatus();
            }
        }, ADMIN_CONFIG.OPERATORS_UPDATE_INTERVAL);

    }

    async loadData(enableAutoConsolidate = true) {
        if (this.isLoading) {
            this.logger.log('Chargement déjà en cours, ignorer...');
            return;
        }
        
        try {
            this.isLoading = true;
            
            // Charger les opérateurs connectés et les données admin en parallèle avec timeout
            // Appliquer la période sélectionnée pour la partie monitoring (ABTEMPS_OPERATEURS)
            const now = new Date();
            // IMPORTANT: utiliser une date LOCALE (pas UTC) pour correspondre à CAST(DateCreation AS DATE) côté SQL.
            // toISOString() utilise UTC et peut décaler d'un jour (dashboard vide alors que l'opérateur voit des opérations).
            const toLocalDateOnly = (d) => {
                const x = new Date(d);
                const y = x.getFullYear();
                const m = String(x.getMonth() + 1).padStart(2, '0');
                const day = String(x.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            };
            const today = toLocalDateOnly(now);
            const periodFilter = this.domCache.get('periodFilter');
            const period = periodFilter?.value || 'today';

            const toDateOnly = toLocalDateOnly;
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
            
            // Créer une promesse avec timeout (⚠️ toujours clearTimeout sinon rejection non gérée plus tard)
            this.timeoutId = null;
            const timeoutPromise = new Promise((_, reject) => {
                this.timeoutId = setTimeout(() => reject(new Error('Timeout: La requête a pris trop de temps')), ADMIN_CONFIG.TIMEOUT_DURATION);
            });
            // Important: attacher un handler immédiatement pour éviter les "Unhandled Rejection"
            // même si le timeout se déclenche après coup (ou dans des environnements de test).
            const timeoutPromiseHandled = timeoutPromise.catch((e) => { throw e; });
            
            // Charger le minimum en parallèle (⚡ éviter de bloquer loadData sur /operators/all qui peut être lent)
            const dataPromises = Promise.all([
                this.apiService.getAdminData(today),
                this.apiService.getConnectedOperators()
            ]);
            
            let adminData, operatorsData;
            try {
                [adminData, operatorsData] = await Promise.race([
                    dataPromises,
                    timeoutPromiseHandled
                ]);
            } finally {
                if (this.timeoutId) {
                    clearTimeout(this.timeoutId);
                    this.timeoutId = null;
                }
            }
            
            // Les données sont déjà parsées par ApiService
            const data = adminData;
            
            // Charger les opérations consolidées depuis ABTEMPS_OPERATEURS
            const operatorFilter = this.domCache.get('operatorFilter');
            const searchFilter = this.domCache.get('searchFilter');
            const operatorCode = operatorFilter?.value || undefined;
            const lancementCode = searchFilter?.value?.trim() || undefined;

            const filters = { ...periodRange };
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
            
            // D'abord ajouter les opérations de monitoring (consolidées)
            consolidatedOps.forEach(op => {
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
            
            // Consolidation automatique des opérations terminées sans TempsId (éviter les "lancement non consolidé")
            if (enableAutoConsolidate && !this._isConsolidating) {
                const terminatedWithoutTempsId = this.operations.filter(op =>
                    this.isOperationTerminated(op) && !op.TempsId && (op._isUnconsolidated === true || op.OperatorCode)
                );
                if (terminatedWithoutTempsId.length > 0) {
                    this._isConsolidating = true;
                    const seen = new Set();
                    const toConsolidate = terminatedWithoutTempsId
                        .map(op => ({ OperatorCode: op.OperatorCode, LancementCode: op.LancementCode }))
                        .filter(({ OperatorCode, LancementCode }) => {
                            const key = `${OperatorCode}|${LancementCode}`;
                            if (seen.has(key)) return false;
                            seen.add(key);
                            return true;
                        });
                    this.apiService.consolidateMonitoringBatch(toConsolidate)
                        .then(async (consolidateResult) => {
                            const ok = consolidateResult?.results?.success || [];
                            if (ok.length > 0) {
                                this.logger.log(`Consolidation auto: ${ok.length} opération(s) consolidée(s)`);
                                await this.loadData(false);
                            }
                        })
                        .catch((err) => {
                            this.logger.warn('Consolidation auto (arrière-plan) échouée:', err?.message || err);
                        })
                        .finally(() => {
                            this._isConsolidating = false;
                        });
                }
            }
            
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
            // Utiliser une cache locale pour la liste complète (évite de re-télécharger pendant les refresh)
            const cachedAll = this._allOperatorsCache || [];
            if (connectedOps.length > 0 || cachedAll.length > 0) {
                this.updateOperatorSelect(connectedOps, cachedAll);
                this.lastOperatorsUpdate = Date.now();
            }

            // Charger "tous les opérateurs" en arrière-plan (rarement), sans bloquer loadData
            const allCacheAge = Date.now() - (this._allOperatorsCacheAt || 0);
            const shouldRefreshAll = !this._allOperatorsCacheAt || allCacheAge > 10 * 60 * 1000; // 10 minutes
            if (shouldRefreshAll) {
                this.apiService.getAllOperators()
                    .then((allOperatorsData) => {
                        const allOps = allOperatorsData && (allOperatorsData.success ? allOperatorsData.operators : allOperatorsData.operators) || [];
                        this._allOperatorsCache = allOps;
                        this._allOperatorsCacheAt = Date.now();
                        if (connectedOps.length > 0 || allOps.length > 0) {
                            this.updateOperatorSelect(connectedOps, allOps);
                            this.lastOperatorsUpdate = Date.now();
                        }
                    })
                    .catch((e) => {
                        this.logger.warn('⚠️ Impossible de charger la liste globale des opérateurs (non bloquant):', e?.message || e);
                    });
            }
            
            // Mettre à jour l'affichage des opérateurs connectés (toujours, même si vide)
            this.updateActiveOperatorsDisplay(connectedOps);
            
            this.updateStats();
            this.updateOperationsTable();
            this.updatePaginationInfo();
        } catch (error) {
            // Masquer l'indicateur de chargement en cas d'erreur
            this.loadingIndicator.hide('loadData');
            const isRateLimitError = this.errorHandler.isRateLimitError(error);
            
            if (isRateLimitError) {
                // Pour les erreurs 429, augmenter significativement le compteur d'erreurs
                this.consecutiveErrors += 3; // Équivalent à 3 erreurs normales
                
                // Augmenter l'intervalle de refresh temporairement
                if (this.refreshInterval) {
                    clearInterval(this.refreshInterval);
                    this.refreshInterval = setInterval(() => {
                        if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                            this.logger.log(`⏸️ Refresh automatique désactivé (${this.consecutiveErrors} erreurs consécutives)`);
                            return;
                        }
                        const timeSinceLastEdit = Date.now() - this.lastEditTime;
                        if (!this.isLoading && timeSinceLastEdit > ADMIN_CONFIG.EDIT_COOLDOWN) {
                            this.loadDataWithRetry();
                        }
                    }, ADMIN_CONFIG.OPERATORS_UPDATE_INTERVAL);
                }
                
                // Afficher un message spécifique pour le rate limiting
                if (this.consecutiveErrors <= 3) {
                    this.notificationManager.warning('Trop de requêtes. Le rafraîchissement automatique est ralenti. Veuillez patienter...');
                }
            } else {
                // Pour les autres erreurs, incrémenter normalement
                this.consecutiveErrors++;
                
                // Ne pas spammer les notifications si trop d'erreurs
                if (this.consecutiveErrors <= 2) {
                    this.errorHandler.handle(error, 'loadData');
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
            // Masquer l'indicateur de chargement
            this.loadingIndicator.hide('loadData');
        }
    }

    async loadDataWithRetry(maxRetries = 1) {
        // Réduire les tentatives pour éviter les boucles infinies
        // Le setInterval se chargera de réessayer plus tard
        try {
            this._isAutoRefresh = true; // Marquer comme auto-refresh pour ne pas afficher le loader
            await this.loadData();
        } catch (error) {
            this.logger.warn(`Échec du chargement:`, error.message);
            // Ne pas réessayer immédiatement, laisser le setInterval gérer
            // Cela évite les boucles infinies
        } finally {
            this._isAutoRefresh = false;
        }
    }
    
    // Méthode pour réactiver le refresh automatique
    resetConsecutiveErrors() {
        this.consecutiveErrors = 0;
        
        // Réinitialiser l'intervalle de refresh
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = setInterval(() => {
                if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                    this.logger.log(`⏸️ Refresh automatique désactivé (${this.consecutiveErrors} erreurs consécutives)`);
                    return;
                }
                const timeSinceLastEdit = Date.now() - this.lastEditTime;
                if (!this.isLoading && timeSinceLastEdit > ADMIN_CONFIG.EDIT_COOLDOWN) {
                    this.loadDataWithRetry();
                }
            }, ADMIN_CONFIG.REFRESH_INTERVAL);
        }
        
        this.logger.log('✅ Compteur d\'erreurs réinitialisé, refresh automatique réactivé');
    }
    
    /**
     * Nettoie tous les timers et ressources
     * À appeler lors de la destruction du composant
     */
    destroy() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        if (this.operatorsInterval) {
            clearInterval(this.operatorsInterval);
            this.operatorsInterval = null;
        }
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        this.domCache.clear();
        this.logger.log('✅ AdminPage détruit, toutes les ressources nettoyées');
    }

    // ===== Monitoring (ABTEMPS_OPERATEURS) =====
    // NOTE: Cette fonction est maintenant principalement utilisée pour le rechargement après modifications
    // Le chargement principal est fait dans loadData() pour éviter les doubles appels API
    async loadMonitoringRecords(date) {
        try {
            const operatorCode = document.getElementById('operatorFilter')?.value || undefined;
            const lancementCode = document.getElementById('searchFilter')?.value?.trim() || undefined;

            const filters = { date };
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
            this.logger.error('❌ Erreur loadMonitoringRecords:', error);
            this.operations = [];
        }
    }

    updateStats(opsOverride = null) {
        // Calculer les statistiques depuis les opérations affichées dans le tableau
        // Cela garantit la cohérence entre le tableau et les statistiques
        const allOps = Array.isArray(opsOverride) ? opsOverride : (this._lastFilteredOperationsForStats || this.operations || []);

        const getOperatorCode = (op) => {
            // Best-effort selon les différentes sources (admin ops vs monitoring)
            const raw =
                op?.operatorCode ??
                op?.OperatorCode ??
                op?.CodeOperateur ??
                op?.code ??
                op?.CodeRessource ??
                '';
            return String(raw || '').trim();
        };

        const getLancementCode = (op) => {
            const raw = op?.LancementCode ?? op?.lancementCode ?? op?.CodeLancement ?? '';
            return String(raw || '').trim().toUpperCase();
        };
        
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

        // Compter les "lancements" par LT unique (sinon ça double quand plusieurs opérateurs travaillent sur le même LT)
        const activeLt = new Set(activeOps.map(getLancementCode).filter(Boolean));
        const pausedLt = new Set(pausedOps.map(getLancementCode).filter(Boolean));
        const completedLt = new Set(completedOps.map(getLancementCode).filter(Boolean));

        // Opérateurs "actifs" = ont au moins une opération EN_COURS / EN_PAUSE affichée
        const activeOperatorCodes = new Set(
            [...activeOps, ...pausedOps]
                .map(getOperatorCode)
                .filter(Boolean)
        );
        
        // totalOperators: utiliser le max(back, local) pour éviter les incohérences
        // (ex: backend pas à jour mais tableau affiche déjà plusieurs opérateurs en cours)
        const stats = {
            totalOperators: Math.max((this.stats?.totalOperators || 0), activeOperatorCodes.size),
            activeLancements: activeLt.size,
            pausedLancements: pausedLt.size,
            completedLancements: completedLt.size
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
        this.logger.log('📊 Statistiques mises à jour depuis les données du tableau:', stats);
    }

    showNoDataMessage() {
        if (!this.operationsTableBody) return;
        
        clearElement(this.operationsTableBody);
        
        const row = createElement('tr');
        const cell = createTableCell('', { colspan: '9', style: { textAlign: 'center', padding: '2rem', color: '#dc3545' } });
        
        const icon = createElement('i', { className: 'fas fa-exclamation-triangle', style: { fontSize: '2rem', marginBottom: '1rem', display: 'block' } });
        cell.appendChild(icon);
        
        const br1 = createElement('br');
        cell.appendChild(br1);
        
        const strong = createElement('strong', {}, 'Erreur de chargement des données');
        cell.appendChild(strong);
        
        const br2 = createElement('br');
        cell.appendChild(br2);
        
        const small = createElement('small', {}, 'Vérifiez la connexion au serveur et réessayez');
        cell.appendChild(small);
        
        const br3 = createElement('br');
        cell.appendChild(br3);
        
        const retryBtn = createButton({
            icon: 'fas fa-refresh',
            className: 'btn btn-sm btn-outline-primary mt-2',
            onClick: () => this.loadData()
        });
        retryBtn.appendChild(document.createTextNode(' Réessayer'));
        cell.appendChild(retryBtn);
        
        row.appendChild(cell);
        this.operationsTableBody.appendChild(row);
    }

    showRateLimitWarning() {
        this.logger.warn('⚠️ Rate limit atteint - affichage du message d\'avertissement');
        
        // Afficher un message d'erreur dans l'interface
        const errorDiv = createElement('div', { className: 'rate-limit-warning' });
        
        const innerDiv = createElement('div', {
            style: {
                background: 'linear-gradient(135deg, #ff6b6b, #ee5a52)',
                color: 'white',
                padding: '16px 20px',
                borderRadius: '12px',
                margin: '20px',
                textAlign: 'center',
                boxShadow: '0 4px 12px rgba(255, 107, 107, 0.3)',
                animation: 'slideIn 0.3s ease-out'
            }
        });
        
        const icon = createElement('i', { 
            className: 'fas fa-exclamation-triangle',
            style: { fontSize: '24px', marginBottom: '8px', display: 'block' }
        });
        innerDiv.appendChild(icon);
        
        const h3 = createElement('h3', { style: { margin: '0 0 8px 0', fontSize: '18px' } }, 'Trop de requêtes');
        innerDiv.appendChild(h3);
        
        const p = createElement('p', { style: { margin: '0', opacity: '0.9' } }, 
            'Le serveur est temporairement surchargé. Veuillez patienter quelques secondes avant de recharger.');
        innerDiv.appendChild(p);
        
        const retryBtn = createButton({
            icon: 'fas fa-refresh',
            className: '',
            onClick: () => {
                errorDiv.remove();
                this.loadData();
            }
        });
        retryBtn.style.cssText = 'background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px 16px; border-radius: 6px; margin-top: 12px; cursor: pointer; transition: all 0.2s ease;';
        retryBtn.appendChild(document.createTextNode(' Réessayer'));
        retryBtn.addEventListener('mouseover', () => retryBtn.style.background = 'rgba(255,255,255,0.3)');
        retryBtn.addEventListener('mouseout', () => retryBtn.style.background = 'rgba(255,255,255,0.2)');
        innerDiv.appendChild(retryBtn);
        
        errorDiv.appendChild(innerDiv);
        
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
        this.logger.log('🔄 Mise à jour du menu déroulant des opérateurs:', {
            connectés: connectedOperators.length,
            globaux: allOperators.length
        });
        
        // Vider le select et ajouter l'option par défaut
        clearElement(this.operatorSelect);
        const defaultOption = createElement('option', { value: '' }, 'Tous les opérateurs');
        this.operatorSelect.appendChild(defaultOption);
        
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
        
        this.logger.log('✅ Menu déroulant mis à jour avec', connectedOperators.length, 'connectés et', allOperators.length, 'globaux');
    }

    // Nouvelle méthode pour mettre à jour le statut des opérateurs
    async updateOperatorsStatus() {
        // Éviter les requêtes si on vient de recevoir une erreur 429 récemment
        const timeSinceLastUpdate = Date.now() - this.lastOperatorsUpdate;
        if (timeSinceLastUpdate < 10000) {
            this.logger.log(`⏸️ Mise à jour opérateurs ignorée (données récentes)`);
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
            this.errorHandler.handle(error, 'updateOperatorsStatus');
            // Mettre à jour l'indicateur avec un état d'erreur
            this.updateActiveOperatorsDisplay([]);
            // En cas d'erreur 429, attendre plus longtemps avant la prochaine tentative
            if (this.errorHandler.isRateLimitError(error)) {
                this.lastOperatorsUpdate = Date.now() - 5000; // Forcer une attente de 15 secondes minimum
                this.logger.log('⏸️ Rate limit détecté, attente prolongée avant la prochaine mise à jour');
            }
        }
    }

    // Afficher les opérateurs actifs
    updateActiveOperatorsDisplay(operators = []) {
        const activeOperators = operators.filter(op => op.isActive);
        
        // Mettre à jour un indicateur visuel des opérateurs actifs
        const activeIndicator = this.domCache.get('activeOperatorsIndicator');
        if (activeIndicator) {
            clearElement(activeIndicator);
            
            if (activeOperators.length > 0) {
                // Afficher les noms (max 3) + compteur
                const names = activeOperators
                    .slice(0, 3)
                    .map(op => `${op.name || op.code} (${op.code})`)
                    .join(', ');
                const more = activeOperators.length > 3 ? ` +${activeOperators.length - 3}` : '';
                const badge = createBadge(`🟢 ${names}${more}`, 'badge-success');
                activeIndicator.appendChild(badge);
            } else if (operators.length > 0) {
                // Des opérateurs sont connectés mais aucun n'est actif
                const names = operators
                    .slice(0, 3)
                    .map(op => `${op.name || op.code} (${op.code})`)
                    .join(', ');
                const more = operators.length > 3 ? ` +${operators.length - 3}` : '';
                const badge = createBadge(`🟢 Connecté(s): ${names}${more}`, 'badge-secondary');
                activeIndicator.appendChild(badge);
            } else {
                // Aucun opérateur connecté
                const badge = createBadge('Aucun opérateur connecté', 'badge-secondary');
                activeIndicator.appendChild(badge);
            }
        }
        
        // Log pour debug
        if (activeOperators.length > 0) {
            this.logger.log('🟢 Opérateurs actifs:', activeOperators.map(op => op.code).join(', '));
        }
    }

    async handleOperatorChange() {
        if (this.isLoading) {
            this.logger.log('⚠️ Chargement en cours, ignorer le changement d\'opérateur');
            return;
        }
        
        const selectedOperator = this.operatorSelect.value;
        this.logger.log('🔄 Changement d\'opérateur sélectionné:', selectedOperator);

        // En mode Monitoring, le filtre opérateur est appliqué via loadMonitoringRecords()
        if (this.selectedTempsIds && typeof this.selectedTempsIds.clear === 'function') {
        this.selectedTempsIds.clear();
        } else {
            this.selectedTempsIds = new Set();
        }
        const selectAll = this.domCache.get('selectAllRows');
        if (selectAll) selectAll.checked = false;
        await this.loadData();
    }

    async handleAddOperation() {
        try {
            // Demander les informations pour la nouvelle ligne
            const operatorCode = prompt('Code opérateur :');
            if (!operatorCode) return;
            
            // Valider le code opérateur
            if (!this.validator.validateOperatorCode(operatorCode)) {
                this.notificationManager.error('Code opérateur invalide');
                return;
            }
            
            const lancementCode = prompt('Code lancement :');
            if (!lancementCode) return;
            
            // Valider le code lancement
            if (!this.validator.validateLancementCode(lancementCode)) {
                this.notificationManager.error('Code lancement invalide');
                return;
            }
            
            // Étape (Phase + CodeRubrique) : ne demander que s'il y a plusieurs étapes
            let codeOperation = null;
            try {
                const stepsRes = await this.apiService.getLancementSteps(lancementCode);
                const steps = stepsRes?.steps || [];
                const uniqueSteps = stepsRes?.uniqueSteps || [];
                const stepCount = stepsRes?.stepCount ?? uniqueSteps.length;

                if (Array.isArray(uniqueSteps) && stepCount > 1) {
                    // Afficher une liste lisible des étapes (Phase (CodeRubrique) — Fabrication)
                    const byStepId = new Map();
                    (steps || []).forEach(s => {
                        const stepId = String(s?.StepId || '').trim();
                        if (!stepId || byStepId.has(stepId)) return;
                        byStepId.set(stepId, String(s?.Label || stepId).trim());
                    });
                    const options = Array.from(byStepId.entries()).map(([stepId, label]) => ({ stepId, label }));
                    const lines = options.map((o, idx) => `${idx + 1}) ${o.label}`);
                    const answer = window.prompt(
                        `Plusieurs étapes sont disponibles pour ${lancementCode}.\nChoisis le numéro:\n\n${lines.join('\n')}\n\nNuméro:`
                    );
                    const choiceIdx = Number.parseInt(String(answer || '').trim(), 10) - 1;
                    const chosen = options[choiceIdx]?.stepId;
                    if (!chosen) {
                        this.notificationManager.error('Aucune étape sélectionnée');
                        return;
                    }
                    codeOperation = chosen;
                } else if (Array.isArray(uniqueSteps) && uniqueSteps.length === 1) {
                    // Envoyer StepId (Phase|CodeRubrique) pour éviter les collisions quand CodeOperation est identique
                    codeOperation = uniqueSteps[0];
                }
            } catch (e) {
                // Best effort: si l'endpoint steps échoue, on laisse l'admin créer une ligne "ADMIN"
                this.logger.warn('⚠️ Impossible de récupérer les étapes (CodeOperation) pour admin:', e?.message || e);
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
            
            // Valider l'opération complète
            const validation = this.validator.validateOperation(newOperation);
            if (!validation.valid) {
                this.notificationManager.error(`Erreurs de validation:\n${validation.errors.join('\n')}`);
                return;
            }
            
            this.logger.log('Ajout d\'une nouvelle opération:', newOperation);
            
            // Afficher un indicateur de chargement
            const addBtn = this.domCache.get('addOperationBtn');
            this.loadingIndicator.show('addOperation', addBtn, 'Ajout en cours...');
            
            try {
                // Appeler l'API pour ajouter l'opération
                const result = await this.apiService.post('/admin/operations', newOperation);
            
                if (result.success) {
                    if (result.warning) {
                        this.notificationManager.warning(result.warning);
                        this.logger.warn('⚠️ Avertissement:', result.warning);
                    } else {
                        this.notificationManager.success(result.message || 'Opération ajoutée avec succès');
                    }
                    this.logger.log('Opération ajoutée:', result);
                    
                    // Attendre un peu pour que le backend ait fini de traiter
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Recharger les données pour afficher la nouvelle ligne
                    await this.loadData();
                } else {
                    const errorMessage = result.error || 'Erreur inconnue lors de l\'ajout';
                    this.notificationManager.error(`Erreur lors de l'ajout : ${errorMessage}`);
                    this.logger.error('Erreur d\'ajout:', result);
                    
                    // Si le lancement n'existe pas, suggérer de le créer
                    if (errorMessage.includes('n\'existe pas dans la base de données')) {
                        const createLancement = confirm(
                            `${errorMessage}\n\nVoulez-vous créer le lancement dans LCTE maintenant ?`
                        );
                        if (createLancement) {
                            // TODO: Ouvrir un formulaire pour créer le lancement
                            this.logger.log('Création du lancement demandée');
                        }
                    }
                }
            } finally {
                // Masquer l'indicateur de chargement
                this.loadingIndicator.hide('addOperation');
            }
        } catch (error) {
            this.errorHandler.handle(error, 'handleAddOperation', 'Erreur de connexion lors de l\'ajout');
            this.loadingIndicator.hide('addOperation');
        }
    }

    updateOperationsTable() {
        this.logger.log('🔄 DEBUT updateOperationsTable()');
        this.logger.log('📊 OPERATIONS TOTALES:', this.operations.length);
        this.logger.log('📋 TABLEAU BODY:', this.operationsTableBody);
        
        if (!this.operationsTableBody) {
            this.logger.error('❌ ERREUR: operationsTableBody est null!');
            return;
        }
        
        // Appliquer les filtres
        let filteredOperations = [...this.operations];
        
        // Filtre statut opération (EN_COURS / EN_PAUSE / TERMINE)
        const statusFilter = document.getElementById('statusFilter');
        const selectedOpStatus = statusFilter?.value?.toUpperCase().trim();

        if (selectedOpStatus && selectedOpStatus !== '') {
            filteredOperations = filteredOperations.filter(op => {
                const sc = (op?.StatusCode || op?.statusCode || '').toString().trim().toUpperCase();
                const statusLabel = (op?.Status || op?.status || '').toString().trim().toUpperCase();
                if (selectedOpStatus === 'EN_COURS') return sc === 'EN_COURS' || statusLabel.includes('EN COURS');
                if (selectedOpStatus === 'EN_PAUSE') return sc === 'EN_PAUSE' || sc === 'PAUSE' || statusLabel.includes('PAUSE');
                if (selectedOpStatus === 'TERMINE') return sc === 'TERMINE' || sc === 'TERMINÉ' || statusLabel.includes('TERMIN');
                return true;
            });
        }
        
        // Filtre opérateur
        const operatorSelect = this.domCache.get('operatorFilter');
        const selectedOperatorCode = operatorSelect?.value?.toString().trim();
        if (selectedOperatorCode) {
            this.logger.log('👤 Filtrage par opérateur:', selectedOperatorCode);
            filteredOperations = filteredOperations.filter(op => {
                const opCode = (op.OperatorCode || op.operatorCode || op.operatorId || '').toString().trim();
                return opCode === selectedOperatorCode;
            });
            this.logger.log(`📊 Après filtrage opérateur: ${filteredOperations.length} opérations`);
        }
        
        // Filtre de recherche (code lancement)
        const searchFilter = this.domCache.get('searchFilter');
        if (searchFilter && searchFilter.value.trim()) {
            const searchTerm = searchFilter.value.trim().toLowerCase();
            this.logger.log('🔍 Filtrage par recherche:', searchTerm);
            filteredOperations = filteredOperations.filter(op => {
                const lancementCode = (op.LancementCode || op.lancementCode || '').toLowerCase();
                return lancementCode.includes(searchTerm);
            });
            this.logger.log(`📊 Après filtrage recherche: ${filteredOperations.length} opérations`);
        }

        // Mémoriser pour stats cohérentes avec le tableau
        this._lastFilteredOperationsForStats = filteredOperations;
        this.updateStats(filteredOperations);
        
        clearElement(this.operationsTableBody);
        this.logger.log('🧹 TABLEAU VIDE');
        
        // Déterminer le message à afficher si aucune opération
        let emptyMessage = '';
        let emptySubMessage = '';
        
        if (filteredOperations.length === 0) {
            this.logger.log('⚠️ AUCUNE OPERATION APRES FILTRAGE - AFFICHAGE MESSAGE');
            this.logger.log('🔍 Filtres actifs:', {
                statusFilter: statusFilter?.value || 'aucun',
                searchFilter: searchFilter?.value || 'aucun',
                totalOperations: this.operations.length
            });
            
            // Message personnalisé selon les filtres actifs
            if (statusFilter && statusFilter.value) {
                const opLabels = {
                    'EN_COURS': 'en cours',
                    'EN_PAUSE': 'en pause',
                    'TERMINE': 'terminés'
                };
                const statusLabel = opLabels[statusFilter.value] || statusFilter.value.toLowerCase();
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
            
            const row = createElement('tr', { className: 'empty-state-row' });
            const cell = createTableCell('', { colspan: '9', className: 'empty-state' });
            
            const div = createElement('div', { style: { textAlign: 'center', padding: '3rem 2rem' } });
            
            const icon = createElement('i', { 
                className: 'fas fa-inbox',
                style: { fontSize: '3rem', color: '#ccc', marginBottom: '1rem', display: 'block' }
            });
            div.appendChild(icon);
            
            const p1 = createElement('p', {
                style: { fontSize: '1.1rem', color: '#666', margin: '0.5rem 0', fontWeight: '500' }
            }, emptyMessage);
            div.appendChild(p1);
            
            const p2 = createElement('p', {
                style: { fontSize: '0.9rem', color: '#999', margin: '0' }
            }, emptySubMessage);
            div.appendChild(p2);
            
            cell.appendChild(div);
            row.appendChild(cell);
            this.operationsTableBody.appendChild(row);
            this.logger.log('✅ MESSAGE AJOUTE AU TABLEAU');
            return;
        }
        
        // Utiliser les opérations filtrées pour l'affichage
        // ✅ Nouveau comportement: 1 ligne par CYCLE/ENREGISTREMENT (et non plus 1 seule ligne par opérateur).
        // On ne regroupe plus par OperatorCode: chaque enregistrement retourné par le backend apparaît dans le tableau.
        const getOperatorCode = (op) => String(op?.OperatorCode || op?.operatorCode || op?.operatorId || '').trim();
        const getLancementCode = (op) => String(op?.LancementCode || op?.lancementCode || '').trim().toUpperCase();
        const getRowId = (op) => {
            const tempsId = op?.TempsId ?? null;
            const eventId = op?.EventId ?? op?.id ?? null;
            const v = tempsId || eventId;
            const n = v ? Number(v) : 0;
            return Number.isFinite(n) ? n : 0;
        };
        const getStatusCode = (op) => {
            const sc = (op?.StatusCode || op?.statusCode || '').toString().trim().toUpperCase();
            if (sc) return sc;
            const statusLabel = (op?.Status || op?.status || '').toString().trim().toUpperCase();
            if (statusLabel.includes('EN COURS')) return 'EN_COURS';
            if (statusLabel.includes('PAUSE')) return 'EN_PAUSE';
            if (statusLabel.includes('TERMIN')) return 'TERMINE';
            // fallback: si EndTime existe, considérer terminé
            const end = this.formatDateTime(op?.EndTime ?? op?.endTime);
            if (end && end !== '-' && String(end).trim() !== '' && end !== 'N/A') return 'TERMINE';
            return '';
        };
        // Trier les opérations pour un affichage stable (opérateur, lancement, heure de début)
        const operationsToDisplay = [...filteredOperations].sort((a, b) => {
            const opA = getOperatorCode(a);
            const opB = getOperatorCode(b);
            if (opA !== opB) return opA.localeCompare(opB);
            const ltA = getLancementCode(a);
            const ltB = getLancementCode(b);
            if (ltA !== ltB) return ltA.localeCompare(ltB);
            const startA = this.formatDateTime(a?.StartTime ?? a?.startTime) || '';
            const startB = this.formatDateTime(b?.StartTime ?? b?.startTime) || '';
            return startA.localeCompare(startB);
        });

        // Mémoriser des compteurs d'affichage pour la pagination (fallback)
        this._lastDisplayCounts = {
            rowsDisplayed: operationsToDisplay.length,
            operatorsDisplayed: operationsToDisplay.length
        };

        // Pré-calcul: détecter les LT avec plusieurs opérateurs (pour afficher un badge clair)
        const ltToOperators = new Map(); // LT -> Set(operatorCode)
        operationsToDisplay.forEach(op => {
            const lt = String(op.LancementCode || op.lancementCode || '').trim().toUpperCase();
            if (!lt) return;
            const opCode = getOperatorCode(op);
            if (!ltToOperators.has(lt)) ltToOperators.set(lt, new Set());
            if (opCode) ltToOperators.get(lt).add(opCode);
        });
        
        this.logger.log('🔄 CREATION DES LIGNES POUR', operationsToDisplay.length, 'OPERATIONS');
        this.logger.log('📋 DONNEES COMPLETES DES OPERATIONS:', operationsToDisplay);
        
        operationsToDisplay.forEach((operation, index) => {
            // Debug pour voir les données reçues (Monitoring)
            this.logger.log(`🔍 Enregistrement ${index + 1}:`, {
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
                    this.logger.warn(`⚠️ Heures incohérentes pour ${operation.lancementCode}: ${formattedStartTime} -> ${formattedEndTime}`);
                }
            }
            
            this.logger.log(`⏰ Heures formatées pour ${operation.LancementCode}:`, {
                startTime: `${operation.StartTime} -> ${formattedStartTime}`,
                endTime: `${operation.EndTime} -> ${formattedEndTime}`,
                warning: timeWarning ? 'Heures incohérentes détectées' : 'OK'
            });
            
            const row = createElement('tr');
            
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
            
            // Construire les cellules de manière sécurisée
            // Cellule 1: Opérateur
            const cell1 = createTableCell(operation.OperatorName || operation.OperatorCode || '-');
            row.appendChild(cell1);
            
            // Cellule 2: Lancement avec badge multi-opérateurs
            const cell2 = createTableCell('');
            const lancementDiv = createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
            const lancementCodeDiv = createElement('div', {}, operation.LancementCode || '-');
            lancementDiv.appendChild(lancementCodeDiv);
            
            const lt = String(operation.LancementCode || '').trim().toUpperCase();
            const n = lt ? (ltToOperators.get(lt)?.size || 0) : 0;
            if (n > 1) {
                const badge = createBadge(`👥 ${n} opérateurs`, 'badge-secondary');
                badge.style.cssText = 'width:max-content;';
                lancementDiv.appendChild(badge);
            }
            cell2.appendChild(lancementDiv);
            row.appendChild(cell2);
            
            // Cellule 3: Nom lancement
            const cell3 = createTableCell(operation.LancementName || '-');
            row.appendChild(cell3);
            
            // Cellule 4: Phase
            const cell4 = createTableCell(operation.Phase || operation.phase || '-');
            row.appendChild(cell4);
            
            // Cellule 5: CodeRubrique
            const cell5 = createTableCell(operation.CodeRubrique || operation.codeRubrique || '-');
            row.appendChild(cell5);
            
            // Cellule 6: Heure début
            const cell6 = createTableCell(formattedStartTime);
            row.appendChild(cell6);
            
            // Cellule 7: Heure fin avec warning
            const endTimeText = formattedEndTime + timeWarning;
            const cell7 = createTableCell(endTimeText);
            row.appendChild(cell7);
            
            // Cellule 8: Statut
            const cell8 = createTableCell('');
            const statusBadge = createBadge(statutLabel, `status-badge status-${statutCode}`);
            cell8.appendChild(statusBadge);
            row.appendChild(cell8);
            
            // Cellule 9: Actions
            const cell9 = createTableCell('', { className: 'actions-cell' });
            const editBtn = createButton({
                icon: 'fas fa-edit',
                className: 'btn-edit',
                title: 'Corriger',
                dataset: {
                    id: rowId,
                    operationId: rowId,
                    tempsId: tempsId || '',
                    eventId: eventId || '',
                    unconsolidated: isUnconsolidated ? 'true' : 'false'
                }
            });
            const deleteBtn = createButton({
                icon: 'fas fa-trash',
                className: 'btn-delete',
                title: 'Supprimer',
                dataset: {
                    id: rowId,
                    operationId: rowId,
                    tempsId: tempsId || '',
                    eventId: eventId || '',
                    unconsolidated: isUnconsolidated ? 'true' : 'false'
                }
            });
            cell9.appendChild(editBtn);
            cell9.appendChild(deleteBtn);
            row.appendChild(cell9);
            
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
            this.logger.log('⏸️ Transfert déjà en cours, ignoré');
            return;
        }

        try {
            this._isTransferring = true;
            
            // Afficher un indicateur de chargement
            const transferBtn = this.domCache.get('transferBtn');
            this.loadingIndicator.show('transfer', transferBtn, 'Transfert en cours...');
            const allRecordsData = this.operations || [];
            this.logger.log(`📊 Total opérations dans le tableau: ${allRecordsData.length}`);

            // 1) Prendre uniquement les opérations TERMINÉES non déjà transférées
            let terminatedOps = allRecordsData.filter(
                op => this.isOperationTerminated(op) && op.StatutTraitement !== 'T'
            );

            this.logger.log(`📊 Opérations TERMINÉES non transférées: ${terminatedOps.length}`);

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
                this.logger.log(`🔄 Consolidation de ${opsWithoutTempsId.length} opération(s) terminée(s) sans TempsId avant transfert...`);
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

                    this.logger.log(
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
                        
                        this.logger.error('❌ Erreurs de consolidation:', errors);
                        
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
                
                this.logger.error('❌ Aucune opération consolidée:', {
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

            this.logger.log(
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
                    // Recharger les données pour mettre à jour l'affichage
                    await this.loadData(false); // Désactiver autoConsolidate après transfert
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
            this.errorHandler.handle(error, 'handleTransfer', 'Erreur de connexion lors du transfert');
        } finally {
            this._isTransferring = false;
        }
    }

    openTransferModal(records) {
        const modal = this.domCache.get('transferSelectionModal');
        const body = this.domCache.get('transferModalTableBody');
        const selectAll = this.domCache.get('transferSelectAll');
        if (!modal || !body) return;

        this.transferSelectionIds.clear();
        if (selectAll) selectAll.checked = true;

        clearElement(body);
        for (const r of records) {
            const id = r.TempsId;
            const key = String(id);
            this.transferSelectionIds.add(key); // pré-sélectionner tout

            const tr = createElement('tr');
            
            // Cellule checkbox
            const cell1 = createTableCell('', { 
                style: { textAlign: 'center', padding: '10px', borderBottom: '1px solid #f0f0f0' } 
            });
            const checkbox = createElement('input', {
                type: 'checkbox',
                className: 'transfer-row',
                dataset: { id: id },
                checked: true
            });
            cell1.appendChild(checkbox);
            tr.appendChild(cell1);
            
            // Cellule opérateur
            const cell2 = createTableCell(r.OperatorName || r.OperatorCode || '-', {
                style: { padding: '10px', borderBottom: '1px solid #f0f0f0' }
            });
            tr.appendChild(cell2);
            
            // Cellule lancement code
            const cell3 = createTableCell(r.LancementCode || '-', {
                style: { padding: '10px', borderBottom: '1px solid #f0f0f0' }
            });
            tr.appendChild(cell3);
            
            // Cellule lancement name
            const cell4 = createTableCell(r.LancementName || '-', {
                style: { padding: '10px', borderBottom: '1px solid #f0f0f0' }
            });
            tr.appendChild(cell4);
            
            // Cellule heure début
            const cell5 = createTableCell(this.formatDateTime(r.StartTime), {
                style: { padding: '10px', borderBottom: '1px solid #f0f0f0' }
            });
            tr.appendChild(cell5);
            
            // Cellule heure fin
            const cell6 = createTableCell(this.formatDateTime(r.EndTime), {
                style: { padding: '10px', borderBottom: '1px solid #f0f0f0' }
            });
            tr.appendChild(cell6);
            
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
        const modal = this.domCache.get('transferSelectionModal');
        if (modal) modal.style.display = 'none';
        this.transferSelectionIds.clear();
        // Réinitialiser le flag de transfert si la modale est fermée sans transférer
        // (le flag sera réinitialisé dans le finally de handleTransfer si le transfert a été fait)
        if (this._isTransferring) {
            this.logger.log('⚠️ Modale fermée sans transfert, réinitialisation du flag');
            this._isTransferring = false;
        }
    }

    toggleTransferSelectAll(checked) {
        const body = this.domCache.get('transferModalTableBody');
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
            this.logger.error('❌ Erreur lors du transfert depuis la modale:', error);
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
            this.logger.error('❌ Erreur suppression opération:', error);
            this.notificationManager.error('Erreur lors de la suppression');
        }
    }

    async deleteMonitoringRecord(id) {
        // Supprimer un enregistrement consolidé (depuis ABTEMPS_OPERATEURS)
        // Valider l'ID
        if (!this.validator.validateId(id)) {
            this.notificationManager.error('ID invalide');
            return;
        }
        
        // Convertir l'ID en nombre pour éviter les problèmes de type
        const tempsId = parseInt(id, 10);
        if (isNaN(tempsId)) {
            this.logger.error('❌ ID invalide:', id);
            this.notificationManager.error('ID d\'enregistrement invalide');
            return;
        }

        if (!confirm('Supprimer cet enregistrement de temps ?')) return;
        
        try {
            // Afficher un indicateur de chargement
            this.loadingIndicator.show('deleteMonitoring', null, 'Suppression en cours...');
            
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
            this.errorHandler.handle(error, 'deleteMonitoringRecord', 'Erreur lors de la suppression');
        } finally {
            this.loadingIndicator.hide('deleteMonitoring');
        }
    }

    async editMonitoringRecord(id) {
        // Convertir l'ID en nombre pour éviter les problèmes de type
        const tempsId = parseInt(id, 10);
        if (isNaN(tempsId)) {
            this.logger.error('❌ ID invalide:', id);
            this.notificationManager.error('ID d\'enregistrement invalide');
            return;
        }

        // Trouver l'enregistrement actuel pour pré-remplir les prompts
        const record = this.operations.find(op => op.TempsId == tempsId);
        
        if (!record) {
            this.logger.warn(`⚠️ Enregistrement avec TempsId ${tempsId} non trouvé dans les données locales. Actualisation...`);
            this.notificationManager.warning('Enregistrement non trouvé. Actualisation des données...');
            await this.loadData();
            return;
        }

        // Si l'enregistrement est non consolidé, utiliser editOperation à la place
        if (record._isUnconsolidated) {
            this.logger.log('⚠️ Enregistrement non consolidé, redirection vers editOperation');
            await this.editOperation(id);
            return;
        }

        const currentLancementCode = record?.LancementCode || '';
        const currentPhase = record?.Phase || '';
        const currentCodeRubrique = record?.CodeRubrique || '';
        const currentStartTime = record?.StartTime ? this.formatDateTime(record.StartTime) : '';
        const currentEndTime = record?.EndTime ? this.formatDateTime(record.EndTime) : '';

        // Correction simple via prompts (Phase/CodeRubrique/Start/End)
        const lancementCode = prompt(`Lancement (actuel: ${currentLancementCode || 'vide'}) :`, currentLancementCode);
        const phase = prompt(`Phase (actuel: ${currentPhase || 'vide'}) :`, currentPhase);
        const codeRubrique = prompt(`CodeRubrique (actuel: ${currentCodeRubrique || 'vide'}) :`, currentCodeRubrique);
        const startTime = prompt(`Heure début (actuel: ${currentStartTime || 'vide'}) (YYYY-MM-DDTHH:mm:ss ou HH:mm) :`, currentStartTime);
        const endTime = prompt(`Heure fin (actuel: ${currentEndTime || 'vide'}) (YYYY-MM-DDTHH:mm:ss ou HH:mm) :`, currentEndTime);

        const corrections = {};
        if (lancementCode !== null && lancementCode !== '' && lancementCode !== currentLancementCode) corrections.LancementCode = lancementCode;
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
                    if (corrections.LancementCode !== undefined) record.LancementCode = corrections.LancementCode;
                    if (corrections.Phase !== undefined) record.Phase = corrections.Phase;
                    if (corrections.CodeRubrique !== undefined) record.CodeRubrique = corrections.CodeRubrique;
                    if (corrections.StartTime !== undefined) record.StartTime = corrections.StartTime;
                    if (corrections.EndTime !== undefined) record.EndTime = corrections.EndTime;
                    
                    // Mettre à jour la ligne dans le tableau sans tout recharger
                    this.updateMonitoringRowInTable(tempsId, record);
                }
                
                // Recharger les données après un court délai pour s'assurer que tout est synchronisé
                setTimeout(async () => {
                    // Utiliser la date locale pour correspondre à la date SQL (évite les décalages UTC).
                    const d = new Date();
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    await this.loadMonitoringRecords(`${y}-${m}-${day}`);
                    this.updateOperationsTable();
                }, 500);
            } else {
                this.notificationManager.error(result?.error || 'Erreur correction');
            }
        } catch (error) {
            this.logger.error('❌ Erreur lors de la correction:', error);
            
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
            const badge = createElement('span', {
                className: 'operation-issue-badge badge badge-warning',
                style: { marginLeft: '5px', cursor: 'pointer' },
                title: [...validation.errors, ...validation.warnings].join('\n')
            });
            const icon = createElement('i', { className: 'fas fa-exclamation-triangle' });
            badge.appendChild(icon);
            
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
        this.logger.log('✏️ Édition (popup) opération non consolidée, EventId:', id);
        
        const record = this.operations.find(op => 
            (op.EventId && op.EventId == id) || 
            (op.id && op.id == id) ||
            (op._isUnconsolidated && (op.EventId == id || op.id == id))
        );
        
        if (!record) {
            this.logger.warn(`⚠️ Opération avec EventId ${id} non trouvée. Actualisation...`);
            this.notificationManager.warning('Opération non trouvée. Actualisation des données...');
            await this.loadData();
            return;
        }

        // Si l'opération est en fait consolidée, rediriger vers l'édition monitoring
        if (!record._isUnconsolidated && record.TempsId) {
            this.logger.warn(`⚠️ Opération ${id} est consolidée, redirection vers editMonitoringRecord`);
            await this.editMonitoringRecord(record.TempsId);
            return;
        }

        const eventId = record.EventId || record.id || id;

        // Préparer les valeurs actuelles pour les popups
        const currentLancementCode = String(record.LancementCode || record.CodeLanctImprod || record.lancementCode || '').trim();
        const currentStart = this.cleanTimeValue(record.startTime || record.StartTime || '');
        const currentEnd = this.cleanTimeValue(record.endTime || record.EndTime || '');

        const newLancementCode = prompt(
            `Lancement (actuel: ${currentLancementCode || 'vide'}) :`,
            currentLancementCode
        );
        if (newLancementCode === null) {
            // Annulé par l'utilisateur
            return;
        }

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
        const normalizedLancement = String(newLancementCode || '').trim();
        if (normalizedLancement && normalizedLancement !== currentLancementCode) updateData.lancementCode = normalizedLancement;
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
            this.logger.error('❌ Erreur lors de la modification de l\'opération:', error);
            this.notificationManager.error('Erreur lors de la modification');
        }
    }
    
    // Fonction d'édition inline (non-async car manipulation DOM directe)
    editOperationInline(id) {
        this.logger.log('🔧 Édition inline de l\'opération:', id, 'Type:', typeof id);
        
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
            this.logger.error('❌ Ligne non trouvée pour l\'ID:', id);
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
            this.logger.error('❌ Opération non trouvée pour l\'ID:', id);
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
            clearElement(cells[5]);
            const startInput = createElement('input', {
                type: 'time',
                className: 'time-input form-control',
                dataset: {
                    field: 'startTime',
                    id: id,
                    original: originalStartTime
                },
                value: originalStartTime || '',
                style: { width: '100%', padding: '4px' }
            });
            cells[5].appendChild(startInput);
            
            // Cellule heure fin (index 6)
            clearElement(cells[6]);
            const endInput = createElement('input', {
                type: 'time',
                className: 'time-input form-control',
                dataset: {
                    field: 'endTime',
                    id: id,
                    original: originalEndTime
                },
                value: originalEndTime || '',
                style: { width: '100%', padding: '4px' }
            });
            endInput.addEventListener('change', () => this.validateTimeInput(endInput));
            cells[6].appendChild(endInput);
            
            // Cellule actions (index 8) - remplacer par boutons sauvegarder/annuler
            clearElement(cells[8]);
            const saveBtn = createButton({
                icon: 'fas fa-check',
                className: 'btn btn-sm btn-success',
                title: 'Sauvegarder',
                onClick: () => this.saveOperation(id)
            });
            const cancelBtn = createButton({
                icon: 'fas fa-times',
                className: 'btn btn-sm btn-secondary',
                title: 'Annuler',
                onClick: () => this.cancelEdit(id)
            });
            cancelBtn.style.marginLeft = '5px';
            cells[8].appendChild(saveBtn);
            cells[8].appendChild(cancelBtn);
        }
    }
    
    cancelEdit(id) {
        // Recharger les données pour annuler l'édition et restaurer l'état normal
        this.loadData();
    }

    updateMonitoringRowInTable(tempsId, record) {
        const row = document.querySelector(`tr[data-operation-id="${tempsId}"]`);
        if (!row) {
            this.logger.warn(`⚠️ Ligne non trouvée pour TempsId ${tempsId}, rechargement complet`);
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
            
            this.logger.log(`✅ Ligne ${tempsId} mise à jour dans le tableau:`, {
                StartTime: formattedStartTime,
                EndTime: formattedEndTime
            });
        }
    }

    formatDateTime(dateString) {
        // Si c'est null ou undefined, retourner un tiret
        if (!dateString) return '-';
        
        if (this.debugTime) {
            this.logger.log(`🔧 formatDateTime input: "${dateString}" (type: ${typeof dateString}) and value:`, dateString);
        }
        
        // Si c'est déjà au format HH:mm, le retourner directement
        if (typeof dateString === 'string') {
            const timeMatch = dateString.match(/^(\d{1,2}):(\d{2})$/);
            if (timeMatch) {
                const hours = timeMatch[1].padStart(2, '0');
                const minutes = timeMatch[2];
                const result = `${hours}:${minutes}`;
                if (this.debugTime) this.logger.log(`✅ formatDateTime: ${dateString} → ${result}`);
                return result;
            }
            
            // Si c'est au format HH:mm:ss, extraire HH:mm
            const timeWithSecondsMatch = dateString.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
            if (timeWithSecondsMatch) {
                const hours = timeWithSecondsMatch[1].padStart(2, '0');
                const minutes = timeWithSecondsMatch[2];
                const result = `${hours}:${minutes}`;
                if (this.debugTime) this.logger.log(`✅ formatDateTime: ${dateString} → ${result}`);
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
            if (this.debugTime) this.logger.log(`✅ formatDateTime: Date → ${result}`);
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
                if (this.debugTime) this.logger.log(`✅ formatDateTime: Date string → ${result}`);
                return result;
            }
        } catch (error) {
            this.logger.warn('Erreur formatage heure:', dateString, error);
        }
        
        // En dernier recours, retourner la valeur originale ou un tiret
        this.logger.warn(`⚠️ Format non reconnu: ${dateString}`);
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
            
            this.logger.log(`🔄 Sauvegarde automatique activée (${this.autoSaveInterval/1000}s)`);
        }
    }
    
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
            this.logger.log('⏹️ Sauvegarde automatique désactivée');
        }
    }
    
    addPendingChange(operationId, field, value) {
        if (!this.pendingChanges.has(operationId)) {
            this.pendingChanges.set(operationId, {});
        }
        
        const operationChanges = this.pendingChanges.get(operationId);
        operationChanges[field] = value;
        
        this.logger.log(`📝 Modification en attente pour ${operationId}:`, operationChanges);
        
        // Sauvegarde immédiate pour les modifications critiques
        if (field === 'startTime' || field === 'endTime') {
            this.saveOperationImmediately(operationId, operationChanges);
        }
    }
    
    async processAutoSave() {
        if (this.pendingChanges.size === 0) {
            return;
        }
        
        this.logger.log(`💾 Sauvegarde automatique de ${this.pendingChanges.size} modifications...`);
        
        const savePromises = [];
        
        for (const [operationId, changes] of this.pendingChanges) {
            if (Object.keys(changes).length > 0) {
                savePromises.push(this.saveOperationChanges(operationId, changes));
            }
        }
        
        try {
            await Promise.all(savePromises);
            this.pendingChanges.clear();
            this.logger.log('✅ Sauvegarde automatique terminée');
            
            // Notification discrète
            this.showAutoSaveNotification('Modifications sauvegardées automatiquement');
            
        } catch (error) {
            this.logger.error('❌ Erreur sauvegarde automatique:', error);
            this.showAutoSaveNotification('Erreur lors de la sauvegarde automatique', 'error');
        }
    }
    
    async saveOperationImmediately(operationId, changes) {
        try {
            await this.saveOperationChanges(operationId, changes);
            this.pendingChanges.delete(operationId);
            this.logger.log(`⚡ Sauvegarde immédiate réussie pour ${operationId}`);
        } catch (error) {
            this.logger.error(`❌ Erreur sauvegarde immédiate ${operationId}:`, error);
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
            this.logger.log(`✅ Opération ${operationId} mise à jour:`, changes);
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
            this.logger.log(`📢 ${message}`);
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
            this.logger.error('❌ Erreur validation code:', error);
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
        const tooltip = createElement('div', { className: 'validation-tooltip success' });
        const strong = createElement('strong', {}, '✅ Code valide');
        tooltip.appendChild(strong);
        tooltip.appendChild(createElement('br'));
        tooltip.appendChild(document.createTextNode(data.designation));
        tooltip.appendChild(createElement('br'));
        const small = createElement('small', {}, `Statut: ${data.statut}`);
        tooltip.appendChild(small);
        
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
        const tooltip = createElement('div', { className: 'validation-tooltip error' });
        const strong = createElement('strong', {}, `❌ ${error}`);
        tooltip.appendChild(strong);
        
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
        
        this.logger.warn(`⚠️ Format d'heure non reconnu pour nettoyage: "${timeString}"`);
        return '';
    }

    formatTimeForInput(timeString) {
        if (!timeString) return '';
        
        if (this.debugTime) this.logger.log(`🔧 formatTimeForInput: "${timeString}"`);
        
        // Si c'est déjà au format HH:mm, le retourner directement
        if (typeof timeString === 'string' && /^\d{2}:\d{2}$/.test(timeString)) {
            if (this.debugTime) this.logger.log(`✅ Format HH:mm direct: ${timeString}`);
            return timeString;
        }
        
        // Si c'est au format HH:mm:ss, enlever les secondes
        if (typeof timeString === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(timeString)) {
            const result = timeString.substring(0, 5);
            if (this.debugTime) this.logger.log(`✅ Format HH:mm:ss → HH:mm: ${timeString} → ${result}`);
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
                    if (this.debugTime) this.logger.log(`✅ Date complète → HH:mm: ${timeString} → ${formattedTime}`);
                    return formattedTime;
                }
            } catch (error) {
                this.logger.warn('Erreur parsing date:', timeString, error);
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
            if (this.debugTime) this.logger.log(`✅ Date object → HH:mm: ${timeString} → ${formattedTime}`);
            return formattedTime;
        }
        
        this.logger.warn(`⚠️ Format d'heure non reconnu: "${timeString}" (type: ${typeof timeString})`);
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
            this.logger.warn('Date invalide reçue:', dateString);
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
                this.logger.warn('⚠️ Ligne non trouvée pour l\'opération', id);
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

            this.logger.log('🔍 Recherche des inputs:', {
                id,
                rowFound: !!row,
                startTimeInputFound: !!startTimeInput,
                endTimeInputFound: !!endTimeInput,
                statusSelectFound: !!statusSelect,
                rowHTML: row.innerHTML.substring(0, 200) + '...'
            });

            if (!startTimeInput || !endTimeInput) {
                this.logger.warn('⚠️ Impossible de trouver les champs d\'heure pour la ligne', id);
                this.logger.log('🔍 Contenu de la ligne:', row.innerHTML);
                this.notificationManager.warning('Aucune édition active pour cette ligne - Rechargement du tableau');
                this.updateOperationsTable();
                return;
            }
            
            // Le statut est optionnel (peut ne pas être en mode édition)
            if (!statusSelect) {
                this.logger.log('ℹ️ Aucun select de statut trouvé - mode édition partielle');
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
                    this.logger.warn('⚠️ Heure de fin antérieure à l\'heure de début:', { startTime, endTime });
                    return;
                }
            }

            // Vérifier si les valeurs ont vraiment changé
            const startTimeChanged = startTimeInput.value !== originalStartTime;
            const endTimeChanged = endTimeInput.value !== originalEndTime;
            const statusChanged = statusSelect ? (statusSelect.value !== originalStatus) : false;
            
            this.logger.log(`🔧 Comparaison des valeurs pour ${id}:`, {
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
                this.logger.log(`ℹ️ Aucune modification détectée pour l'opération ${id}`);
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
                this.logger.log(`🔧 Statut changé: ${originalStatus} → ${statusSelect.value}`);
            }
            
            // Validation de cohérence des heures
            if (updateData.startTime && updateData.endTime) {
                if (!this.validateTimeConsistency(updateData.startTime, updateData.endTime)) {
                    this.notificationManager.warning('Attention: L\'heure de fin est antérieure à l\'heure de début');
                }
            }

            this.logger.log(`💾 Sauvegarde opération ${id}:`, updateData);

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
                this.logger.log('🔍 Opération après mise à jour en mémoire:', updatedOperation);
                
                // Recharger complètement les données pour restaurer l'état normal (sortir du mode édition)
                await this.loadData();
            } else {
                const errorMessage = response.error || 'Erreur lors de la mise à jour';
                this.notificationManager.error(`Erreur: ${errorMessage}`);
                this.logger.error('Erreur de mise à jour:', response);
            }
        } catch (error) {
            this.logger.error('Erreur sauvegarde:', error);
            
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
        this.logger.log(`🔄 Mise à jour en mémoire de l'opération ${operationId}:`, updateData);
        
        const operation = this.operations.find(op => op.id == operationId);
        if (!operation) {
            this.logger.error(`❌ Opération ${operationId} non trouvée en mémoire`);
            return;
        }
        
        // Mettre à jour les champs modifiés
        if (updateData.startTime !== undefined) {
            operation.startTime = updateData.startTime;
            this.logger.log(`✅ startTime mis à jour: ${operation.startTime}`);
        }
        
        if (updateData.endTime !== undefined) {
            operation.endTime = updateData.endTime;
            this.logger.log(`✅ endTime mis à jour: ${operation.endTime}`);
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
            this.logger.log(`✅ Statut mis à jour: ${operation.statusCode} (${operation.status})`);
        }
        
        // Mettre à jour le timestamp de dernière modification
        operation.lastUpdate = new Date().toISOString();
        
        this.logger.log(`✅ Opération ${operationId} mise à jour en mémoire`);
    }

    updateSingleRowInTable(operationId) {
        this.logger.log(`🔄 Mise à jour de la ligne ${operationId} dans le tableau`);
        
        // Chercher l'opération par id ou TempsId (pour les opérations non consolidées)
        const operation = this.operations.find(op => op.id == operationId || op.TempsId == operationId);
        if (!operation) {
            this.logger.error(`❌ Opération ${operationId} non trouvée pour mise à jour du tableau`);
            return;
        }
        
        // Trouver la ligne existante
        const existingRow = document.querySelector(`tr[data-operation-id="${operationId}"]`);
        if (!existingRow) {
            this.logger.warn(`⚠️ Ligne non trouvée pour l'opération ${operationId}, rechargement complet`);
            this.updateOperationsTable();
            return;
        }
        
        // Mettre à jour les cellules d'heures et statut
        const cells = existingRow.querySelectorAll('td');
        if (cells.length >= 8) {
            // Cellule heure début (index 5) - utiliser startTime ou StartTime
            const startTimeValue = operation.startTime || operation.StartTime;
            const formattedStartTime = this.formatDateTime(startTimeValue);
            clearElement(cells[5]);
            cells[5].textContent = formattedStartTime;
            
            // Cellule heure fin (index 6) - utiliser endTime ou EndTime
            const endTimeValue = operation.endTime || operation.EndTime;
            const formattedEndTime = this.formatDateTime(endTimeValue);
            clearElement(cells[6]);
            cells[6].textContent = formattedEndTime;
            
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
            
            this.logger.log(`🔍 Mise à jour statut pour ${operationId}:`, {
                statusCode: statusCode,
                statusLabel: statusLabel,
                operationStatusCode: operation.statusCode,
                operationStatus: operation.status
            });
            
            clearElement(cells[7]);
            const statusBadge = createBadge(statusLabel, `status-badge status-${statusCode}`);
            cells[7].appendChild(statusBadge);
            
            this.logger.log(`✅ Ligne ${operationId} mise à jour: ${formattedStartTime} -> ${formattedEndTime}, statut: ${statusCode} (${statusLabel})`);
        } else {
            this.logger.error(`❌ Pas assez de cellules dans la ligne ${operationId}: ${cells.length}`);
        }
    }

    debugTimeSync(operationId) {
        const operation = this.operations.find(op => op.id == operationId);
        const row = document.querySelector(`tr[data-operation-id="${operationId}"]`);
        
        if (!operation) {
            this.logger.error(`❌ Opération ${operationId} non trouvée en mémoire`);
            return;
        }
        
        if (!row) {
            this.logger.error(`❌ Ligne ${operationId} non trouvée dans le DOM`);
            return;
        }
        
        const cells = row.querySelectorAll('td');
        const displayedStartTime = cells[5] ? cells[5].textContent : 'N/A';
        const displayedEndTime = cells[6] ? cells[6].textContent : 'N/A';
        
        this.logger.log(`🔍 Debug synchronisation ${operationId}:`, {
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
                this.logger.error(`Heures invalides: ${hours}`);
                return null;
            }
            if (minutes < 0 || minutes > 59) {
                this.logger.error(`Minutes invalides: ${minutes}`);
                return null;
            }
            
            // Retourner au format HH:mm
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        }
        
        this.logger.error(`Format d'heure invalide: ${timeString}`);
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

        // Date locale (pas UTC) pour cohérence avec la base
        const d = new Date();
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        this.downloadCSV(csvContent, `operations_${today}.csv`);
    }

    downloadCSV(content, filename) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        if (link.style) {
            link.style.visibility = 'hidden';
        }
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
            this.logger.log('  Chargement des données des tables ERP...');
            
            const data = await this.apiService.getTablesInfo();
            
            if (data.success) {
                this.updateTablesDisplay(data.data, data.counts);
                this.notificationManager.success(`Données chargées: ${data.counts.pause} entrées Pause, ${data.counts.temp} entrées Temp`);
            } else {
                this.notificationManager.error('Erreur lors du chargement des tables ERP');
            }
        } catch (error) {
            this.errorHandler.handle(error, 'loadTablesData', 'Erreur de connexion lors du chargement des tables ERP');
        }
    }

    updateTablesDisplay(data, counts) {
        // Mise à jour des compteurs
        const pauseCount = this.domCache.get('pauseCount');
        const tempCount = this.domCache.get('tempCount');
        if (pauseCount) pauseCount.textContent = counts.pause;
        if (tempCount) tempCount.textContent = counts.temp;

        // Mise à jour de la table abetemps_Pause
        this.updateErpTable('pauseTableBody', data.abetemps_Pause);
        
        // Mise à jour de la table abetemps_temp
        this.updateErpTable('tempTableBody', data.abetemps_temp);
    }

    updateErpTable(tableBodyId, tableData) {
        const tableBody = this.domCache.get(tableBodyId);
        if (!tableBody) return;
        
        clearElement(tableBody);

        if (!tableData || tableData.length === 0) {
            const row = createElement('tr');
            const cell = createTableCell('Aucune donnée trouvée', {
                colspan: '7',
                style: { textAlign: 'center', padding: '1rem', color: '#666' }
            });
            row.appendChild(cell);
            tableBody.appendChild(row);
            return;
        }

        tableData.forEach(item => {
            const row = createElement('tr');
            
            // Cellule NoEnreg
            const cell1 = createTableCell(item.NoEnreg || '-');
            row.appendChild(cell1);
            
            // Cellule Ident avec badge
            const cell2 = createTableCell('');
            const badge = createBadge(item.Ident || '-', `badge-${this.getIdentBadgeClass(item.Ident)}`);
            cell2.appendChild(badge);
            row.appendChild(cell2);
            
            // Cellule DateTravail
            const cell3 = createTableCell(this.formatDateTime(item.DateTravail) || '-');
            row.appendChild(cell3);
            
            // Cellule CodeLanctImprod
            const cell4 = createTableCell(item.CodeLanctImprod || '-');
            row.appendChild(cell4);
            
            // Cellule Phase
            const cell5 = createTableCell(item.Phase || '-');
            row.appendChild(cell5);
            
            // Cellule CodePoste
            const cell6 = createTableCell(item.CodePoste || '-');
            row.appendChild(cell6);
            
            // Cellule CodeOperateur (en gras)
            const cell7 = createTableCell('');
            const strong = createElement('strong', {}, item.CodeOperateur || '-');
            cell7.appendChild(strong);
            row.appendChild(cell7);
            
            // Cellule NomOperateur
            const cell8 = createTableCell(item.NomOperateur || 'Non assigné');
            row.appendChild(cell8);
            
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
            this.errorHandler.handle(error, 'loadPage', 'Erreur lors du chargement de la page');
        } finally {
            this.isLoading = false;
        }
    }

    updatePaginationInfo() {
        const paginationInfo = this.domCache.get('paginationInfo');
        if (paginationInfo && this.pagination) {
            // Fix: éviter "Page 1 sur 0 (0 éléments)" quand on affiche des lignes (regroupement par opérateur)
            const displayedRows = Number(this._lastDisplayCounts?.rowsDisplayed || 0);
            const fallbackTotalItems = displayedRows > 0 ? displayedRows : (this.operations?.length || 0);

            let totalPages = Number(this.pagination.totalPages || 0);
            let currentPage = Number(this.pagination.currentPage || 1);
            let totalItems = Number(this.pagination.totalItems || 0);

            if (!Number.isFinite(totalPages) || totalPages < 1) totalPages = 1;
            if (!Number.isFinite(currentPage) || currentPage < 1) currentPage = 1;
            if (currentPage > totalPages) currentPage = totalPages;
            if (!Number.isFinite(totalItems) || totalItems < 1) totalItems = fallbackTotalItems;

            clearElement(paginationInfo);
            
            const paginationDiv = createElement('div', { className: 'pagination-info' });
            
            const span1 = createElement('span', {}, `Page ${currentPage} sur ${totalPages}`);
            paginationDiv.appendChild(span1);
            
            const span2 = createElement('span', {}, `(${totalItems} éléments au total)`);
            paginationDiv.appendChild(span2);
            
            const controlsDiv = createElement('div', { className: 'pagination-controls' });
            
            const prevBtn = createButton({
                className: 'btn btn-sm btn-outline-primary',
                onClick: () => this.loadPage(currentPage - 1)
            });
            prevBtn.appendChild(document.createTextNode('← Précédent'));
            if (!this.pagination.hasPrevPage) prevBtn.disabled = true;
            controlsDiv.appendChild(prevBtn);
            
            const nextBtn = createButton({
                className: 'btn btn-sm btn-outline-primary',
                onClick: () => this.loadPage(currentPage + 1)
            });
            nextBtn.appendChild(document.createTextNode('Suivant →'));
            if (!this.pagination.hasNextPage) nextBtn.disabled = true;
            controlsDiv.appendChild(nextBtn);
            
            paginationDiv.appendChild(controlsDiv);
            paginationInfo.appendChild(paginationDiv);
        }
    }
}

export default AdminPage;
