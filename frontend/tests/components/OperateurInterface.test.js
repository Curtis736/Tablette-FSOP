import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import OperateurInterface from '../../components/OperateurInterface.js';
import ScannerManager from '../../utils/ScannerManager.js';
import TimeUtils from '../../utils/TimeUtils.js';

// Mock des dépendances
vi.mock('../../utils/ScannerManager.js');
vi.mock('../../utils/TimeUtils.js');

describe('OperateurInterface', () => {
    let mockApp;
    let mockApiService;
    let mockNotificationManager;
    let mockOperator;
    let operInterface;
    let mockElements;

    beforeEach(() => {
        // Mock de l'application
        mockApiService = {
            getLancement: vi.fn(),
            getCurrentOperation: vi.fn(),
            startOperation: vi.fn(),
            pauseOperation: vi.fn(),
            resumeOperation: vi.fn(),
            stopOperation: vi.fn(),
            get: vi.fn(),
            addComment: vi.fn(),
            getCommentsByLancement: vi.fn(),
            deleteComment: vi.fn()
        };

        mockNotificationManager = {
            success: vi.fn(),
            error: vi.fn(),
            warning: vi.fn(),
            info: vi.fn()
        };

        mockApp = {
            getApiService: vi.fn(() => mockApiService),
            getNotificationManager: vi.fn(() => mockNotificationManager)
        };

        mockOperator = {
            code: 'OP001',
            id: 'OP001',
            nom: 'Test Operator',
            name: 'Test Operator',
            coderessource: 'OP001'
        };

        // Créer les éléments DOM mockés
        mockElements = {
            lancementSearch: document.createElement('input'),
            lancementList: document.createElement('div'),
            controlsSection: document.createElement('div'),
            selectedLancement: document.createElement('h3'),
            lancementDetails: document.createElement('p'),
            startBtn: document.createElement('button'),
            pauseBtn: document.createElement('button'),
            stopBtn: document.createElement('button'),
            timerDisplay: document.createElement('div'),
            statusDisplay: document.createElement('div'),
            endTimeDisplay: document.createElement('div'),
            refreshHistoryBtn: document.createElement('button'),
            operatorHistoryTable: document.createElement('table'),
            operatorHistoryTableBody: document.createElement('tbody'),
            commentInput: document.createElement('textarea'),
            addCommentBtn: document.createElement('button'),
            commentCharCount: document.createElement('span'),
            commentsList: document.createElement('div'),
            scanBarcodeBtn: document.createElement('button'),
            barcodeScannerModal: document.createElement('div'),
            closeScannerBtn: document.createElement('button'),
            scannerVideo: document.createElement('video'),
            scannerCanvas: document.createElement('canvas'),
            scannerStatus: document.createElement('div')
        };

        // Configurer les éléments
        mockElements.lancementSearch.id = 'lancementSearch';
        mockElements.lancementList.id = 'lancementList';
        mockElements.controlsSection.id = 'controlsSection';
        mockElements.selectedLancement.id = 'selectedLancement';
        mockElements.lancementDetails.id = 'lancementDetails';
        mockElements.startBtn.id = 'startBtn';
        mockElements.pauseBtn.id = 'pauseBtn';
        mockElements.stopBtn.id = 'stopBtn';
        mockElements.timerDisplay.id = 'timerDisplay';
        mockElements.statusDisplay.id = 'statusDisplay';
        mockElements.endTimeDisplay.id = 'endTimeDisplay';
        mockElements.refreshHistoryBtn.id = 'refreshHistoryBtn';
        mockElements.operatorHistoryTable.id = 'operatorHistoryTable';
        mockElements.operatorHistoryTableBody.id = 'operatorHistoryTableBody';
        mockElements.commentInput.id = 'commentInput';
        mockElements.addCommentBtn.id = 'addCommentBtn';
        mockElements.commentCharCount.id = 'commentCharCount';
        mockElements.commentsList.id = 'commentsList';
        mockElements.scanBarcodeBtn.id = 'scanBarcodeBtn';
        mockElements.barcodeScannerModal.id = 'barcodeScannerModal';
        mockElements.closeScannerBtn.id = 'closeScannerBtn';
        mockElements.scannerVideo.id = 'scannerVideo';
        mockElements.scannerCanvas.id = 'scannerCanvas';
        mockElements.scannerStatus.id = 'scannerStatus';

        // Ajouter au DOM
        Object.values(mockElements).forEach(el => {
            if (el && el.id) {
                document.body.appendChild(el);
            }
        });

        // Mock de ScannerManager
        const mockScannerManager = {
            init: vi.fn(),
            start: vi.fn().mockResolvedValue(),
            stop: vi.fn(),
            isSupported: vi.fn(() => true)
        };
        ScannerManager.mockImplementation(() => mockScannerManager);
        ScannerManager.isSupported = vi.fn(() => true);

        // Mock de TimeUtils
        TimeUtils.formatDuration = vi.fn((seconds) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        });

        // Mock de console.log pour éviter les logs dans les tests
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Mock de requestAnimationFrame
        global.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 0));
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        if (operInterface && operInterface.timerInterval) {
            clearInterval(operInterface.timerInterval);
        }
    });

    describe('constructor', () => {
        it('devrait initialiser correctement toutes les propriétés', () => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
            
            expect(operInterface.operator).toBe(mockOperator);
            expect(operInterface.app).toBe(mockApp);
            expect(operInterface.apiService).toBe(mockApiService);
            expect(operInterface.notificationManager).toBe(mockNotificationManager);
            expect(operInterface.currentLancement).toBeNull();
            expect(operInterface.isRunning).toBe(false);
            expect(operInterface.isPaused).toBe(false);
            expect(operInterface.LANCEMENT_PREFIX).toBe('LT');
            expect(operInterface.MAX_LANCEMENT_DIGITS).toBe(8);
        });

        it('devrait initialiser les éléments DOM', () => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
            
            expect(operInterface.lancementInput).toBe(mockElements.lancementSearch);
            expect(operInterface.scannerModal).toBe(mockElements.barcodeScannerModal);
        });
    });

    describe('canPerformAction', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
        });

        it('devrait retourner true si le cooldown est passé', () => {
            operInterface.lastActionTime = 0;
            const result = operInterface.canPerformAction();
            expect(result).toBe(true);
            expect(operInterface.lastActionTime).toBeGreaterThan(0);
        });

        it('devrait retourner false et afficher un warning si le cooldown n\'est pas passé', () => {
            operInterface.lastActionTime = Date.now();
            const result = operInterface.canPerformAction();
            expect(result).toBe(false);
            expect(mockNotificationManager.warning).toHaveBeenCalled();
        });
    });

    describe('getSanitizedDigitsFromValue', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
        });

        it('devrait extraire uniquement les chiffres', () => {
            expect(operInterface.getSanitizedDigitsFromValue('LT123456')).toBe('123456');
            expect(operInterface.getSanitizedDigitsFromValue('abc123def456')).toBe('123456');
        });

        it('devrait limiter à MAX_LANCEMENT_DIGITS chiffres', () => {
            const longNumber = '123456789012345';
            expect(operInterface.getSanitizedDigitsFromValue(longNumber).length).toBe(8);
        });

        it('devrait retourner une chaîne vide pour une valeur vide', () => {
            expect(operInterface.getSanitizedDigitsFromValue('')).toBe('');
            expect(operInterface.getSanitizedDigitsFromValue(null)).toBe('');
        });
    });

    describe('enforceNumericLancementInput', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
        });

        it('devrait forcer le format LT + chiffres', () => {
            mockElements.lancementSearch.value = 'LT123';
            const result = operInterface.enforceNumericLancementInput();
            expect(result).toBe('LT123');
            expect(mockElements.lancementSearch.value).toBe('LT123');
        });

        it('devrait nettoyer les caractères non numériques', () => {
            mockElements.lancementSearch.value = 'LTabc123def';
            operInterface.enforceNumericLancementInput();
            expect(mockElements.lancementSearch.value).toBe('LT123');
        });

        it('devrait retourner le préfixe si l\'input est null', () => {
            operInterface.lancementInput = null;
            const result = operInterface.enforceNumericLancementInput();
            expect(result).toBe('LT');
        });
    });

    describe('handleLancementInput', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
            operInterface.isRunning = false;
        });

        it('devrait afficher les contrôles quand un code est saisi', () => {
            mockElements.lancementSearch.value = 'LT123';
            operInterface.handleLancementInput();
            
            expect(mockElements.controlsSection.style.display).toBe('block');
            expect(mockElements.selectedLancement.textContent).toBe('LT123');
        });

        it('devrait valider automatiquement si le code est complet (10 caractères)', async () => {
            mockElements.lancementSearch.value = 'LT1234567';
            operInterface.validateAndSelectLancement = vi.fn();
            
            operInterface.handleLancementInput();
            
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(operInterface.validateAndSelectLancement).toHaveBeenCalled();
        });

        it('devrait cacher les contrôles si le champ est vide', () => {
            mockElements.lancementSearch.value = '';
            operInterface.handleLancementInput();
            
            expect(mockElements.controlsSection.style.display).toBe('none');
        });
    });

    describe('validateAndSelectLancement', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
            mockElements.lancementSearch.value = 'LT1234567';
        });

        it('devrait valider un lancement valide', async () => {
            const mockLancement = {
                CodeArticle: 'ART001',
                DesignationLct1: 'Test Article',
                CodeModele: 'MOD001',
                DesignationArt1: 'Designation 1',
                DesignationArt2: 'Designation 2'
            };
            
            mockApiService.getLancement.mockResolvedValue({ data: mockLancement });
            mockApiService.getCommentsByLancement.mockResolvedValue({ success: true, data: [] });
            
            await operInterface.validateAndSelectLancement();
            
            expect(mockApiService.getLancement).toHaveBeenCalledWith('LT1234567');
            expect(operInterface.currentLancement).toBeDefined();
            expect(operInterface.currentLancement.CodeLancement).toBe('LT1234567');
            expect(mockNotificationManager.success).toHaveBeenCalled();
        });

        it('devrait gérer l\'erreur 409 (conflit)', async () => {
            const error = new Error('Conflit');
            error.status = 409;
            mockApiService.getLancement.mockRejectedValue(error);
            
            await operInterface.validateAndSelectLancement();
            
            expect(mockNotificationManager.error).toHaveBeenCalled();
            expect(operInterface.currentLancement).toBeNull();
        });

        it('devrait gérer les autres erreurs', async () => {
            const error = new Error('Lancement non trouvé');
            mockApiService.getLancement.mockRejectedValue(error);
            
            await operInterface.validateAndSelectLancement();
            
            expect(mockNotificationManager.error).toHaveBeenCalled();
            expect(operInterface.currentLancement).toBeNull();
        });

        it('devrait afficher une erreur si le code est vide', async () => {
            mockElements.lancementSearch.value = '';
            await operInterface.validateAndSelectLancement();
            
            expect(mockNotificationManager.error).toHaveBeenCalledWith('Veuillez saisir un code de lancement');
        });
    });

    describe('handleStart', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
            mockElements.lancementSearch.value = 'LT1234567';
            operInterface.currentLancement = { CodeLancement: 'LT1234567' };
        });

        it('devrait démarrer une nouvelle opération', async () => {
            mockApiService.startOperation.mockResolvedValue({});
            operInterface.startTimer = vi.fn();
            operInterface.loadOperatorHistory = vi.fn();
            
            await operInterface.handleStart();
            
            expect(mockApiService.startOperation).toHaveBeenCalledWith('OP001', 'LT1234567');
            expect(operInterface.startTimer).toHaveBeenCalled();
            expect(operInterface.isRunning).toBe(true);
            expect(mockNotificationManager.success).toHaveBeenCalled();
        });

        it('devrait reprendre une opération en pause', async () => {
            operInterface.isPaused = true;
            mockApiService.resumeOperation.mockResolvedValue({});
            operInterface.startTimer = vi.fn();
            operInterface.loadOperatorHistory = vi.fn();
            
            await operInterface.handleStart();
            
            expect(mockApiService.resumeOperation).toHaveBeenCalledWith('OP001', 'LT1234567');
            expect(operInterface.isPaused).toBe(false);
        });

        it('devrait gérer les erreurs', async () => {
            const error = new Error('Erreur serveur');
            mockApiService.startOperation.mockRejectedValue(error);
            
            await operInterface.handleStart();
            
            expect(mockNotificationManager.error).toHaveBeenCalled();
        });
    });

    describe('handlePause', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
            operInterface.currentLancement = { CodeLancement: 'LT1234567' };
            operInterface.isRunning = true;
            operInterface.canPerformAction = vi.fn(() => true);
            operInterface.pauseTimer = vi.fn();
            operInterface.loadOperatorHistory = vi.fn();
        });

        it('devrait mettre en pause une opération', async () => {
            mockApiService.pauseOperation.mockResolvedValue({});
            
            await operInterface.handlePause();
            
            expect(mockApiService.pauseOperation).toHaveBeenCalledWith('OP001', 'LT1234567');
            expect(operInterface.pauseTimer).toHaveBeenCalled();
            expect(operInterface.isPaused).toBe(true);
            expect(mockNotificationManager.info).toHaveBeenCalled();
        });

        it('ne devrait rien faire si canPerformAction retourne false', async () => {
            operInterface.canPerformAction = vi.fn(() => false);
            
            await operInterface.handlePause();
            
            expect(mockApiService.pauseOperation).not.toHaveBeenCalled();
        });
    });

    describe('handleStop', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
            operInterface.currentLancement = { CodeLancement: 'LT1234567' };
            operInterface.isRunning = true;
            operInterface.canPerformAction = vi.fn(() => true);
            operInterface.setFinalEndTime = vi.fn();
            operInterface.stopTimer = vi.fn();
            operInterface.resetControls = vi.fn();
            operInterface.loadOperatorHistory = vi.fn();
        });

        it('devrait arrêter une opération', async () => {
            mockApiService.stopOperation.mockResolvedValue({ duration: '01:30:00' });
            
            await operInterface.handleStop();
            
            expect(mockApiService.stopOperation).toHaveBeenCalledWith('OP001', 'LT1234567');
            expect(operInterface.setFinalEndTime).toHaveBeenCalled();
            expect(operInterface.stopTimer).toHaveBeenCalled();
            expect(operInterface.resetControls).toHaveBeenCalled();
            expect(mockNotificationManager.success).toHaveBeenCalled();
        });

        it('ne devrait rien faire si canPerformAction retourne false', async () => {
            operInterface.canPerformAction = vi.fn(() => false);
            
            await operInterface.handleStop();
            
            expect(mockApiService.stopOperation).not.toHaveBeenCalled();
        });
    });

    describe('Timer methods', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
        });

        it('startTimer devrait démarrer le timer', () => {
            operInterface.isRunning = false;
            operInterface.startTimer();
            
            expect(operInterface.isRunning).toBe(true);
            expect(operInterface.startTime).toBeInstanceOf(Date);
            expect(operInterface.timerInterval).toBeDefined();
        });

        it('pauseTimer devrait mettre en pause le timer', () => {
            operInterface.timerInterval = setInterval(() => {}, 1000);
            operInterface.pauseTimer();
            
            expect(operInterface.pauseStartTime).toBeInstanceOf(Date);
        });

        it('stopTimer devrait arrêter le timer', () => {
            operInterface.isRunning = true;
            operInterface.timerInterval = setInterval(() => {}, 1000);
            operInterface.stopTimer();
            
            expect(operInterface.isRunning).toBe(false);
            expect(operInterface.totalPausedTime).toBe(0);
        });

        it('updateTimer devrait mettre à jour l\'affichage', () => {
            operInterface.isRunning = true;
            operInterface.startTime = new Date(Date.now() - 5000);
            operInterface.totalPausedTime = 0;
            
            operInterface.updateTimer();
            
            expect(TimeUtils.formatDuration).toHaveBeenCalled();
        });
    });

    describe('handleScannedCode', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
            operInterface.enforceNumericLancementInput = vi.fn(() => 'LT123');
            operInterface.handleLancementInput = vi.fn();
            operInterface.validateAndSelectLancement = vi.fn();
        });

        it('devrait traiter un code scanné valide', () => {
            operInterface.handleScannedCode('LT123');
            
            expect(operInterface.enforceNumericLancementInput).toHaveBeenCalled();
            expect(operInterface.handleLancementInput).toHaveBeenCalled();
            expect(mockNotificationManager.success).toHaveBeenCalled();
        });

        it('devrait ajouter le préfixe LT si absent', () => {
            operInterface.handleScannedCode('123');
            
            expect(mockElements.lancementSearch.value).toContain('LT');
        });

        it('ne devrait rien faire si le code est vide', () => {
            operInterface.handleScannedCode('');
            
            expect(operInterface.enforceNumericLancementInput).not.toHaveBeenCalled();
        });
    });

    describe('openScanner', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
            operInterface.scannerManager.start = vi.fn().mockResolvedValue();
        });

        it('devrait ouvrir le scanner et démarrer la caméra', async () => {
            global.ZXing = { BrowserMultiFormatReader: class {} };
            
            await operInterface.openScanner();
            
            expect(mockElements.barcodeScannerModal.style.display).toBe('flex');
            expect(operInterface.scannerManager.start).toHaveBeenCalled();
        });

        it('devrait gérer les erreurs d\'ouverture', async () => {
            operInterface.scannerManager.start = vi.fn().mockRejectedValue(new Error('Caméra non disponible'));
            
            await operInterface.openScanner();
            
            expect(mockNotificationManager.error).toHaveBeenCalled();
        });
    });

    describe('closeScanner', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
            mockElements.barcodeScannerModal.style.display = 'flex';
        });

        it('devrait fermer le scanner', () => {
            operInterface.closeScanner();
            
            expect(operInterface.scannerManager.stop).toHaveBeenCalled();
            expect(mockElements.barcodeScannerModal.style.display).toBe('none');
        });
    });

    describe('handleCommentInput', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
        });

        it('devrait mettre à jour le compteur de caractères', () => {
            mockElements.commentInput.value = 'Test comment';
            operInterface.handleCommentInput();
            
            expect(mockElements.commentCharCount.textContent).toBe('12');
        });

        it('devrait désactiver le bouton si le commentaire est trop long', () => {
            mockElements.commentInput.value = 'a'.repeat(2001);
            operInterface.handleCommentInput();
            
            expect(mockElements.addCommentBtn.disabled).toBe(true);
        });
    });

    describe('handleAddComment', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
            operInterface.currentLancement = { CodeLancement: 'LT1234567' };
            operInterface.loadComments = vi.fn();
            operInterface.handleCommentInput = vi.fn();
            operInterface.showAdminNotification = vi.fn();
        });

        it('devrait ajouter un commentaire', async () => {
            mockElements.commentInput.value = 'Test comment';
            mockApiService.addComment.mockResolvedValue({ success: true, emailSent: true });
            
            await operInterface.handleAddComment();
            
            expect(mockApiService.addComment).toHaveBeenCalled();
            expect(mockNotificationManager.success).toHaveBeenCalled();
            expect(operInterface.loadComments).toHaveBeenCalled();
        });

        it('devrait gérer les erreurs', async () => {
            mockElements.commentInput.value = 'Test comment';
            mockApiService.addComment.mockRejectedValue(new Error('Erreur'));
            
            await operInterface.handleAddComment();
            
            expect(mockNotificationManager.error).toHaveBeenCalled();
        });
    });

    describe('loadOperatorHistory', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
        });

        it('devrait charger l\'historique avec succès', async () => {
            const mockOperations = [
                { lancementCode: 'LT123', status: 'TERMINE', startTime: '10:00', endTime: '11:00' }
            ];
            mockApiService.get.mockResolvedValue({ success: true, operations: mockOperations });
            operInterface.displayOperatorHistory = vi.fn();
            
            await operInterface.loadOperatorHistory();
            
            expect(mockApiService.get).toHaveBeenCalledWith('/operators/OP001/operations');
            expect(operInterface.displayOperatorHistory).toHaveBeenCalledWith(mockOperations);
        });

        it('devrait gérer les erreurs de chargement', async () => {
            mockApiService.get.mockRejectedValue(new Error('Erreur réseau'));
            
            await operInterface.loadOperatorHistory();
            
            expect(mockElements.operatorHistoryTableBody.innerHTML).toContain('Erreur de connexion');
        });
    });

    describe('displayOperatorHistory', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
        });

        it('devrait afficher les opérations', () => {
            const operations = [
                {
                    lancementCode: 'LT123',
                    article: 'ART001',
                    phase: 'PRODUCTION',
                    startTime: '10:00',
                    endTime: '11:00',
                    status: 'Terminé',
                    statusCode: 'TERMINE'
                }
            ];
            
            operInterface.displayOperatorHistory(operations);
            
            expect(mockElements.operatorHistoryTableBody.innerHTML).toContain('LT123');
        });

        it('devrait afficher un message si aucune opération', () => {
            operInterface.displayOperatorHistory([]);
            
            expect(mockElements.operatorHistoryTableBody.innerHTML).toContain('Aucun lancement trouvé');
        });
    });

    describe('getCurrentLancement', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
        });

        it('devrait retourner le lancement actuel', () => {
            const lancement = { CodeLancement: 'LT123' };
            operInterface.currentLancement = lancement;
            
            expect(operInterface.getCurrentLancement()).toBe(lancement);
        });
    });

    describe('getTimerStatus', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
        });

        it('devrait retourner le statut du timer', () => {
            operInterface.isRunning = true;
            operInterface.startTime = new Date();
            
            const status = operInterface.getTimerStatus();
            
            expect(status.isRunning).toBe(true);
            expect(status.startTime).toBeInstanceOf(Date);
        });
    });

    describe('escapeHtml', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
        });

        it('devrait échapper les caractères HTML', () => {
            const result = operInterface.escapeHtml('<script>alert("xss")</script>');
            expect(result).not.toContain('<script>');
        });
    });

    describe('canDeleteComment', () => {
        beforeEach(() => {
            operInterface = new OperateurInterface(mockOperator, mockApp);
        });

        it('devrait retourner true si l\'opérateur peut supprimer', () => {
            const comment = { operatorCode: 'OP001' };
            expect(operInterface.canDeleteComment(comment)).toBe(true);
        });

        it('devrait retourner false si l\'opérateur ne peut pas supprimer', () => {
            const comment = { operatorCode: 'OP002' };
            expect(operInterface.canDeleteComment(comment)).toBe(false);
        });
    });
});









