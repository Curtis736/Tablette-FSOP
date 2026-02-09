// Interface simplifiée pour les opérateurs
import TimeUtils from '../utils/TimeUtils.js';
import ScannerManager from '../utils/ScannerManager.js?v=20251021-scanner-fix';
import FsopForm from './FsopForm.js?v=20260203-ind-operator-fix';

class OperateurInterface {
    constructor(operator, app) {
        this.operator = operator;
        this.app = app;
        this.apiService = app.getApiService();
        this.notificationManager = app.getNotificationManager();
        this.currentLancement = null;
        this.timerInterval = null;
        this.startTime = null;
        this.isRunning = false;
        this.isPaused = false;
        this.totalPausedTime = 0;
        this.pauseStartTime = null;
        this.pendingForceReplace = false; // Flag pour forcer le remplacement après confirmation
        this.cachedOperators = null; // Cache pour la liste des opérateurs
        
        // Debouncing pour éviter les clics répétés
        this.lastActionTime = 0;
        this.actionCooldown = 1000; // 1 seconde entre les actions
        
        this.LANCEMENT_PREFIX = 'LT';
        this.MAX_LANCEMENT_DIGITS = 8;
        
        this.initializeElements();
        this.setupEventListeners();
        this.initializeLancementInput();
        this.checkCurrentOperation();
        this.loadOperatorHistory();
    }

    // Vérifier si une action peut être exécutée (debouncing)
    canPerformAction() {
        const now = Date.now();
        if (now - this.lastActionTime < this.actionCooldown) {
            this.notificationManager.warning('Veuillez attendre avant de relancer une action');
            return false;
        }
        this.lastActionTime = now;
        return true;
    }

    initializeElements() {
        this.lancementInput = document.getElementById('lancementSearch');
        this.lancementList = document.getElementById('lancementList');
        this.controlsSection = document.getElementById('controlsSection');
        this.selectedLancement = document.getElementById('selectedLancement');
        this.lancementDetails = document.getElementById('lancementDetails');
        this.operationStepGroup = document.getElementById('operationStepGroup');
        this.operationStepSelect = document.getElementById('operationStepSelect');
        this.startBtn = document.getElementById('startBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.timerDisplay = document.getElementById('timerDisplay');
        this.statusDisplay = document.getElementById('statusDisplay');
        this.endTimeDisplay = document.getElementById('endTimeDisplay');
        
        // Éléments pour l'historique
        this.refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
        this.operatorHistoryTable = document.getElementById('operatorHistoryTable');
        this.operatorHistoryTableBody = document.getElementById('operatorHistoryTableBody');
        
        // Éléments pour les commentaires
        this.commentInput = document.getElementById('commentInput');
        this.addCommentBtn = document.getElementById('addCommentBtn');
        this.commentCharCount = document.getElementById('commentCharCount');
        this.commentsList = document.getElementById('commentsList');
        
        // Éléments pour le scanner
        this.scanBarcodeBtn = document.getElementById('scanBarcodeBtn');
        this.scannerModal = document.getElementById('barcodeScannerModal');
        this.closeScannerBtn = document.getElementById('closeScannerBtn');
        this.scannerVideo = document.getElementById('scannerVideo');
        this.scannerCanvas = document.getElementById('scannerCanvas');
        this.scannerStatus = document.getElementById('scannerStatus');

        // Éléments FSOP
        this.fsopBtn = document.getElementById('fsopBtn');
        this.fsopModal = document.getElementById('fsopModal');
        this.closeFsopBtn = document.getElementById('closeFsopBtn');
        this.fsopTemplateCodeInput = document.getElementById('fsopTemplateCode');
        this.fsopSerialNumberInput = document.getElementById('fsopSerialNumber');
        this.generateFsopLotBtn = document.getElementById('generateFsopLotBtn');
        this.fsopLotGroup = document.getElementById('fsopLotGroup');
        this.fsopLotList = document.getElementById('fsopLotList');
        this.openFsopWordBtn = document.getElementById('openFsopWordBtn');
        this.openFsopFormBtn = document.getElementById('openFsopFormBtn');
        this.fsopFormModal = document.getElementById('fsopFormModal');
        this.closeFsopFormBtn = document.getElementById('closeFsopFormBtn');
        this.fsopFormContainer = document.getElementById('fsopFormContainer');
        this.fsopFormSaveBtn = document.getElementById('fsopFormSaveBtn');
        
        // Debug des éléments FSOP
        console.log('🔍 [INIT] fsopSerialNumberInput trouvé:', !!this.fsopSerialNumberInput);
        console.log('🔍 [INIT] fsopModal trouvé:', !!this.fsopModal);
        
        // Instance du formulaire FSOP
        this.fsopForm = null;
        this.currentFsopData = null;
        this.currentFsopLots = null; // mémorise les lots récupérés depuis l'ERP pour le LT courant
        this.currentFsopPreferredLot = null;
        this.currentFsopPreferredRubrique = null;
        
        // Initialiser le gestionnaire de scanner
        this.scannerManager = new ScannerManager();
        this.scannerManager.init(
            (code) => this.handleScannedCode(code),
            (error, originalError) => this.handleScannerError(error, originalError)
        );
        
        // Debug des éléments historique
        console.log('refreshHistoryBtn trouvé:', !!this.refreshHistoryBtn);
        console.log('operatorHistoryTableBody trouvé:', !!this.operatorHistoryTableBody);
        console.log('endTimeDisplay trouvé:', !!this.endTimeDisplay);
        
        // Modifier le placeholder pour indiquer la saisie manuelle
        if (this.lancementInput) {
            this.lancementInput.placeholder = "Saisir le code de lancement...";
        }
        
        // Cacher la liste des lancements
        if (this.lancementList) {
            this.lancementList.style.display = 'none';
        }
    }

    initializeLancementInput() {
        if (!this.lancementInput) {
            console.error('Champ de saisie du lancement introuvable');
            return;
        }
        
        // Forcer la présence du préfixe et du format numérique dès l'initialisation
        this.enforceNumericLancementInput(false);
        
        // Focus automatique après un léger délai pour garantir le rendu DOM
        setTimeout(() => {
            if (this.lancementInput && typeof this.lancementInput.focus === 'function') {
                this.lancementInput.focus();
                this.setLancementCaretAfterPrefix();
            }
        }, 150);
        
        // À chaque prise de focus ou clic, replacer le curseur après le préfixe
        ['focus', 'click'].forEach((eventName) => {
            this.lancementInput.addEventListener(eventName, () => {
                this.enforceNumericLancementInput();
            });
        });
    }

    setupEventListeners() {
        if (this.lancementInput) {
            // Validation du code de lancement en temps réel avec auto-vérification
            this.lancementInput.addEventListener('input', () => this.handleLancementInput());
            
            // Forcer le clavier numérique et interdire les caractères non numériques
            this.lancementInput.addEventListener('keydown', (event) => this.handleLancementKeydown(event));
            this.lancementInput.addEventListener('paste', (event) => this.handleLancementPaste(event));
        }
        
        // Contrôles de lancement
        if (this.startBtn) this.startBtn.addEventListener('click', () => this.handleStart());
        if (this.pauseBtn) this.pauseBtn.addEventListener('click', () => this.handlePause());
        if (this.stopBtn) this.stopBtn.addEventListener('click', () => this.handleStop());
        
        // Bouton actualiser historique
        if (this.refreshHistoryBtn) this.refreshHistoryBtn.addEventListener('click', () => this.loadOperatorHistory());
        
        // Gestion des commentaires
        if (this.commentInput) this.commentInput.addEventListener('input', () => this.handleCommentInput());
        if (this.addCommentBtn) this.addCommentBtn.addEventListener('click', () => this.handleAddComment());
        
        // Gestion du scanner
        if (this.scanBarcodeBtn) {
            this.scanBarcodeBtn.addEventListener('click', () => this.openScanner());
            this.scanBarcodeBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.openScanner();
            });
        }
        
        if (this.closeScannerBtn) {
            this.closeScannerBtn.addEventListener('click', () => this.closeScanner());
        }
        
        // Fermer le scanner en cliquant en dehors ou avec Escape
        if (this.scannerModal) {
            this.scannerModal.addEventListener('click', (e) => {
                if (e.target === this.scannerModal) {
                    this.closeScanner();
                }
            });
        }

