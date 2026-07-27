import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import AdminPage from '../../components/AdminPage.js';

// Mock des dépendances
vi.mock('../../utils/TimeUtils.js', () => ({
  default: {
    parseDuration: vi.fn((str) => {
      if (!str) return 0;
      const parts = str.split(':');
      if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
      }
      return 0;
    }),
    formatDuration: vi.fn((seconds) => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    })
  }
}));

describe('AdminPage', () => {
  let adminPage;
  let mockApp;
  let mockApiService;
  let mockNotificationManager;

  beforeEach(() => {
    // Mock de l'application
    mockNotificationManager = {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      show: vi.fn()
    };

    mockApiService = {
      getAdminData: vi.fn(),
      getConnectedOperators: vi.fn(),
      getAllOperators: vi.fn(),
      getMonitoringTemps: vi.fn(),
      getLancementSteps: vi.fn(),
      consolidateMonitoringBatch: vi.fn(),
      validateAndTransmitMonitoringBatch: vi.fn(),
      correctMonitoringTemps: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      updateOperation: vi.fn(),
      deleteOperation: vi.fn(),
      validateLancementCode: vi.fn(),
      getTablesInfo: vi.fn()
    };

    mockApp = {
      getApiService: vi.fn(() => mockApiService),
      getNotificationManager: vi.fn(() => mockNotificationManager)
    };

    // Setup DOM
    document.body.innerHTML = `
      <button id="refreshDataBtn"></button>
      <span id="totalOperators"></span>
      <span id="activeLancements"></span>
      <span id="pausedLancements"></span>
      <span id="completedLancements"></span>
      <table><tbody id="operationsTableBody"></tbody></table>
      <select id="operatorFilter"></select>
      <select id="statusFilter"></select>
      <input id="searchFilter" />
      <button id="clearFiltersBtn"></button>
      <button id="transferBtn"></button>
      <button id="addOperationBtn"></button>
      <div id="paginationInfo"></div>
      <div id="activeOperatorsIndicator"></div>
      <span id="pauseCount"></span>
      <span id="tempCount"></span>
      <table><tbody id="pauseTableBody"></tbody></table>
      <table><tbody id="tempTableBody"></tbody></table>
    `;

    // Mock setTimeout et setInterval
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    if (adminPage) {
      if (adminPage.refreshInterval) clearInterval(adminPage.refreshInterval);
      if (adminPage.operatorsInterval) clearInterval(adminPage.operatorsInterval);
      if (adminPage.autoSaveTimer) clearInterval(adminPage.autoSaveTimer);
    }
  });

  describe('constructor', () => {
    it('should initialize AdminPage', () => {
      adminPage = new AdminPage(mockApp);
      expect(adminPage.app).toBe(mockApp);
      expect(adminPage.apiService).toBe(mockApiService);
      expect(adminPage.notificationManager).toBe(mockNotificationManager);
      expect(adminPage.operations).toEqual([]);
      expect(adminPage.stats).toEqual({});
      expect(adminPage.currentPage).toBe(1);
      expect(adminPage.autoSaveEnabled).toBe(true);
    });
  });

  describe('initializeElements', () => {
    it('should initialize all elements', () => {
      adminPage = new AdminPage(mockApp);
      expect(adminPage.refreshDataBtn).toBeTruthy();
      expect(adminPage.totalOperators).toBeTruthy();
      expect(adminPage.operationsTableBody).toBeTruthy();
    });

    it('should create fallback for missing operationsTableBody', () => {
      document.getElementById('operationsTableBody')?.remove();
      adminPage = new AdminPage(mockApp);
      expect(adminPage.operationsTableBody).toBeTruthy();
    });
  });

  describe('addEventListenerSafe', () => {
    it('should add event listener safely', () => {
      adminPage = new AdminPage(mockApp);
      const element = document.getElementById('refreshDataBtn');
      const handler = vi.fn();
      adminPage.addEventListenerSafe('refreshDataBtn', 'click', handler);
      element.click();
      expect(handler).toHaveBeenCalled();
    });

    it('should handle missing element', () => {
      adminPage = new AdminPage(mockApp);
      const handler = vi.fn();
      adminPage.addEventListenerSafe('nonexistent', 'click', handler);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('loadData', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
    });

    it('should load data successfully', async () => {
      mockApiService.getAdminData.mockResolvedValue({
        operations: [{ id: 1, lancementCode: 'LT001' }],
        stats: { totalOperators: 5, activeLancements: 2 },
        pagination: { currentPage: 1, totalPages: 1 }
      });
      mockApiService.getConnectedOperators.mockResolvedValue({
        success: true,
        operators: [{ code: 'OP001', name: 'Test' }]
      });
      mockApiService.getAllOperators.mockResolvedValue({
        success: true,
        operators: [{ code: 'OP001', name: 'Test' }]
      });
      mockApiService.getMonitoringTemps.mockResolvedValue({
        success: true,
        data: [],
        count: 0
      });

      await adminPage.loadData();

      expect(adminPage.operations.length).toBe(1);
      expect(adminPage.stats.totalOperators).toBe(5);
    });

    it('should handle loading state', async () => {
      adminPage.isLoading = true;
      await adminPage.loadData();
      expect(mockApiService.getAdminData).not.toHaveBeenCalled();
    });

    it('should handle timeout error', async () => {
      if (adminPage.refreshInterval) clearInterval(adminPage.refreshInterval);
      if (adminPage.operatorsInterval) clearInterval(adminPage.operatorsInterval);
      if (adminPage.autoSaveTimer) clearInterval(adminPage.autoSaveTimer);

      vi.useRealTimers();
      const realSetTimeout = global.setTimeout;
      const setTimeoutSpy = vi
        .spyOn(global, 'setTimeout')
        .mockImplementation((fn, _ms, ...args) => realSetTimeout(fn, 0, ...args));

      mockApiService.getAdminData.mockImplementation(() => new Promise(() => {}));
      mockApiService.getConnectedOperators.mockImplementation(() => new Promise(() => {}));
      mockApiService.getAllOperators.mockImplementation(() => new Promise(() => {}));
      mockApiService.getMonitoringTemps.mockImplementation(() => new Promise(() => {}));

      const loadPromise = adminPage.loadData();
      const handledPromise = loadPromise.catch((e) => { throw e; });
      await expect(handledPromise).rejects.toThrow();

      setTimeoutSpy.mockRestore();
    });

    it('should handle error and show cached data', async () => {
      adminPage.operations = [{ id: 1 }];
      mockApiService.getAdminData.mockRejectedValue(new Error('Network error'));
      await adminPage.loadData().catch(() => {});
      expect(adminPage.operations.length).toBe(1);
    });

    it('should increment consecutive errors', async () => {
      mockApiService.getAdminData.mockRejectedValue(new Error('Error'));
      await adminPage.loadData().catch(() => {});
      expect(adminPage.consecutiveErrors).toBe(1);
    });
  });

  describe('updateStats', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
    });

    it('should update stats display', () => {
      adminPage.stats = {
        totalOperators: 10,
        activeLancements: 5,
        pausedLancements: 2,
        completedLancements: 3
      };
      adminPage.operations = Array.from({ length: 5 }).map((_, i) => ({
        id: i + 1,
        statusCode: 'EN_COURS',
        StatusCode: 'EN_COURS',
        operatorCode: `OP${String(i + 1).padStart(3, '0')}`,
        LancementCode: `LT${String(i + 1).padStart(7, '0')}`
      }));
      adminPage.updateStats();
      expect(adminPage.totalOperators.textContent).toBe('10');
      expect(adminPage.activeLancements.textContent).toBe('5');
    });
  });

  describe('updateOperationsTable', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
    });

    it('should display operations', () => {
      adminPage.operations = [
        {
          id: 1,
          operatorName: 'Test',
          lancementCode: 'LT001',
          article: 'ART001',
          startTime: '08:00',
          endTime: '10:00',
          status: 'Terminé',
          statusCode: 'TERMINE'
        }
      ];
      adminPage.updateOperationsTable();
      expect(adminPage.operationsTableBody.children.length).toBeGreaterThan(0);
    });

    it('should filter by status', () => {
      adminPage.operations = [
        { id: 1, lancementCode: 'LT001', statusCode: 'EN_COURS', status: 'En cours' },
        { id: 2, lancementCode: 'LT002', statusCode: 'TERMINE', status: 'Terminé' }
      ];
      document.getElementById('statusFilter').value = 'EN_COURS';
      adminPage.updateOperationsTable();
      const rows = adminPage.operationsTableBody.querySelectorAll('tr');
      expect(rows.length).toBeGreaterThan(0);
    });

    it('should filter by search', () => {
      adminPage.operations = [
        { id: 1, lancementCode: 'LT001', statusCode: 'EN_COURS', status: 'En cours' },
        { id: 2, lancementCode: 'LT002', statusCode: 'TERMINE', status: 'Terminé' }
      ];
      document.getElementById('searchFilter').value = 'LT001';
      adminPage.updateOperationsTable();
      const rows = adminPage.operationsTableBody.querySelectorAll('tr');
      expect(rows.length).toBeGreaterThan(0);
    });

    it('should show empty message when no operations', () => {
      adminPage.operations = [];
      adminPage.updateOperationsTable();
      expect(adminPage.operationsTableBody.innerHTML).toContain('Aucun enregistrement');
    });
  });

  describe('formatDateTime', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
    });

    it('should format time string', () => {
      expect(adminPage.formatDateTime('08:30')).toBe('08:30');
      expect(adminPage.formatDateTime('08:30:00')).toBe('08:30');
    });

    it('should format date object', () => {
      const date = new Date('2024-01-15T08:30:00Z');
      const result = adminPage.formatDateTime(date);
      expect(result).toMatch(/\d{2}:\d{2}/);
    });

    it('should return dash for null', () => {
      expect(adminPage.formatDateTime(null)).toBe('-');
      expect(adminPage.formatDateTime(undefined)).toBe('-');
    });
  });

  describe('editOperation', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
      adminPage.operations = [
        {
          id: 1,
          EventId: 1,
          _isUnconsolidated: true,
          lancementCode: 'LT001',
          LancementCode: 'LT001',
          startTime: '08:00',
          StartTime: '08:00',
          endTime: '10:00',
          EndTime: '10:00',
          statusCode: 'EN_COURS',
          status: 'En cours'
        }
      ];
      global.prompt = vi.fn();
    });

    it('should edit operation', async () => {
      global.prompt
        .mockReturnValueOnce('LT001')
        .mockReturnValueOnce('09:00')
        .mockReturnValueOnce('10:00');
      mockApiService.updateOperation.mockResolvedValue({ success: true });
      adminPage.loadData = vi.fn().mockResolvedValue(undefined);

      await adminPage.editOperation(1);

      expect(mockApiService.updateOperation).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ startTime: '09:00' })
      );
    });

    it('should handle missing operation', async () => {
      adminPage.loadData = vi.fn().mockResolvedValue(undefined);
      await adminPage.editOperation(999);
      expect(mockNotificationManager.warning).toHaveBeenCalled();
    });
  });

  describe('saveOperation', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
      adminPage.operations = [
        {
          id: 1,
          EventId: 1,
          _isUnconsolidated: true,
          lancementCode: 'LT001',
          LancementCode: 'LT001',
          OperatorCode: 'OP001',
          startTime: '08:00',
          StartTime: '08:00',
          endTime: '10:00',
          EndTime: '10:00',
          statusCode: 'EN_COURS',
          StatusCode: 'EN_COURS',
          status: 'En cours',
          Status: 'En cours'
        }
      ];
    });

    it('should save operation successfully', async () => {
      adminPage.updateOperationsTable();
      const row = adminPage.operationsTableBody.querySelector('tr[data-operation-id="1"]');
      expect(row).toBeTruthy();
      adminPage.editOperationInline(1);

      const startInput = row.querySelector('input[data-field="startTime"]');
      expect(startInput).toBeTruthy();
      startInput.value = '09:00';

      mockApiService.updateOperation.mockResolvedValue({ success: true });
      adminPage.loadData = vi.fn().mockResolvedValue(undefined);
      await adminPage.saveOperation(1);
      expect(mockApiService.updateOperation).toHaveBeenCalled();
    });

    it('should validate time consistency', async () => {
      adminPage.updateOperationsTable();
      const row = adminPage.operationsTableBody.querySelector('tr[data-operation-id="1"]');
      expect(row).toBeTruthy();
      adminPage.editOperationInline(1);

      const startInput = row.querySelector('input[data-field="startTime"]');
      const endInput = row.querySelector('input[data-field="endTime"]');
      expect(startInput).toBeTruthy();
      expect(endInput).toBeTruthy();
      startInput.value = '10:00';
      endInput.value = '08:00';
      await adminPage.saveOperation(1);
      expect(mockNotificationManager.error).toHaveBeenCalled();
    });
  });

  describe('deleteOperation', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
      global.confirm = vi.fn(() => true);
    });

    it('should delete operation', async () => {
      mockApiService.deleteOperation.mockResolvedValue({ success: true });
      adminPage.loadData = vi.fn();
      await adminPage.deleteOperation(1);
      expect(mockApiService.deleteOperation).toHaveBeenCalledWith(1);
    });

    it('should not delete if cancelled', async () => {
      global.confirm = vi.fn(() => false);
      await adminPage.deleteOperation(1);
      expect(mockApiService.deleteOperation).not.toHaveBeenCalled();
    });
  });

  describe('handleAddOperation', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
      global.prompt = vi.fn();
      global.confirm = vi.fn();
    });

    it('should add operation', async () => {
      global.prompt
        .mockReturnValueOnce('12345')
        .mockReturnValueOnce('LT001')
        .mockReturnValueOnce('');
      mockApiService.getLancementSteps.mockResolvedValue({
        steps: [],
        uniqueSteps: [],
        stepCount: 0
      });
      mockApiService.post.mockResolvedValue({ success: true });
      adminPage.loadData = vi.fn().mockResolvedValue(undefined);

      const promise = adminPage.handleAddOperation();
      await vi.advanceTimersByTimeAsync(500);
      await promise;

      expect(mockApiService.post).toHaveBeenCalled();
    });

    it('should not add if cancelled', async () => {
      global.prompt.mockReturnValueOnce(null);
      await adminPage.handleAddOperation();
      expect(mockApiService.post).not.toHaveBeenCalled();
    });
  });

  describe('handleTransfer', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
      global.confirm = vi.fn(() => true);
    });

    it('should transfer operations', async () => {
      adminPage.operations = [{
        TempsId: 1,
        OperatorCode: 'OP001',
        LancementCode: 'LT001',
        Status: 'Terminé',
        StatusCode: 'TERMINE',
        EndTime: '10:00',
        StatutTraitement: null
      }];
      mockApiService.validateAndTransmitMonitoringBatch.mockResolvedValue({
        success: true,
        count: 1
      });
      adminPage.loadData = vi.fn().mockResolvedValue(undefined);
      global.confirm
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      await adminPage.handleTransfer();

      expect(mockApiService.validateAndTransmitMonitoringBatch).toHaveBeenCalled();
      expect(mockNotificationManager.success).toHaveBeenCalled();
    });

    it('should not transfer if cancelled', async () => {
      global.confirm = vi.fn(() => false);
      await adminPage.handleTransfer();
      expect(mockApiService.post).not.toHaveBeenCalled();
    });
  });

  describe('autoSave', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
    });

    it('should start auto save', () => {
      adminPage.startAutoSave();
      expect(adminPage.autoSaveTimer).toBeTruthy();
    });

    it('should stop auto save', () => {
      adminPage.startAutoSave();
      adminPage.stopAutoSave();
      expect(adminPage.autoSaveTimer).toBeNull();
    });

    it('should add pending change', () => {
      adminPage.addPendingChange(1, 'startTime', '08:00');
      expect(adminPage.pendingChanges.has(1)).toBe(true);
    });

    it('should process auto save', async () => {
      adminPage.addPendingChange(1, 'startTime', '08:00');
      adminPage.operations = [{ id: 1 }];
      adminPage.saveOperationChanges = vi.fn().mockResolvedValue({ success: true });
      await adminPage.processAutoSave();
      expect(adminPage.pendingChanges.size).toBe(0);
    });
  });

  describe('updateOperatorSelect', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
    });

    it('should update operator select', () => {
      const operators = [
        { code: 'OP001', name: 'Test 1', isActive: true, isProperlyLinked: true },
        { code: 'OP002', name: 'Test 2', isActive: false, isProperlyLinked: false }
      ];
      adminPage.updateOperatorSelect(operators);
      expect(adminPage.operatorSelect.querySelectorAll('option').length).toBe(3);
    });
  });

  describe('resetConsecutiveErrors', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
    });

    it('should reset error counter', () => {
      adminPage.consecutiveErrors = 5;
      adminPage.resetConsecutiveErrors();
      expect(adminPage.consecutiveErrors).toBe(0);
    });
  });

  describe('exportToCSV', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
      global.URL.createObjectURL = vi.fn(() => 'blob:url');
      global.URL.revokeObjectURL = vi.fn();
    });

    it('should export to CSV', () => {
      adminPage.operations = [
        {
          operatorName: 'Test',
          lancementCode: 'LT001',
          article: 'ART001',
          startTime: '08:00',
          endTime: '10:00',
          duration: '02:00:00',
          status: 'Terminé'
        }
      ];
      const link = { click: vi.fn(), setAttribute: vi.fn(), style: {} };
      document.createElement = vi.fn(() => link);
      document.body.appendChild = vi.fn();
      document.body.removeChild = vi.fn();
      adminPage.exportToCSV();
      expect(link.click).toHaveBeenCalled();
    });

    it('should warn if no data', () => {
      adminPage.operations = [];
      adminPage.exportToCSV();
      expect(mockNotificationManager.warning).toHaveBeenCalled();
    });
  });

  describe('timeToMinutes', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
    });

    it('should convert time to minutes', () => {
      expect(adminPage.timeToMinutes('08:30')).toBe(510);
      expect(adminPage.timeToMinutes('00:00')).toBe(0);
    });

    it('should handle invalid time', () => {
      expect(adminPage.timeToMinutes('')).toBe(0);
      expect(adminPage.timeToMinutes(null)).toBe(0);
    });
  });

  describe('validateAndFormatTime', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
    });

    it('should validate and format time', () => {
      expect(adminPage.validateAndFormatTime('08:30')).toBe('08:30');
      expect(adminPage.validateAndFormatTime('8:30')).toBe('08:30');
    });

    it('should return null for invalid time', () => {
      expect(adminPage.validateAndFormatTime('25:00')).toBeNull();
      expect(adminPage.validateAndFormatTime('08:60')).toBeNull();
    });
  });
});