        // Gestion FSOP
        if (this.fsopBtn) {
            this.fsopBtn.addEventListener('click', () => this.openFsopModal());
            this.fsopBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.openFsopModal();
            });
        }

        if (this.closeFsopBtn) {
            this.closeFsopBtn.addEventListener('click', () => this.closeFsopModal());
        }

        if (this.fsopModal) {
            this.fsopModal.addEventListener('click', (e) => {
                if (e.target === this.fsopModal) {
                    this.closeFsopModal();
                }
            });
        }

        if (this.openFsopWordBtn) {
            this.openFsopWordBtn.addEventListener('click', () => this.handleOpenFsopWord());
        }

        if (this.openFsopFormBtn) {
            this.openFsopFormBtn.addEventListener('click', () => this.handleOpenFsopForm());
        }

        if (this.generateFsopLotBtn) {
            this.generateFsopLotBtn.addEventListener('click', () => this.handleGenerateFsopLots());
        }

        if (this.closeFsopFormBtn) {
            this.closeFsopFormBtn.addEventListener('click', () => this.closeFsopFormModal());
        }

        const closeFsopFormBtn2 = document.getElementById('closeFsopFormBtn2');
        if (closeFsopFormBtn2) {
            closeFsopFormBtn2.addEventListener('click', () => this.closeFsopFormModal());
        }

        if (this.fsopFormModal) {
            this.fsopFormModal.addEventListener('click', (e) => {
                if (e.target === this.fsopFormModal) {
                    this.closeFsopFormModal();
                }
            });
        }

        if (this.fsopFormSaveBtn) {
            this.fsopFormSaveBtn.addEventListener('click', () => this.handleSaveFsopForm());
        }

        // Validation automatique du numéro de série
        console.log('🔍 [SETUP] Vérification fsopSerialNumberInput:', !!this.fsopSerialNumberInput);
        if (this.fsopSerialNumberInput) {
            console.log('✅ [SETUP] Ajout des event listeners pour la validation du numéro de série');
            // Debounce pour éviter trop de requêtes
            let validationTimeout = null;
            this.fsopSerialNumberInput.addEventListener('input', () => {
                console.log('🔍 [VALIDATION] Saisie détectée dans le champ numéro de série');
                clearTimeout(validationTimeout);
                validationTimeout = setTimeout(() => {
                    console.log('🔍 [VALIDATION] Déclenchement validation automatique (après 800ms de pause)');
                    this.validateSerialNumber();
                }, 800); // Attendre 800ms après la dernière saisie
            });

            // Valider aussi quand l'utilisateur quitte le champ
            this.fsopSerialNumberInput.addEventListener('blur', () => {
                console.log('🔍 [VALIDATION] Champ numéro de série quitté (blur) - validation immédiate');
                clearTimeout(validationTimeout);
                this.validateSerialNumber();
            });
            console.log('✅ [SETUP] Event listeners ajoutés avec succès');
        } else {
            console.error('❌ [SETUP] fsopSerialNumberInput introuvable - les listeners de validation ne seront pas ajoutés');
            // Essayer de trouver l'élément plus tard (si la modal est chargée dynamiquement)
            setTimeout(() => {
                const serialInput = document.getElementById('fsopSerialNumber');
                if (serialInput) {
                    console.log('✅ [SETUP RETRY] fsopSerialNumberInput trouvé après délai, ajout des listeners');
                    this.fsopSerialNumberInput = serialInput;
                    let validationTimeout = null;
                    serialInput.addEventListener('input', () => {
                        console.log('🔍 [VALIDATION] Saisie détectée dans le champ numéro de série');
                        clearTimeout(validationTimeout);
                        validationTimeout = setTimeout(() => {
                            console.log('🔍 [VALIDATION] Déclenchement validation automatique (après 800ms de pause)');
                            this.validateSerialNumber();
                        }, 800);
                    });
                    serialInput.addEventListener('blur', () => {
                        console.log('🔍 [VALIDATION] Champ numéro de série quitté (blur) - validation immédiate');
                        clearTimeout(validationTimeout);
                        this.validateSerialNumber();
                    });
                }
            }, 1000);
        }

        // Fermer les modals avec Escape (scanner + FSOP)
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') {
                return;
            }
            if (this.scannerModal && this.scannerModal.style.display === 'flex') {
                this.closeScanner();
            }
            if (this.fsopModal && this.fsopModal.style.display === 'flex') {
                this.closeFsopModal();
            }
            if (this.fsopFormModal && this.fsopFormModal.style.display === 'flex') {
                this.closeFsopFormModal();
            }
        });
    }

    getCurrentLaunchNumberForFsop() {
        const fromCurrent = this.currentLancement?.CodeLancement;
        const fromInput = this.lancementInput?.value?.trim();
        const value = (fromCurrent || fromInput || '').toUpperCase();
        return /^LT\d{7,8}$/.test(value) ? value : null;
    }

    openFsopModal() {
        if (!this.fsopModal) {
            this.notificationManager.error('FSOP indisponible (éléments UI manquants)');
            return;
        }

        const lt = this.getCurrentLaunchNumberForFsop();
        if (!lt) {
            this.notificationManager.warning('Saisissez un LT valide avant d’ouvrir FSOP');
            return;
        }

        this.fsopModal.style.display = 'flex';

        // Charger les lots ERP en arrière-plan (n'affiche rien si erreur)
        this.loadFsopLotsForLaunch(lt).catch(() => {});
        
        // Réattacher les listeners si l'élément n'était pas trouvé au démarrage
        if (!this.fsopSerialNumberInput) {
            console.log('🔍 [MODAL OPEN] fsopSerialNumberInput introuvable, recherche...');
            this.fsopSerialNumberInput = document.getElementById('fsopSerialNumber');
            if (this.fsopSerialNumberInput) {
                console.log('✅ [MODAL OPEN] fsopSerialNumberInput trouvé, ajout des listeners');
                let validationTimeout = null;
                this.fsopSerialNumberInput.addEventListener('input', () => {
                    console.log('🔍 [VALIDATION] Saisie détectée dans le champ numéro de série');
                    clearTimeout(validationTimeout);
                    validationTimeout = setTimeout(() => {
                        console.log('🔍 [VALIDATION] Déclenchement validation automatique (après 800ms de pause)');
                        this.validateSerialNumber();
                    }, 800);
                });
                this.fsopSerialNumberInput.addEventListener('blur', () => {
                    console.log('🔍 [VALIDATION] Champ numéro de série quitté (blur) - validation immédiate');
                    clearTimeout(validationTimeout);
                    this.validateSerialNumber();
                });
            }
        }
        
        if (this.fsopTemplateCodeInput) {
            this.fsopTemplateCodeInput.value = this.fsopTemplateCodeInput.value?.trim() || '';
            setTimeout(() => this.fsopTemplateCodeInput.focus(), 50);
        }
    }

    closeFsopModal() {
        if (!this.fsopModal) return;
        this.fsopModal.style.display = 'none';
    }

    async handleGenerateFsopLots() {
        const lt = this.getCurrentLaunchNumberForFsop();
        if (!lt) {
            this.notificationManager.warning('Saisissez un LT valide avant de générer les lots');
            return;
        }
        await this.loadFsopLotsForLaunch(lt, { force: true });
    }

    async loadFsopLotsForLaunch(launchNumber, opts = {}) {
        const { force = false } = opts;
        if (!force && this.currentFsopLots && this.currentFsopLots.launchNumber === launchNumber) {
            this.renderFsopLots(this.currentFsopLots);
            return;
        }

        try {
            const lotsPayload = await this.apiService.getFsopLots(launchNumber);
            // Expected: { success:true, launchNumber, byRubrique:[{codeRubrique, phases, lots}] }
            this.currentFsopLots = lotsPayload;
            const pref = this.computePreferredLot(lotsPayload);
            this.currentFsopPreferredLot = pref.preferredLot;
            this.currentFsopPreferredRubrique = pref.preferredRubrique;
            this.renderFsopLots(lotsPayload);
        } catch (err) {
            console.warn('⚠️ Impossible de récupérer les lots FSOP:', err?.message || err);
            this.currentFsopLots = null;
            this.currentFsopPreferredLot = null;
            this.currentFsopPreferredRubrique = null;
            if (this.fsopLotGroup) this.fsopLotGroup.style.display = 'none';
        }
    }

    getSelectedCodeRubriqueForOperation() {
        // Best-effort: if the operator UI has a step selector, prefer its CodeRubrique.
        const sel = document.getElementById('operationStepSelect');
        if (!sel) return null;
        const raw = String(sel.value || '').trim();
        if (!raw) return null;
        // StepId format we use elsewhere: "Phase|CodeRubrique"
        const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) return parts[1] || null;
        // fallback: sometimes value could be just CodeRubrique
        if (/^\d{3}$/.test(raw)) return raw;
        return null;
    }

    hideOperationSteps() {
        if (this.operationStepGroup) this.operationStepGroup.style.display = 'none';
        if (this.operationStepSelect) {
            this.operationStepSelect.innerHTML = '<option value="">Choisir une étape (Phase)</option>';
        }
    }

    renderOperationSteps(payload) {
        const steps = Array.isArray(payload?.steps) ? payload.steps : [];
        if (!this.operationStepGroup || !this.operationStepSelect) return;
        if (!steps.length) {
            this.hideOperationSteps();
            return;
        }

        // Dédoublonner par StepId (Phase|CodeRubrique)
        const byId = new Map();
        for (const s of steps) {
            const id = String(s?.StepId || '').trim();
            if (!id) continue;
            if (byId.has(id)) continue;
            const label = String(s?.Label || '').trim() || id;
            byId.set(id, { id, label });
        }

        const items = Array.from(byId.values());
        if (items.length <= 1) {
            this.hideOperationSteps();
            return;
        }

        // Trier par phase (numérique si possible)
        items.sort((a, b) => {
            const pa = Number(String(a.id.split('|')[0] || '').trim());
            const pb = Number(String(b.id.split('|')[0] || '').trim());
            if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
            return a.label.localeCompare(b.label);
        });

        this.operationStepSelect.innerHTML =
            '<option value="">Choisir une étape (Phase)</option>' +
            items.map(it => `<option value="${this.escapeHtml(it.id)}">${this.escapeHtml(it.label)}</option>`).join('');

        this.operationStepGroup.style.display = 'block';
    }

    async loadOperationStepsForLaunch(lancementCode) {
        const code = String(lancementCode || '').trim().toUpperCase();
        if (!/^LT\d{7,8}$/.test(code)) {
            this.hideOperationSteps();
            return;
        }
        try {
            const payload = await this.apiService.getLancementSteps(code);
            this.renderOperationSteps(payload);
        } catch (e) {
            // Non bloquant: si l'API ne répond pas, on cache juste le select
            this.hideOperationSteps();
        }
    }

    /**
     * Calcule les initiales d'un opérateur
     * @param {Object} op - Opérateur avec nom, code, id
     * @returns {string} Initiales calculées
     */
    calculateOperatorInitials(op) {
        const nom = String(op.nom || '').trim();
        const words = nom.split(/\s+/).filter(w => w.length > 0);
        let initials = '';
        
        if (words.length === 0) {
            // Fallback: use code if no name
            initials = String(op.code || op.id || '').substring(0, 2).toUpperCase();
        } else if (words.length === 1) {
            // Single word: use first 2 letters
            initials = words[0].substring(0, 2).toUpperCase();
        } else {
            // Multiple words: first letter of first + first letter of last
            initials = (words[0][0] + words[words.length - 1][0]).toUpperCase();
        }
        
        return initials;
    }

    /**
     * Charge les opérateurs et calcule leurs initiales pour les menus déroulants FSOP
     * @returns {Promise<Array>} Liste d'options { initials, label }
     */
    async loadOperatorsForFsop() {
        // Use cache if available
        if (this.cachedOperators) {
            return this.cachedOperators;
        }

        try {
            const operators = await this.apiService.getAllOperators();
            
            // Create a map to avoid duplicates
            const operatorMap = new Map();
            
            // Add all operators from API
            operators.forEach(op => {
                const code = String(op.code || op.id || '').trim();
                if (!code) return;
                
                const initials = this.calculateOperatorInitials(op);
                const nom = String(op.nom || '').trim();
                const label = `${initials} — ${nom} (${code})`;
                
                operatorMap.set(code, {
                    initials: initials,
                    label: label,
                    code: code,
                    nom: nom
                });
            });
            
            // IMPORTANT: Always include the currently connected operator, even if not in API list
            if (this.operator) {
                const currentCode = String(this.operator.code || this.operator.id || '').trim();
                const currentNom = String(this.operator.nom || this.operator.name || '').trim();
                
                if (currentCode && !operatorMap.has(currentCode)) {
                    // Current operator not in list, add it
                    const initials = this.calculateOperatorInitials(this.operator);
                    const label = `${initials} — ${currentNom} (${currentCode})`;
                    
                    operatorMap.set(currentCode, {
                        initials: initials,
                        label: label,
                        code: currentCode,
                        nom: currentNom
                    });
                } else if (currentCode && operatorMap.has(currentCode)) {
                    // Current operator is in list, but ensure it uses the correct name from this.operator
                    const existing = operatorMap.get(currentCode);
                    if (currentNom && currentNom !== existing.nom) {
                        // Update with current operator's name (might be more complete)
                        const initials = this.calculateOperatorInitials(this.operator);
                        const label = `${initials} — ${currentNom} (${currentCode})`;
                        operatorMap.set(currentCode, {
                            initials: initials,
                            label: label,
                            code: currentCode,
                            nom: currentNom
                        });
                    }
                }
            }
            
            // Convert map to array and sort by initials
            const operatorOptions = Array.from(operatorMap.values());
            operatorOptions.sort((a, b) => a.initials.localeCompare(b.initials));
            
            // Cache the result
            this.cachedOperators = operatorOptions;
            
            console.log(`✅ ${operatorOptions.length} opérateurs chargés pour FSOP (incluant opérateur connecté: ${this.operator?.code || this.operator?.id || 'N/A'})`);
            
            return operatorOptions;
        } catch (error) {
            console.error('Erreur lors du chargement des opérateurs:', error);
            
            // Fallback: if API fails, at least return the current operator
            if (this.operator) {
                const initials = this.calculateOperatorInitials(this.operator);
                const nom = String(this.operator.nom || this.operator.name || '').trim();
                const code = String(this.operator.code || this.operator.id || '').trim();
                const label = `${initials} — ${nom} (${code})`;
                
                return [{
                    initials: initials,
                    label: label,
                    code: code,
                    nom: nom
                }];
            }
            
            // Return empty array on error (form can still work without operator dropdown)
            return [];
        }
    }

    computePreferredLot(payload) {
        const result = { preferredLot: null, preferredRubrique: null };
        if (!payload || payload.success === false) return result;

        const uniqueLots = Array.isArray(payload.uniqueLots) ? payload.uniqueLots.filter(Boolean) : [];
        const items = Array.isArray(payload.items) ? payload.items : [];

        if (uniqueLots.length === 1) {
            result.preferredLot = String(uniqueLots[0]).trim();
            return result;
        }

        const rubrique = this.getSelectedCodeRubriqueForOperation();
        if (rubrique) {
            const match = items.find(it => String(it?.codeRubrique || '').trim() === rubrique);
            const lots = Array.isArray(match?.lots) ? match.lots.filter(Boolean) : [];
            // Only auto-select if unambiguous (exactly 1 lot for that rubrique)
            if (lots.length === 1) {
                result.preferredRubrique = rubrique;
                result.preferredLot = String(lots[0]).trim();
                return result;
            }
        }

        // IMPORTANT: do not auto-fill when ambiguous (multiple lots)
        // User can click/copy from the ERP list if needed.
        return result;
    }

    renderFsopLots(payload) {
        if (!this.fsopLotGroup || !this.fsopLotList) return;
        // Backend: { success, launchNumber, uniqueLots, items:[{codeRubrique, phases, lots}] }
        const groups = Array.isArray(payload?.items) ? payload.items : [];
        if (!payload || payload.success === false || groups.length === 0) {
            this.fsopLotGroup.style.display = 'none';
            this.fsopLotList.innerHTML = '';
            return;
        }

        let html = '<div class="fsop-lots-panel">';
        const prefInfo = this.currentFsopPreferredLot
            ? `auto: ${this.escapeHtml(this.currentFsopPreferredLot)}${this.currentFsopPreferredRubrique ? ` (rubrique ${this.escapeHtml(this.currentFsopPreferredRubrique)})` : ''}`
            : 'auto: par composant (si non ambigu)';

        // Repliable pour éviter que la liste prenne toute la hauteur de la modal
        html += `
            <details class="fsop-lots-details">
                <summary class="fsop-lots-summary">
                    <span><strong>Lots (ERP)</strong></span>
                    <span class="fsop-lots-summary-auto">${prefInfo}</span>
                    <span class="fsop-lots-summary-hint">Afficher / Masquer</span>
                </summary>
                <div class="fsop-lots-body">
        `;

        groups.forEach((g) => {
            const codeRubrique = g.codeRubrique || '';
            const phases = Array.isArray(g.phases) ? g.phases.join(', ') : '';
            const lots = Array.isArray(g.lots) ? g.lots : [];
            html += `<div class="fsop-lots-group">`;
            html += `<div class="fsop-lots-group-header"><span class="fsop-lots-rubrique">${this.escapeHtml(codeRubrique)}</span>${phases ? ` <span class="fsop-lots-phases">(${this.escapeHtml(phases)})</span>` : ''}</div>`;
            html += `<div class="fsop-lots-chips">`;
            lots.forEach((lot) => {
                const safe = String(lot || '').trim();
                if (!safe) return;
                html += `<button type="button" class="fsop-lot-chip" data-lot="${this.escapeHtml(safe)}">${this.escapeHtml(safe)}</button>`;
            });
            html += `</div></div>`;
        });

        html += '<div class="fsop-lots-hint">Astuce: colle une liste (1 lot par ligne) dans la 1ère case “Lot” du tableau → remplissage automatique vers le bas.</div>';
        html += `
                </div>
            </details>
        `;
        html += '</div>';

        this.fsopLotList.innerHTML = html;
        this.fsopLotGroup.style.display = 'flex';

        // Copy-on-click behavior
        this.fsopLotList.querySelectorAll('button.fsop-lot-chip[data-lot]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const lot = btn.getAttribute('data-lot') || '';
                if (!lot) return;
                try {
                    await navigator.clipboard.writeText(lot);
                    this.notificationManager.success(`Lot copié: ${lot}`, 1500);
                } catch (_) {
                    // fallback
                    const ta = document.createElement('textarea');
                    ta.value = lot;
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    ta.remove();
                    this.notificationManager.success(`Lot copié: ${lot}`, 1500);
                }
            });
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    }

    parseFilenameFromContentDisposition(contentDisposition) {
        if (!contentDisposition) return null;
        // Typical: attachment; filename="FSOP_F469_SN123_LT2501132.docx"
        const match = /filename\*?=(?:UTF-8''|")?([^\";]+)"?/i.exec(contentDisposition);
        if (!match) return null;
        try {
            return decodeURIComponent(match[1]);
        } catch (_) {
            return match[1];
        }
    }

    async handleOpenFsopWord() {
        const lt = this.getCurrentLaunchNumberForFsop();
        const templateCode = (this.fsopTemplateCodeInput?.value || '').trim().toUpperCase();
        const serialNumber = (this.fsopSerialNumberInput?.value || '').trim();

        if (!lt) {
            this.notificationManager.error('LT invalide');
            return;
        }
        if (!/^F\d{3}$/.test(templateCode)) {
            this.notificationManager.error('Numéro de formulaire invalide (ex: F469)');
            return;
        }
        if (!serialNumber) {
            this.notificationManager.error('Numéro de série obligatoire');
            return;
        }

        // Valider le numéro de série avant de continuer
        console.log('🔍 [VALIDATION OBLIGATOIRE] Validation du numéro de série avant ouverture du document Word');
        console.log('🔍 [VALIDATION OBLIGATOIRE] LT:', lt, '| SN:', serialNumber);
        try {
            const endpoint = `${this.apiService.baseUrl}/fsop/validate-serial`;
            console.log('🔍 [VALIDATION OBLIGATOIRE] Appel API:', endpoint);
            
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    launchNumber: lt,
                    serialNumber: serialNumber
                })
            });

            const data = await res.json();
            console.log('🔍 [VALIDATION OBLIGATOIRE] Réponse API:', data);

            if (!res.ok || !data.exists) {
                // Numéro non trouvé - empêcher de continuer
                console.log('❌ [VALIDATION OBLIGATOIRE] Numéro NON trouvé - ouverture du document Word BLOQUÉE');
                this.notificationManager.error(data.message || 'Le numéro de série doit être créé au préalable dans le fichier mesure avant de continuer.');
                return;
            }

            // Numéro trouvé - continuer normalement
            console.log('✅ [VALIDATION OBLIGATOIRE] Numéro trouvé - ouverture du document Word autorisée');
        } catch (error) {
            console.error('❌ [VALIDATION OBLIGATOIRE] Erreur lors de la validation:', error);
            this.notificationManager.error('Erreur lors de la validation du numéro de série. Veuillez réessayer.');
            return;
        }

        const endpoint = `${this.apiService.baseUrl}/fsop/open`;

        const originalHtml = this.openFsopWordBtn?.innerHTML;
        if (this.openFsopWordBtn) {
            this.openFsopWordBtn.disabled = true;
            this.openFsopWordBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération...';
        }

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    launchNumber: lt,
                    templateCode,
                    serialNumber
                })
            });

            if (!res.ok) {
                let errorData = null;
                try {
                    errorData = await res.json();
                } catch (_) {
                    // Ignore JSON parse errors
                }
                
                if (res.status === 503) {
                    this.notificationManager.error('Traçabilité indisponible (partage réseau non monté).');
                } else if (res.status === 422) {
                    if (errorData?.error === 'LT_DIR_NOT_FOUND') {
                        this.notificationManager.error(`Dossier LT introuvable: ${lt} (recherche dans X:/Tracabilite).`);
                    } else {
                        this.notificationManager.error(`Dossier absent: X:/Tracabilite/${lt}/FSOP (stop).`);
                    }
                } else if (res.status === 404) {
                    const errorMsg = errorData?.message || errorData?.hint || `Template ${templateCode} introuvable`;
                    this.notificationManager.error(`Template absent dans FSOP: ${errorMsg}`);
                } else if (res.status === 400) {
                    this.notificationManager.error('Champs FSOP invalides');
                } else {
                    this.notificationManager.error(`Erreur FSOP (HTTP ${res.status})`);
                }
                return;
            }

            const contentDisposition = res.headers.get('content-disposition');
            const filename = this.parseFilenameFromContentDisposition(contentDisposition)
                || `FSOP_${templateCode}_${serialNumber}_${lt}.docx`;

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            this.notificationManager.success('FSOP téléchargé');
            this.closeFsopModal();
        } catch (error) {
            console.error('Erreur FSOP:', error);
            this.notificationManager.error('Erreur de connexion lors de l’ouverture FSOP');
        } finally {
            if (this.openFsopWordBtn) {
                this.openFsopWordBtn.disabled = false;
                this.openFsopWordBtn.innerHTML = originalHtml || '<i class="fas fa-download"></i> Ouvrir FSOP (Word)';
            }
        }
    }

    async validateSerialNumber() {
        console.log('🔍 [VALIDATION] === DÉBUT validateSerialNumber ===');
        const lt = this.getCurrentLaunchNumberForFsop();
        const serialNumber = (this.fsopSerialNumberInput?.value || '').trim();

        console.log('🔍 [VALIDATION] LT:', lt, '| SN:', serialNumber);

        if (!lt || !serialNumber) {
            console.log('⚠️ [VALIDATION] Validation annulée - LT ou SN manquant');
            return; // Pas de validation si les champs ne sont pas remplis
        }

        try {
            const endpoint = `${this.apiService.baseUrl}/fsop/validate-serial`;
            console.log('🔍 [VALIDATION] Appel API:', endpoint, 'avec LT:', lt, 'SN:', serialNumber);
            
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    launchNumber: lt,
                    serialNumber: serialNumber
                })
            });

            const data = await res.json();
            console.log('🔍 [VALIDATION] Réponse API:', data);

            if (res.ok && data.exists) {
                // Numéro trouvé - afficher un message de succès discret
                console.log('✅ [VALIDATION] Numéro de série trouvé dans le fichier mesure');
                this.notificationManager.success(`Numéro de série validé dans le fichier mesure`, 3000);
            } else {
                // Numéro non trouvé - afficher un avertissement
                console.log('❌ [VALIDATION] Numéro de série NON trouvé dans le fichier mesure');
                this.notificationManager.warning(data.message || 'Numéro de série non trouvé dans le fichier mesure', 5000);
            }
        } catch (error) {
            console.error('❌ [VALIDATION] Erreur lors de la validation du numéro de série:', error);
            // Ne pas afficher d'erreur pour ne pas perturber l'utilisateur
        }
        console.log('🔍 [VALIDATION] === FIN validateSerialNumber ===');
    }

    async handleOpenFsopForm() {
        const lt = this.getCurrentLaunchNumberForFsop();
        const templateCode = (this.fsopTemplateCodeInput?.value || '').trim().toUpperCase();
        const serialNumber = (this.fsopSerialNumberInput?.value || '').trim();

        if (!lt) {
            this.notificationManager.error('LT invalide');
            return;
        }
        if (!/^F\d{3}$/.test(templateCode)) {
            this.notificationManager.error('Numéro de formulaire invalide (ex: F469)');
            return;
        }
        if (!serialNumber) {
            this.notificationManager.error('Numéro de série obligatoire');
            return;
        }

        // Valider le numéro de série avant de continuer
        console.log('🔍 [VALIDATION OBLIGATOIRE] Validation du numéro de série avant ouverture du formulaire FSOP');
        console.log('🔍 [VALIDATION OBLIGATOIRE] LT:', lt, '| SN:', serialNumber);
        try {
            const endpoint = `${this.apiService.baseUrl}/fsop/validate-serial`;
            console.log('🔍 [VALIDATION OBLIGATOIRE] Appel API:', endpoint);
            
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    launchNumber: lt,
                    serialNumber: serialNumber
                })
            });

            const data = await res.json();
            console.log('🔍 [VALIDATION OBLIGATOIRE] Réponse API:', data);

            if (!res.ok || !data.exists) {
                // Numéro non trouvé - empêcher de continuer
                console.log('❌ [VALIDATION OBLIGATOIRE] Numéro NON trouvé - ouverture du formulaire BLOQUÉE');
                this.notificationManager.error(data.message || 'Le numéro de série doit être créé au préalable dans le fichier mesure avant de continuer.');
                return;
            }

            // Numéro trouvé - continuer normalement
            console.log('✅ [VALIDATION OBLIGATOIRE] Numéro trouvé - ouverture du formulaire autorisée');
            this.notificationManager.success(`Numéro de série validé`, 2000);
        } catch (error) {
            console.error('❌ [VALIDATION OBLIGATOIRE] Erreur lors de la validation:', error);
            this.notificationManager.error('Erreur lors de la validation du numéro de série. Veuillez réessayer.');
            return;
        }

        // Charger les lots ERP maintenant (important: l'opérateur peut cliquer très vite après ouverture)
        try {
            await this.loadFsopLotsForLaunch(lt, { force: true });
        } catch (_) {
            // ignore: lots are optional, form can still open
        }

        // Recalculer le lot préféré après chargement (et selon l'étape éventuellement sélectionnée)
        const pref = this.computePreferredLot(this.currentFsopLots);
        this.currentFsopPreferredLot = pref.preferredLot;
        this.currentFsopPreferredRubrique = pref.preferredRubrique;

        // Fermer la modal FSOP initiale
        this.closeFsopModal();

        // Afficher la modal du formulaire
        if (!this.fsopFormModal) {
            this.notificationManager.error('Modal formulaire FSOP introuvable');
            return;
        }

        this.fsopFormModal.style.display = 'flex';

        // Initialiser le formulaire
        if (!this.fsopForm) {
            this.fsopForm = new FsopForm(this.apiService, this.notificationManager);
        }

        // Afficher un loader
        if (this.fsopFormContainer) {
            this.fsopFormContainer.innerHTML = '<div class="fsop-loading"><i class="fas fa-spinner fa-spin"></i> Chargement du formulaire...</div>';
        }

        try {
            // Charger la structure du template
            await this.fsopForm.loadStructure(templateCode);

            // Charger les opérateurs pour les menus déroulants
            const operatorOptions = await this.loadOperatorsForFsop();

            // Essayer de charger les données sauvegardées si elles existent
            let savedFormData = null;
            try {
                const loadDataResponse = await this.apiService.loadFsopData(lt, templateCode, serialNumber);
                if (loadDataResponse.success && loadDataResponse.hasData && loadDataResponse.formData) {
                    savedFormData = loadDataResponse.formData;
                    console.log('✅ Données sauvegardées chargées pour continuer le formulaire');
                    this.notificationManager.info('Formulaire existant chargé - vous pouvez continuer', 3000);
                }
            } catch (loadError) {
                console.warn('⚠️ Impossible de charger les données sauvegardées (non bloquant):', loadError);
                // Continue without saved data
            }

            // Pré-remplir avec LT et SN, et fusionner avec les données sauvegardées si disponibles
            const initialData = {
                placeholders: {
                    '{{LT}}': lt,
                    '{{SN}}': serialNumber,
                    ...(savedFormData?.placeholders || {})
                },
                launchNumber: lt, // Also pass as separate field for direct access
                serialNumber: serialNumber, // Also pass as separate field for direct access
                fsopLots: this.currentFsopLots || null,
                preferredLot: this.currentFsopPreferredLot || null,
                preferredRubrique: this.currentFsopPreferredRubrique || null,
                operatorOptions: operatorOptions, // Pass operator options for dropdowns
                tables: savedFormData?.tables || {},
                wordlikeTables: savedFormData?.wordlikeTables || {},
                passFail: savedFormData?.passFail || {},
                checkboxes: savedFormData?.checkboxes || {},
                textFields: savedFormData?.textFields || {},
                reference: savedFormData?.reference || ''
            };

            // Rendre le formulaire
            if (this.fsopFormContainer) {
                this.fsopForm.render(this.fsopFormContainer, initialData);
            }

            // Stocker les valeurs pour la sauvegarde
            this.currentFsopData = {
                launchNumber: lt,
                templateCode: templateCode,
                serialNumber: serialNumber
            };

        } catch (error) {
            console.error('Erreur lors du chargement du formulaire:', error);
            this.notificationManager.error('Impossible de charger le formulaire FSOP');
            this.closeFsopFormModal();
        }
    }

    /**
     * Affiche une modal de confirmation pour remplacer les valeurs existantes dans Excel
     * @param {Object} existingValues - Objet avec les valeurs existantes { tagName: { existing, new, location } }
     * @returns {Promise<boolean>} true si l'utilisateur confirme, false sinon
     */
    async showExcelReplaceConfirmation(existingValues) {
        return new Promise((resolve) => {
            // Créer la modal
            const modal = document.createElement('div');
            modal.className = 'fsop-confirm-modal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            `;

            // Créer le contenu de la modal
            const modalContent = document.createElement('div');
            modalContent.style.cssText = `
                background: white;
                padding: 2rem;
                border-radius: 8px;
                max-width: 600px;
                max-height: 80vh;
                overflow-y: auto;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            `;

            // Construire la liste des valeurs à remplacer
            let valuesListHtml = '<table style="width: 100%; border-collapse: collapse; margin: 1rem 0;">';
            valuesListHtml += '<thead><tr style="background: #f5f5f5;"><th style="padding: 0.5rem; text-align: left; border-bottom: 2px solid #ddd;">Champ</th><th style="padding: 0.5rem; text-align: left; border-bottom: 2px solid #ddd;">Valeur actuelle</th><th style="padding: 0.5rem; text-align: left; border-bottom: 2px solid #ddd;">Nouvelle valeur</th></tr></thead><tbody>';
            
            for (const [tagName, data] of Object.entries(existingValues)) {
                valuesListHtml += `
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 0.5rem;"><strong>${tagName}</strong></td>
                        <td style="padding: 0.5rem; color: #d32f2f;">${this.escapeHtml(String(data.existing))}</td>
                        <td style="padding: 0.5rem; color: #1976d2;">${this.escapeHtml(String(data.new))}</td>
                    </tr>
                `;
            }
            
            valuesListHtml += '</tbody></table>';

            modalContent.innerHTML = `
                <h2 style="margin-top: 0; color: #d32f2f;">
                    <i class="fas fa-exclamation-triangle"></i> Valeurs existantes détectées
                </h2>
                <p style="margin: 1rem 0;">
                    Certaines cellules Excel contiennent déjà des valeurs. Voulez-vous les remplacer ?
                </p>
                ${valuesListHtml}
                <div style="margin-top: 1.5rem; display: flex; gap: 1rem; justify-content: flex-end;">
                    <button id="confirmCancelBtn" style="padding: 0.75rem 1.5rem; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">
                        Annuler (conserver les valeurs actuelles)
                    </button>
                    <button id="confirmReplaceBtn" style="padding: 0.75rem 1.5rem; background: #d32f2f; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Remplacer
                    </button>
                </div>
            `;

            modal.appendChild(modalContent);
            document.body.appendChild(modal);

            // Gérer les clics
            const cancelBtn = modalContent.querySelector('#confirmCancelBtn');
            const replaceBtn = modalContent.querySelector('#confirmReplaceBtn');

            const cleanup = () => {
                document.body.removeChild(modal);
            };

            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(false);
            });

            replaceBtn.addEventListener('click', () => {
                cleanup();
                resolve(true);
            });

            // Fermer avec Escape
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    cleanup();
                    document.removeEventListener('keydown', handleEscape);
                    resolve(false);
                }
            };
            document.addEventListener('keydown', handleEscape);
        });
    }

    /**
     * Échapper le HTML pour éviter les injections
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    closeFsopFormModal() {
        if (!this.fsopFormModal) return;
        this.fsopFormModal.style.display = 'none';
        if (this.fsopFormContainer) {
            this.fsopFormContainer.innerHTML = '';
        }
    }

    async handleSaveFsopForm() {
        if (!this.fsopForm || !this.currentFsopData) {
            this.notificationManager.error('Formulaire non initialisé');
            return;
        }

        // Valider le formulaire
        const validation = this.fsopForm.validate();
        if (!validation.valid) {
            this.notificationManager.error(validation.errors.join(', '));
            return;
        }

        // Récupérer les données
        const formData = this.fsopForm.getFormData();

        // Désactiver le bouton
        const originalHtml = this.fsopFormSaveBtn?.innerHTML;
        if (this.fsopFormSaveBtn) {
            this.fsopFormSaveBtn.disabled = true;
            this.fsopFormSaveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sauvegarde...';
        }

        try {
            const response = await this.apiService.post('/fsop/save', {
                launchNumber: this.currentFsopData.launchNumber,
                templateCode: this.currentFsopData.templateCode,
                serialNumber: this.currentFsopData.serialNumber,
                formData: formData,
                forceReplace: this.pendingForceReplace || false
            });

            // Réinitialiser le flag de remplacement forcé
            this.pendingForceReplace = false;

            // Vérifier si des valeurs existantes nécessitent une confirmation
            if (response.excelUpdate && response.excelUpdate.needsConfirmation && response.excelUpdate.existingValues) {
                // Réactiver le bouton pendant la confirmation
                if (this.fsopFormSaveBtn) {
                    this.fsopFormSaveBtn.disabled = false;
                    this.fsopFormSaveBtn.innerHTML = originalHtml || 'Sauvegarder';
                }
                
                const confirmed = await this.showExcelReplaceConfirmation(response.excelUpdate.existingValues);
                if (confirmed) {
                    // Relancer la sauvegarde avec forceReplace
                    this.pendingForceReplace = true;
                    return this.handleSaveFsopForm(); // Réessayer avec forceReplace
                } else {
                    // L'utilisateur a annulé, sauvegarder quand même le FSOP mais sans mettre à jour Excel
                    this.notificationManager.warning('FSOP sauvegardé mais Excel non mis à jour (valeurs existantes conservées)');
                    this.closeFsopFormModal();
                    return;
                }
            }

            let successMessage = 'FSOP sauvegardé avec succès';
            if (response.excelUpdate) {
                if (response.excelUpdate.success) {
                    successMessage += ` | ${response.excelUpdate.message}`;
                    if (response.excelUpdate.updated > 0) {
                        successMessage += ` (${response.excelUpdate.updated} mesure(s) transférée(s))`;
                    }
                } else {
                    successMessage += ` | ⚠️ ${response.excelUpdate.message}`;
                }
            }
            
            this.notificationManager.success(successMessage);
            this.closeFsopFormModal();
        } catch (error) {
            console.error('Erreur lors de la sauvegarde:', error);
            
            // Extract error message from the error object
            let errorMessage = 'Erreur lors de la sauvegarde du FSOP';
            
            // Use errorCode if available (from enhanced ApiService)
            if (error.errorCode) {
                switch (error.errorCode) {
                    case 'LT_DIR_NOT_FOUND':
                        const launchNumber = error.errorData?.launchNumber || this.currentFsopData?.launchNumber || 'N/A';
                        const traceRoot = error.errorData?.traceRoot || 'X:\\Tracabilite';
                        errorMessage = `Dossier LT introuvable: ${launchNumber}`;
                        if (error.errorData?.message) {
                            errorMessage += `. ${error.errorData.message}`;
                        } else {
                            errorMessage += `. Vérifiez que le répertoire existe dans ${traceRoot}`;
                        }
                        if (error.errorData?.hint) {
                            errorMessage += ` (${error.errorData.hint})`;
                        }
                        break;
                    case 'TRACEABILITY_UNAVAILABLE':
                        errorMessage = error.errorData?.message || 'Partage réseau de traçabilité non accessible. Vérifiez la connexion réseau.';
                        break;
                    case 'TEMPLATE_NOT_FOUND':
                        errorMessage = error.errorData?.message || `Template introuvable: ${this.currentFsopData?.templateCode || 'N/A'}`;
                        break;
                    case 'INPUT_INVALID':
                        errorMessage = 'Données invalides. Vérifiez le numéro de lancement, le code template et le numéro de série.';
                        break;
                    case 'FSOP_DIR_CREATE_FAILED':
                        errorMessage = error.errorData?.message || 'Impossible de créer le répertoire FSOP.';
                        break;
                    default:
                        errorMessage = error.message || errorMessage;
                }
            } else if (error.message) {
                // Fallback to parsing the error message string
                if (error.message.includes('LT_DIR_NOT_FOUND')) {
                    const launchNumber = this.currentFsopData?.launchNumber || 'N/A';
                    errorMessage = `Dossier LT introuvable: ${launchNumber}. Vérifiez que le répertoire existe dans le partage réseau de traçabilité.`;
                } else if (error.message.includes('TRACEABILITY_UNAVAILABLE')) {
                    errorMessage = 'Partage réseau de traçabilité non accessible. Vérifiez la connexion réseau.';
                } else if (error.message.includes('TEMPLATE_NOT_FOUND')) {
                    errorMessage = `Template introuvable: ${this.currentFsopData?.templateCode || 'N/A'}`;
                } else if (error.message.includes('INPUT_INVALID')) {
                    errorMessage = 'Données invalides. Vérifiez le numéro de lancement, le code template et le numéro de série.';
                } else {
                    errorMessage = error.message;
                }
            }
            
            this.notificationManager.error(errorMessage);
        } finally {
            if (this.fsopFormSaveBtn) {
                this.fsopFormSaveBtn.disabled = false;
                this.fsopFormSaveBtn.innerHTML = originalHtml || '<i class="fas fa-save"></i> Sauvegarder';
            }
        }
    }

    handleLancementKeydown(event) {
        if (!this.lancementInput) {
            return;
        }
        
        if (event.key === 'Enter') {
            event.preventDefault();
            this.validateAndSelectLancement();
            return;
        }
        
        // Autoriser les raccourcis clavier (copier/coller, etc.)
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        
        const navigationKeys = ['Tab', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (navigationKeys.includes(event.key)) {
            if ((event.key === 'Backspace' || event.key === 'ArrowLeft' || event.key === 'Home') &&
                this.lancementInput.selectionStart <= this.LANCEMENT_PREFIX.length) {
                event.preventDefault();
                this.setLancementCaretAfterPrefix(0);
            }
            return;
        }
        
        // Bloquer tout caractère non numérique
        if (!/^\d$/.test(event.key)) {
            event.preventDefault();
            return;
        }
        
        const digitsLength = this.getSanitizedDigitsFromValue(this.lancementInput.value).length;
        if (digitsLength >= this.MAX_LANCEMENT_DIGITS) {
            event.preventDefault();
        }
    }
    
    handleLancementPaste(event) {
        if (!this.lancementInput) {
            return;
        }
        
        event.preventDefault();
        const pastedData = (event.clipboardData || window.clipboardData).getData('text') || '';
        const digits = this.getSanitizedDigitsFromValue(pastedData);
        this.lancementInput.value = `${this.LANCEMENT_PREFIX}${digits}`;
        this.setLancementCaretAfterPrefix(digits.length);
        this.handleLancementInput();
    }
    
    getSanitizedDigitsFromValue(value = '') {
        if (!value) {
            return '';
        }
        return value.replace(/[^0-9]/g, '').slice(0, this.MAX_LANCEMENT_DIGITS);
    }
    
    enforceNumericLancementInput(restoreCaret = true) {
        if (!this.lancementInput) {
            return `${this.LANCEMENT_PREFIX}`;
        }
        
        const digits = this.getSanitizedDigitsFromValue(this.lancementInput.value);
        const sanitizedValue = `${this.LANCEMENT_PREFIX}${digits}`;
        
        if (this.lancementInput.value !== sanitizedValue) {
            this.lancementInput.value = sanitizedValue;
        }
        
        if (restoreCaret) {
            this.setLancementCaretAfterPrefix(digits.length);
        }
        
        return sanitizedValue;
    }
    
    setLancementCaretAfterPrefix(digitsLength = null) {
        if (!this.lancementInput) {
            return;
        }
        
        const length = typeof digitsLength === 'number'
            ? digitsLength
            : this.getSanitizedDigitsFromValue(this.lancementInput.value).length;
        const position = this.LANCEMENT_PREFIX.length + length;
        
        requestAnimationFrame(() => {
            this.lancementInput.setSelectionRange(position, position);
        });
    }

    handleLancementInput() {
        const code = this.enforceNumericLancementInput();
        const digitsLength = this.getSanitizedDigitsFromValue(code).length;
        
        if (digitsLength > 0) {
            // Afficher les contrôles dès qu'un code est saisi
            this.controlsSection.style.display = 'block';
            this.selectedLancement.textContent = code;
            this.lancementDetails.innerHTML = `
                <strong>Lancement: ${code}</strong><br>
                <span class="status-badge status-pending">En attente de validation</span>
            `;
            
            // Activer le bouton démarrer seulement si pas d'opération en cours
            if (!this.isRunning) {
                this.startBtn.disabled = false;
                this.startBtn.innerHTML = '<i class="fas fa-play"></i> Démarrer';
            }
            
            // Valider automatiquement le lancement si le code est complet (LT + 7/8 chiffres)
            if (/^LT\d{7,8}$/.test(code)) {
                this.validateAndSelectLancement();
            }
        } else {
            // Cacher les contrôles si le champ est vide
            if (!this.isRunning) {
                this.controlsSection.style.display = 'none';
            }
        }
    }


    async validateAndSelectLancement() {
        const code = this.lancementInput.value.trim();
        if (!code) {
            this.notificationManager.error('Veuillez saisir un code de lancement');
            return;
        }

        console.log('Validation du lancement:', code); // Debug
        
        // Afficher immédiatement les contrôles
        this.controlsSection.style.display = 'block';
        this.selectedLancement.textContent = code;
        
        try {
            // Vérifier que le lancement existe dans LCTE
            const response = await this.apiService.getLancement(code);
            const lancement = response.data;
            
            this.currentLancement = { 
                CodeLancement: code, 
                CodeArticle: lancement.CodeArticle,
                DesignationLct1: lancement.DesignationLct1,
                CodeModele: lancement.CodeModele,
                DesignationArt1: lancement.DesignationArt1,
                DesignationArt2: lancement.DesignationArt2
            };
            
            this.lancementDetails.innerHTML = `
                <strong>Lancement: ${code}</strong><br>
                <strong>Article: ${lancement.CodeArticle || 'N/A'}</strong><br>
                <strong>Désignation: ${lancement.DesignationLct1 || 'N/A'}</strong><br>
                <small>✅ Lancement validé dans LCTE - Prêt à démarrer</small>
            `;
            this.notificationManager.success('Lancement trouvé et validé dans la base de données');
            
            // Recharger les commentaires pour ce lancement
            await this.loadComments();

            // Charger les étapes (phases) si plusieurs disponibles
            await this.loadOperationStepsForLaunch(code);
            
            // Activer le bouton démarrer seulement si validation réussie
            if (!this.isRunning) {
                this.startBtn.disabled = false;
                this.startBtn.textContent = 'Démarrer';
            }
            
        } catch (error) {
            // Gérer les différents types d'erreurs
            console.error('Erreur validation lancement:', error);
            this.currentLancement = null;
            this.hideOperationSteps();
            
            if (error.status === 409) {
                // Conflit : lancement déjà en cours par un autre opérateur
                this.lancementDetails.innerHTML = `
                    <strong>Lancement: ${code}</strong><br>
                    <small style="color: red;">❌ Lancement déjà en cours par un autre opérateur</small><br>
                    <small style="color: orange;">⚠️ Contactez l'administrateur pour résoudre le conflit</small>
                `;
                this.notificationManager.error(`Conflit : ${error.message}`);
                this.startBtn.disabled = true;
                this.startBtn.textContent = 'Conflit détecté';
            } else {
                // Autres erreurs (lancement non trouvé, etc.)
                this.lancementDetails.innerHTML = `
                    <strong>Lancement: ${code}</strong><br>
                    <small>❌ Lancement non trouvé dans la base de données LCTE</small><br>
                    <small>Veuillez vérifier le code de lancement</small>
                `;
                this.notificationManager.error('Code de lancement invalide - Non trouvé dans LCTE');
                this.startBtn.disabled = true;
                this.startBtn.textContent = 'Code invalide';
            }
            
            // Vider le champ après un délai
            setTimeout(() => {
                this.lancementInput.value = '';
                this.controlsSection.style.display = 'none';
            }, 3000);
        }
    }

    async checkCurrentOperation() {
        try {
            const operatorCode = this.operator.code || this.operator.id;
            console.log(`🔍 Vérification opération en cours pour opérateur: ${operatorCode}`);
            const resp = await this.apiService.getCurrentOperation(operatorCode);
            const payload = resp?.data ?? resp; // compat selon format ApiService
            const current = payload?.data ?? payload; // backend renvoie { success, data }
            
            const lancementCode = current?.lancementCode || current?.CodeLancement || current?.CodeLanctImprod || null;
            if (lancementCode) {
                // Il y a une opération en cours
                this.currentLancement = { CodeLancement: lancementCode };
                this.lancementInput.value = lancementCode;
                this.selectedLancement.textContent = lancementCode;
                this.controlsSection.style.display = 'block';

                // Charger les étapes et pré-sélectionner l'étape si fournie
                try {
                    await this.loadOperationStepsForLaunch(lancementCode);
                    const stepId = String(current?.stepId || '').trim();
                    if (stepId && this.operationStepSelect) {
                        this.operationStepSelect.value = stepId;
                    }
                } catch (e) {
                    // Non bloquant
                }
                
                const lastEvent = current?.lastEvent || current?.Ident || current?.Statut || null;
                const status = String(current?.status || current?.Statut || '').toUpperCase();

                if (String(lastEvent).toUpperCase() === 'DEBUT' || status === 'EN_COURS') {
                    // Opération en cours
                    this.resumeRunningOperation(current);
                } else if (String(lastEvent).toUpperCase() === 'PAUSE' || status === 'EN_PAUSE') {
                    // Opération en pause
                    this.resumePausedOperation(current);
                }
            }
        } catch (error) {
            console.log('Aucune opération en cours');
        }
    }

    resumeRunningOperation(operation) {
        this.isRunning = true;
        // Utiliser dateCreation (timestamp serveur) si dispo, sinon démarrer maintenant
        const dc = operation?.dateCreation || operation?.DateCreation || null;
        this.startTime = dc ? new Date(dc) : new Date();
        
        this.startBtn.disabled = true;
        this.stopBtn.disabled = false;
        this.statusDisplay.textContent = 'En cours';
        
        this.lancementDetails.innerHTML = `
            <strong>Lancement: ${operation.lancementCode || operation.CodeLancement}</strong><br>
            <small>Opération en cours depuis ${this.startTime.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}</small>
        `;
        
        // Éviter plusieurs intervals en parallèle
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => this.updateTimer(), 1000);
        this.lancementInput.disabled = true;
        
        // Mettre à jour l'heure de fin immédiatement
        this.updateEndTime();
    }

    resumePausedOperation(operation) {
        this.isRunning = false;
        this.isPaused = true;
        const lancementCode = operation?.lancementCode || operation?.CodeLancement;
        this.currentLancement = { CodeLancement: lancementCode };
        
        this.startBtn.disabled = false;
        this.startBtn.innerHTML = '<i class="fas fa-play"></i> Reprendre';
        this.stopBtn.disabled = false;
        this.statusDisplay.textContent = 'En pause';

        const dc = operation?.dateCreation || operation?.DateCreation || null;
        const pauseSince = dc ? new Date(dc) : new Date();
        
        this.lancementDetails.innerHTML = `
            <strong>Lancement: ${lancementCode}</strong><br>
            <small>Opération en pause depuis ${pauseSince.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}</small>
        `;
        
        this.lancementInput.disabled = true;
    }

    async handleStart() {
        const code = this.lancementInput.value.trim();
        if (!code) {
            this.notificationManager.error('Veuillez saisir un code de lancement');
            return;
        }

        try {
            const operatorCode = this.operator.code || this.operator.id;
            const stepGroupVisible = this.operationStepGroup && this.operationStepGroup.style.display !== 'none';
            const selectedStep = this.operationStepSelect ? String(this.operationStepSelect.value || '').trim() : '';

            if (stepGroupVisible && !selectedStep && !this.isPaused) {
                this.notificationManager.warning('Choisissez une phase avant de démarrer');
                return;
            }
            
            if (this.isPaused) {
                // Reprendre l'opération en pause
                await this.apiService.resumeOperation(
                    operatorCode,
                    code,
                    selectedStep ? { codeOperation: selectedStep } : {}
                );
                this.notificationManager.success('Opération reprise');
            } else {
                // Démarrer nouvelle opération
                if (selectedStep) {
                    await this.apiService.startOperation(operatorCode, code, { codeOperation: selectedStep });
                } else {
                    await this.apiService.startOperation(operatorCode, code);
                }
                this.notificationManager.success('Opération démarrée');
            }
            
            this.currentLancement = { CodeLancement: code };
            this.startTimer();
            // startTimer peut être mocké en tests: forcer l'état ici pour cohérence UI/tests
            this.isRunning = true;
            this.startBtn.disabled = true;
            this.pauseBtn.disabled = false;
            this.stopBtn.disabled = false;
            this.statusDisplay.textContent = 'En cours';
            this.lancementInput.disabled = true;
            this.isPaused = false;
            
            // Actualiser l'historique après démarrage
            this.loadOperatorHistory();
            
        } catch (error) {
            console.error('Erreur:', error);
            // Si le backend demande un choix d'étape (Phase), afficher le sélecteur
            if (error?.errorCode === 'CODE_OPERATION_REQUIRED' && error?.errorData?.steps) {
                this.renderOperationSteps(error.errorData);
                this.notificationManager.warning('Plusieurs phases disponibles: choisissez une phase puis relancez Démarrer');
                return;
            }
            if (error?.errorCode === 'INVALID_CODE_OPERATION' && error?.errorData?.steps) {
                this.renderOperationSteps(error.errorData);
                this.notificationManager.warning('Phase invalide: choisissez une phase dans la liste');
                return;
            }
            this.notificationManager.error(error.message || 'Erreur de connexion');
        }
    }

    async handlePause() {
        if (!this.currentLancement) return;
        
        if (!this.canPerformAction()) return;
        
        try {
            const operatorCode = this.operator.code || this.operator.id;
            const selectedStep = this.operationStepSelect ? String(this.operationStepSelect.value || '').trim() : '';
            await this.apiService.pauseOperation(
                operatorCode,
                this.currentLancement.CodeLancement,
                selectedStep ? { codeOperation: selectedStep } : {}
            );
            
            this.pauseTimer();
            this.startBtn.disabled = false;
            this.startBtn.innerHTML = '<i class="fas fa-play"></i> Reprendre';
            this.pauseBtn.disabled = true;
            this.statusDisplay.textContent = 'En pause';
            this.notificationManager.info('Opération mise en pause');
            this.isPaused = true;
            
            // Actualiser l'historique après pause
            this.loadOperatorHistory();
            
        } catch (error) {
            console.error('Erreur:', error);
            this.notificationManager.error(error.message || 'Erreur de connexion');
        }
    }

    async handleStop() {
        if (!this.currentLancement) return;
        
        if (!this.canPerformAction()) return;
        
        try {
            // Définir l'heure de fin avant d'arrêter
            this.setFinalEndTime();
            
            const operatorCode = this.operator.code || this.operator.id;
            const selectedStep = this.operationStepSelect ? String(this.operationStepSelect.value || '').trim() : '';
            const result = await this.apiService.stopOperation(
                operatorCode,
                this.currentLancement.CodeLancement,
                selectedStep ? { codeOperation: selectedStep } : {}
            );
            
            this.stopTimer();
            this.resetControls();
            this.statusDisplay.textContent = 'Terminé';
            this.notificationManager.success(`Opération terminée - Durée: ${result.duration || 'N/A'}`);
            
            // Réinitialiser pour permettre un nouveau lancement
            this.lancementInput.value = '';
            this.lancementInput.disabled = false;
            this.lancementInput.placeholder = "Saisir un nouveau code de lancement...";
            this.controlsSection.style.display = 'none';
            
            // Actualiser l'historique après arrêt
            this.loadOperatorHistory();
            
        } catch (error) {
            console.error('Erreur:', error);
            
            // Si le lancement est déjà terminé, c'est normal - on affiche juste un message informatif
            if (error.message && error.message.includes('déjà terminé')) {
                this.notificationManager.warning('Ce lancement est déjà terminé.');
                // Réinitialiser quand même l'interface
                this.stopTimer();
                this.resetControls();
                this.statusDisplay.textContent = 'Terminé';
                this.lancementInput.value = '';
                this.lancementInput.disabled = false;
                this.lancementInput.placeholder = "Saisir un nouveau code de lancement...";
                this.controlsSection.style.display = 'none';
                this.loadOperatorHistory();
            } else {
            this.notificationManager.error(error.message || 'Erreur de connexion');
            }
        }
    }

    startTimer() {
        // Toujours initialiser startTime si manquant (sinon le timer reste bloqué)
        if (!this.startTime) {
            this.startTime = new Date();
        }
        this.isRunning = true;
        
        if (this.pauseStartTime) {
            // Ajouter le temps de pause au total
            this.totalPausedTime += (new Date() - this.pauseStartTime);
            this.pauseStartTime = null;
        }
        
        // Éviter plusieurs intervals en parallèle
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }
        this.timerInterval = setInterval(() => this.updateTimer(), 1000);
    }

    pauseTimer() {
        this.pauseStartTime = new Date();
        clearInterval(this.timerInterval);
    }

    stopTimer() {
        this.isRunning = false;
        clearInterval(this.timerInterval);
        this.timerDisplay.textContent = '00:00:00';
        this.totalPausedTime = 0;
        this.pauseStartTime = null;
    }

    resetControls() {
        this.startBtn.disabled = false;
        this.startBtn.innerHTML = '<i class="fas fa-play"></i> Démarrer';
        this.pauseBtn.disabled = true;
        this.stopBtn.disabled = true;
        this.stopTimer();
        this.statusDisplay.textContent = 'En attente';
        this.isPaused = false;
        if (this.endTimeDisplay) {
            this.endTimeDisplay.textContent = '--:--';
        }
    }

    updateTimer() {
        if (!this.isRunning || !this.startTime) return;
        
        const now = new Date();
        const elapsed = Math.floor((now - this.startTime - this.totalPausedTime) / 1000);
        this.timerDisplay.textContent = TimeUtils.formatDuration(Math.max(0, elapsed));
        
        // Mettre à jour l'heure de fin estimée
        this.updateEndTime();
    }

    updateEndTime() {
        if (!this.endTimeDisplay) {
            console.warn('⚠️ endTimeDisplay non trouvé, impossible de mettre à jour l\'heure de fin');
            return;
        }
        
        if (!this.isRunning || !this.startTime) {
            this.endTimeDisplay.textContent = '--:--';
            return;
        }
        
        // Afficher l'heure actuelle comme heure de fin en cours
        const now = new Date();
        
        // Formater l'heure de fin
        this.endTimeDisplay.textContent = now.toLocaleTimeString('fr-FR', {
            timeZone: 'Europe/Paris',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    setFinalEndTime() {
        if (!this.endTimeDisplay) {
            console.warn('⚠️ endTimeDisplay non trouvé, impossible de définir l\'heure de fin');
            return;
        }
        
        // Afficher l'heure de fin définitive quand l'opération se termine
        const now = new Date();
        this.endTimeDisplay.textContent = now.toLocaleTimeString('fr-FR', {
            timeZone: 'Europe/Paris',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Méthodes de compatibilité
    loadLancements() {
        // Ne fait rien - on utilise la saisie manuelle
    }

    getCurrentLancement() {
        return this.currentLancement;
    }

    getTimerStatus() {
        return {
            isRunning: this.isRunning,
            startTime: this.startTime
        };
    }

    async loadOperatorHistory() {
        try {
            console.log('=== DEBUT loadOperatorHistory ===');
            console.log('operatorHistoryTableBody existe:', !!this.operatorHistoryTableBody);
            
            if (!this.operatorHistoryTableBody) {
                console.error('❌ operatorHistoryTableBody non trouvé !');
                return;
            }
            
            // Afficher un message de chargement
            const loadingRow = document.createElement('tr');
            loadingRow.innerHTML = '<td colspan="6" class="no-data"><i class="fas fa-spinner fa-spin"></i> Chargement en cours...</td>';
            this.operatorHistoryTableBody.innerHTML = '';
            this.operatorHistoryTableBody.appendChild(loadingRow);
            
            // Vérifier les propriétés de l'opérateur
            console.log('=== DEBUG OPÉRATEUR ===');
            console.log('Opérateur complet:', this.operator);
            console.log('Opérateur.id:', this.operator.id);
            console.log('Opérateur.code:', this.operator.code);
            console.log('Opérateur.coderessource:', this.operator.coderessource);
            console.log('Opérateur.nom:', this.operator.nom);
            
            const operatorCode = this.operator.code || this.operator.coderessource || this.operator.id;
            console.log('Code opérateur utilisé pour l\'API:', operatorCode);
            console.log('=== FIN DEBUG OPÉRATEUR ===');
            
            if (!operatorCode) {
                console.error('❌ Aucun code opérateur trouvé');
                const errorRow = document.createElement('tr');
                errorRow.className = 'empty-state-row';
                errorRow.innerHTML = `
                    <td colspan="6" class="empty-state">
                        <div style="text-align: center; padding: 3rem 2rem;">
                            <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #ffc107; margin-bottom: 1rem; display: block;"></i>
                            <p style="font-size: 1.1rem; color: #666; margin: 0.5rem 0; font-weight: 500;">
                                Code opérateur non trouvé
                            </p>
                            <p style="font-size: 0.9rem; color: #999; margin: 0;">
                                Impossible de charger l'historique. Veuillez vous reconnecter.
                            </p>
                        </div>
                    </td>
                `;
                this.operatorHistoryTableBody.innerHTML = '';
                this.operatorHistoryTableBody.appendChild(errorRow);
                return;
            }
            
            // Utiliser la route admin pour récupérer l'historique de l'opérateur
            console.log('🔗 Chargement historique pour opérateur:', operatorCode);
            
            const data = await this.apiService.get(`/operators/${operatorCode}/operations`);
            console.log('📊 Données reçues:', data);
            
            if (data.success) {
                console.log('Historique chargé:', data.operations.length, 'opérations');
                this.displayOperatorHistory(data.operations);
            } else {
                console.error('Erreur lors du chargement de l\'historique:', data.error);
                const errorRow = document.createElement('tr');
                errorRow.className = 'empty-state-row';
                errorRow.innerHTML = `
                    <td colspan="6" class="empty-state">
                        <div style="text-align: center; padding: 3rem 2rem;">
                            <i class="fas fa-exclamation-circle" style="font-size: 3rem; color: #dc3545; margin-bottom: 1rem; display: block;"></i>
                            <p style="font-size: 1.1rem; color: #666; margin: 0.5rem 0; font-weight: 500;">
                                Erreur lors du chargement
                            </p>
                            <p style="font-size: 0.9rem; color: #999; margin: 0;">
                                ${data.error || 'Une erreur est survenue lors du chargement de l\'historique'}
                            </p>
                        </div>
                    </td>
                `;
                this.operatorHistoryTableBody.innerHTML = '';
                this.operatorHistoryTableBody.appendChild(errorRow);
            }
            
        } catch (error) {
            console.error('Erreur lors du chargement de l\'historique:', error);
            const connectionErrorRow = document.createElement('tr');
            connectionErrorRow.className = 'empty-state-row';
            connectionErrorRow.innerHTML = `
                <td colspan="6" class="empty-state">
                    <div style="text-align: center; padding: 3rem 2rem;">
                        <i class="fas fa-wifi" style="font-size: 3rem; color: #dc3545; margin-bottom: 1rem; display: block;"></i>
                        <p style="font-size: 1.1rem; color: #666; margin: 0.5rem 0; font-weight: 500;">
                            Erreur de connexion
                        </p>
                        <p style="font-size: 0.9rem; color: #999; margin: 0;">
                            Impossible de se connecter au serveur. Vérifiez votre connexion internet.
                        </p>
                    </div>
                </td>
            `;
            this.operatorHistoryTableBody.innerHTML = '';
            this.operatorHistoryTableBody.appendChild(connectionErrorRow);
        }
    }

    displayOperatorHistory(operations) {
        console.log('=== DEBUT displayOperatorHistory ===');
        console.log('Nombre d\'opérations à afficher:', operations ? operations.length : 0);
        
        if (!this.operatorHistoryTableBody) {
            console.error('❌ operatorHistoryTableBody non trouvé dans displayOperatorHistory !');
            return;
        }
        
        if (!operations || operations.length === 0) {
            console.log('⚠️ Aucune opération à afficher');
            const emptyRow = document.createElement('tr');
            emptyRow.className = 'empty-state-row';
            emptyRow.innerHTML = `
                <td colspan="6" class="empty-state">
                    <div style="text-align: center; padding: 3rem 2rem;">
                        <i class="fas fa-history" style="font-size: 3rem; color: #ccc; margin-bottom: 1rem; display: block;"></i>
                        <p style="font-size: 1.1rem; color: #666; margin: 0.5rem 0; font-weight: 500;">
                            Aucun lancement trouvé
                        </p>
                        <p style="font-size: 0.9rem; color: #999; margin: 0;">
                            Votre historique est vide. Démarrez une opération pour voir votre historique ici.
                        </p>
                    </div>
                </td>
            `;
            this.operatorHistoryTableBody.innerHTML = '';
            this.operatorHistoryTableBody.appendChild(emptyRow);
            return;
        }

        console.log('🔄 Vidage du tableau et ajout des lignes...');
        this.operatorHistoryTableBody.innerHTML = '';
        
        operations.forEach((operation, index) => {
            console.log(`Ajout ligne ${index + 1}:`, operation.lancementCode, operation.status);
            console.log(`Phase pour ${operation.lancementCode}:`, operation.phase);
            
            const row = document.createElement('tr');
            
            // Ajouter une classe spéciale pour les lignes de pause
            if (operation.type === 'pause') {
                row.classList.add('pause-row');
                if (operation.statusCode === 'PAUSE_TERMINEE') {
                    row.classList.add('pause-terminee');
                }
            }
            
            // Normaliser le statusCode pour les classes CSS (en majuscules, remplacer les caractères spéciaux)
            const normalizedStatusCode = (operation.statusCode || 'EN_COURS').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            
            row.innerHTML = `
                <td>${operation.lancementCode || '-'} ${operation.type === 'pause' ? '<i class="fas fa-pause-circle pause-icon"></i>' : ''}</td>
                <td>${operation.article || '-'}</td>
                <td>${operation.phase || 'PRODUCTION'}</td>
                <td>${operation.startTime || '-'}</td>
                <td>${operation.endTime || '-'}</td>
                <td>
                    <span class="status-badge status-${normalizedStatusCode}">${operation.status || 'En cours'}</span>
                </td>
            `;
            this.operatorHistoryTableBody.appendChild(row);
        });
        
        console.log('✅ Historique affiché avec succès:', operations.length, 'opérations');
        console.log('=== FIN displayOperatorHistory ===');
    }

    // Gestion des commentaires
    handleCommentInput() {
        const comment = this.commentInput.value.trim();
        const charCount = comment.length;
        
        // Mettre à jour le compteur de caractères
        this.commentCharCount.textContent = charCount;
        
        // Changer la couleur selon le nombre de caractères
        this.commentCharCount.className = 'comment-counter';
        if (charCount > 1800) {
            this.commentCharCount.classList.add('danger');
        } else if (charCount > 1500) {
            this.commentCharCount.classList.add('warning');
        }
        
        // Activer/désactiver le bouton d'envoi
        this.addCommentBtn.disabled = charCount === 0 || charCount > 2000;
        
        // Mettre à jour le placeholder si nécessaire
        if (this.currentLancement) {
            this.commentInput.placeholder = `Ajouter un commentaire sur ${this.currentLancement.CodeLancement}...`;
        } else {
            this.commentInput.placeholder = 'Ajouter un commentaire sur cette opération...';
        }
    }

    async handleAddComment() {
        const comment = this.commentInput.value.trim();
        
        if (!comment) {
            this.notificationManager.error('Veuillez saisir un commentaire');
            return;
        }
        
        if (comment.length > 2000) {
            this.notificationManager.error('Le commentaire ne peut pas dépasser 2000 caractères');
            return;
        }
        
        if (!this.currentLancement) {
            this.notificationManager.error('Aucun lancement sélectionné pour ajouter un commentaire');
            return;
        }
        
        try {
            // Désactiver le bouton pendant l'envoi
            this.addCommentBtn.disabled = true;
            this.addCommentBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';
            
            const result = await this.apiService.addComment(
                this.operator.code || this.operator.id,
                this.operator.nom || this.operator.name,
                this.currentLancement.CodeLancement,
                comment
            );
            
            if (result.success) {
                this.notificationManager.success('Commentaire envoyé avec succès');
                
                // Afficher une notification spéciale pour l'admin
                this.showAdminNotification(comment, this.currentLancement.CodeLancement);
                
                // Vider le champ de commentaire
                this.commentInput.value = '';
                this.handleCommentInput();
                
                // Recharger les commentaires
                await this.loadComments();
                
                // Afficher un message si l'email n'a pas pu être envoyé
                if (!result.emailSent) {
                    this.notificationManager.warning('Commentaire enregistré - Vérifiez la console du serveur');
                }
            } else {
                this.notificationManager.error(result.error || 'Erreur lors de l\'envoi du commentaire');
            }
            
        } catch (error) {
            console.error('Erreur lors de l\'envoi du commentaire:', error);
            this.notificationManager.error('Erreur de connexion lors de l\'envoi du commentaire');
        } finally {
            // Réactiver le bouton
            this.addCommentBtn.disabled = false;
            this.addCommentBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer Commentaire';
        }
    }

    async loadComments() {
        try {
            if (!this.currentLancement) {
                this.displayComments([]);
                return;
            }
            
            const result = await this.apiService.getCommentsByLancement(this.currentLancement.CodeLancement);
            
            if (result.success) {
                this.displayComments(result.data);
            } else {
                console.error('Erreur lors du chargement des commentaires:', result.error);
                this.displayComments([]);
            }
            
        } catch (error) {
            console.error('Erreur lors du chargement des commentaires:', error);
            this.displayComments([]);
        }
    }

    displayComments(comments) {
        if (!this.commentsList) {
            console.warn('⚠️ commentsList non trouvé');
            return;
        }
        
        if (!comments || comments.length === 0) {
            this.commentsList.innerHTML = `
                <div class="no-comments">
                    <i class="fas fa-comment-slash"></i>
                    <p>Aucun commentaire pour le moment</p>
                </div>
            `;
            return;
        }
        
        // Trier les commentaires par date (plus récents en premier)
        const sortedComments = comments.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        this.commentsList.innerHTML = sortedComments.map(comment => `
            <div class="comment-item">
                <div class="comment-header">
                    <div>
                        <span class="comment-author">${comment.operatorName || comment.operatorCode}</span>
                        <span class="comment-lancement">${comment.lancementCode}</span>
                    </div>
                    <div class="comment-timestamp">${this.formatCommentTimestamp(comment.timestamp)}</div>
                </div>
                <div class="comment-content">${this.escapeHtml(comment.comment)}</div>
                ${this.canDeleteComment(comment) ? `
                    <div class="comment-actions-item">
                        <button class="btn-comment btn-delete-comment" data-comment-id="${comment.id}">
                            <i class="fas fa-trash"></i> Supprimer
                        </button>
                    </div>
                ` : ''}
            </div>
        `).join('');
        
        // Ajouter les event listeners pour les boutons de suppression
        this.commentsList.querySelectorAll('.btn-delete-comment').forEach(button => {
            button.addEventListener('click', (e) => {
                const commentId = parseInt(e.target.closest('.btn-delete-comment').dataset.commentId);
                this.deleteComment(commentId);
            });
        });
    }

    formatCommentTimestamp(timestamp) {
        try {
            const date = new Date(timestamp);
            return date.toLocaleString('fr-FR', {
                timeZone: 'Europe/Paris',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return timestamp;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    canDeleteComment(comment) {
        // L'opérateur peut supprimer ses propres commentaires
        return comment.operatorCode === (this.operator.code || this.operator.id);
    }

    async deleteComment(commentId) {
        if (!confirm('Êtes-vous sûr de vouloir supprimer ce commentaire ?')) {
            return;
        }
        
        try {
            const result = await this.apiService.deleteComment(commentId, this.operator.code || this.operator.id);
            
            if (result.success) {
                this.notificationManager.success('Commentaire supprimé avec succès');
                await this.loadComments();
            } else {
                this.notificationManager.error(result.error || 'Erreur lors de la suppression du commentaire');
            }
            
        } catch (error) {
            console.error('Erreur lors de la suppression du commentaire:', error);
            this.notificationManager.error('Erreur de connexion lors de la suppression du commentaire');
        }
    }

    // Méthode pour recharger les commentaires quand un nouveau lancement est sélectionné
    async onLancementChanged() {
        await this.loadComments();
    }

    // ===== SCANNER DE CODE-BARRES =====
    
    /**
     * Ouvre le modal scanner et démarre la caméra
     */
    async openScanner() {
        if (!this.scannerModal || !this.scannerVideo || !this.scannerCanvas) {
            this.notificationManager.error('Éléments du scanner non trouvés');
            return;
        }

        // Vérifier si le scanner est supporté (mais on essaie quand même)
        const isSupported = ScannerManager.isSupported();
        console.log('📱 Support scanner:', isSupported);
        
        // On ne bloque plus si isSupported retourne false
        // La méthode isSupported() retourne maintenant toujours true
        // et on laisse le navigateur gérer les erreurs

        // Afficher le modal
        this.scannerModal.style.display = 'flex';
        this.scannerStatus.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> <span>Initialisation de la caméra...</span>';

        try {
            await this.scannerManager.start(this.scannerVideo, this.scannerCanvas);
            
            // Vérifier si ZXing est disponible pour le scan automatique
            const hasZXing = typeof ZXing !== 'undefined' && ZXing.BrowserMultiFormatReader;
            
            if (hasZXing) {
                this.scannerStatus.innerHTML = '<i class="fas fa-check-circle" style="color: green;"></i> <span style="color: green;">Caméra active - Scannez un code-barres</span>';
            } else {
                this.scannerStatus.innerHTML = `
                    <div style="text-align: center; padding: 1rem;">
                        <i class="fas fa-camera" style="font-size: 2rem; color: #667eea; margin-bottom: 0.5rem; display: block;"></i>
                        <p style="color: #667eea; font-weight: 500; margin: 0.5rem 0;">Caméra active</p>
                        <p style="color: #666; font-size: 0.9rem; margin: 0;">Positionnez le code-barres devant la caméra et saisissez-le manuellement dans le champ ci-dessous</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Erreur lors de l\'ouverture du scanner:', error);
            this.notificationManager.error(error?.message || 'Erreur d\'accès à la caméra');
            this.scannerStatus.innerHTML = `
                <div style="text-align: center; padding: 1rem;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: #dc3545; margin-bottom: 0.5rem; display: block;"></i>
                    <p style="color: #dc3545; font-weight: 500; margin: 0;">Erreur d'accès à la caméra</p>
                </div>
            `;
            
            // Fermer automatiquement après 3 secondes
            setTimeout(() => {
                this.closeScanner();
            }, 3000);
        }
    }

    /**
     * Ferme le modal scanner et arrête la caméra
     */
    closeScanner() {
        this.scannerManager.stop();
        
        if (this.scannerModal) {
            this.scannerModal.style.display = 'none';
        }
        
        if (this.scannerStatus) {
            this.scannerStatus.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> <span>Initialisation de la caméra...</span>';
        }
    }

    /**
     * Gère un code scanné avec succès
     * @param {string} scannedCode - Code scanné
     */
    handleScannedCode(scannedCode) {
        if (!scannedCode || !this.lancementInput) {
            return;
        }

        try {
            // Nettoyer le code scanné
            let cleanCode = scannedCode.trim().replace(/[\s\-_\.]/g, '');
            
            // Si le code ne commence pas par "LT", l'ajouter
            const upperCode = cleanCode.toUpperCase();
            if (!upperCode.startsWith('LT')) {
                if (/^\d+$/.test(cleanCode)) {
                    cleanCode = 'LT' + cleanCode;
                } else {
                    cleanCode = 'LT' + cleanCode.replace(/LT/gi, '');
                }
            }
            
            cleanCode = cleanCode.toUpperCase();
            
            // Mettre le code dans le champ de saisie
            this.lancementInput.value = cleanCode;
            const normalizedCode = this.enforceNumericLancementInput();
            this.handleLancementInput();
            
            // Notification de succès
            this.notificationManager.success(`Code scanné: ${normalizedCode}`);
            
            // Valider automatiquement le lancement après un court délai
            setTimeout(() => {
                this.validateAndSelectLancement();
            }, 500);
            
        } catch (error) {
            console.error('Erreur lors du traitement du code scanné:', error);
            this.notificationManager.error(`Erreur scan: ${error.message}`);
        }
    }

    /**
     * Gère les erreurs du scanner
     * @param {string} errorMessage - Message d'erreur
     * @param {Error} originalError - Erreur originale
     */
    handleScannerError(errorMessage, originalError) {
        console.error('Erreur scanner:', errorMessage, originalError);
        this.notificationManager.error(errorMessage);
        this.closeScanner();
    }

    // Afficher une notification spéciale pour l'admin
    showAdminNotification(comment, lancementCode) {
        // Créer une notification persistante et visible
        const notification = document.createElement('div');
        notification.className = 'admin-notification';
        notification.innerHTML = `
            <div class="admin-notification-content">
                <div class="admin-notification-header">
                    <i class="fas fa-bell"></i>
                    <strong>NOUVEAU COMMENTAIRE SEDI</strong>
                    <button class="admin-notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
                </div>
                <div class="admin-notification-body">
                    <p><strong>Lancement:</strong> ${lancementCode}</p>
                    <p><strong>Opérateur:</strong> ${this.operator.nom || this.operator.name}</p>
                    <p><strong>Commentaire:</strong> ${comment.substring(0, 100)}${comment.length > 100 ? '...' : ''}</p>
                    <p><strong>Heure:</strong> ${new Date().toLocaleString('fr-FR')}</p>
                </div>
            </div>
        `;
        
        // Ajouter au body de la page
        document.body.appendChild(notification);
        
        // Auto-supprimer après 30 secondes
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 30000);
    }

}

export default OperateurInterface;