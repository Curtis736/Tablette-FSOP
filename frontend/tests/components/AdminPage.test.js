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
      getMonitoringTemps: vi.fn(),
      validateMonitoringTemps: vi.fn(),
      onHoldMonitoringTemps: vi.fn(),
      validateAndTransmitMonitoringBatch: vi.fn(),
      deleteMonitoringTemps: vi.fn(),
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
      <button id="validateSelectedBtn"></button>
      <button id="onHoldSelectedBtn"></button>
      <button id="transmitSelectedBtn"></button>
      <input id="selectAllRows" type="checkbox" />
      <span id="totalOperators"></span>
      <span id="activeLancements"></span>
      <span id="pausedLancements"></span>
      <span id="completedLancements"></span>
      <tbody id="operationsTableBody"></tbody>
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
      <tbody id="pauseTableBody"></tbody>
      <tbody id="tempTableBody"></tbody>
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
      document.getElementById('operationsTableBody').remove();
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
      const today = new Date().toISOString().split('T')[0];
      mockApiService.getAdminData.mockResolvedValue({
        operations: [{ id: 1, lancementCode: 'LT001' }],
        stats: { totalOperators: 5, activeLancements: 2 },
        pagination: { currentPage: 1, totalPages: 1 }
      });
      mockApiService.getConnectedOperators.mockResolvedValue({
        success: true,
        operators: [{ code: 'OP001', name: 'Test' }]
      });
      mockApiService.getMonitoringTemps.mockResolvedValue({
        success: true,
        data: [{ TempsId: 1, OperatorName: 'Test', LancementCode: 'LT001', StatutTraitement: null }],
        count: 1
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
      mockApiService.getAdminData.mockImplementation(() => 
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
      );
      vi.advanceTimersByTime(30000);
      await expect(adminPage.loadData()).rejects.toThrow();
    });

    it('should handle error and show cached data', async () => {
      adminPage.operations = [{ id: 1 }];
      mockApiService.getAdminData.mockRejectedValue(new Error('Network error'));
      await adminPage.loadData();
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
          TempsId: 1,
          OperatorName: 'Test',
          OperatorCode: 'OP001',
          LancementCode: 'LT001',
          LancementName: 'DESIGNATION',
          StartTime: '08:00',
          EndTime: '10:00',
          StatutTraitement: null
        }
      ];
      adminPage.updateOperationsTable();
      expect(adminPage.operationsTableBody.children.length).toBeGreaterThan(0);
    });

    it('should filter by status', () => {
      adminPage.operations = [
        { TempsId: 1, LancementCode: 'LT001', StatutTraitement: null },
        { TempsId: 2, LancementCode: 'LT002', StatutTraitement: 'T' }
      ];
      document.getElementById('statusFilter').value = 'T';
      adminPage.updateOperationsTable();
      const rows = adminPage.operationsTableBody.querySelectorAll('tr');
      expect(rows.length).toBeGreaterThan(0);
    });

    it('should filter by search', () => {
      adminPage.operations = [
        { TempsId: 1, LancementCode: 'LT001', StatutTraitement: null },
        { TempsId: 2, LancementCode: 'LT002', StatutTraitement: 'O' }
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

  describe.skip('editOperation', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
      adminPage.operations = [
        {
          id: 1,
          lancementCode: 'LT001',
          startTime: '08:00',
          endTime: '10:00',
          statusCode: 'EN_COURS',
          status: 'En cours'
        }
      ];
    });

    it('should edit operation', () => {
      adminPage.updateOperationsTable();
      const row = adminPage.operationsTableBody.querySelector('tr');
      if (row) {
        row.setAttribute('data-operation-id', '1');
        adminPage.editOperation(1);
        const timeInputs = row.querySelectorAll('input[type="time"]');
        expect(timeInputs.length).toBeGreaterThan(0);
      }
    });

    it('should handle missing operation', () => {
      adminPage.editOperation(999);
      expect(mockNotificationManager.warning).toHaveBeenCalled();
    });
  });

  describe.skip('saveOperation', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
      adminPage.operations = [
        {
          id: 1,
          lancementCode: 'LT001',
          startTime: '08:00',
          endTime: '10:00',
          statusCode: 'EN_COURS',
          status: 'En cours'
        }
      ];
    });

    it('should save operation successfully', async () => {
      adminPage.updateOperationsTable();
      const row = adminPage.operationsTableBody.querySelector('tr');
      if (row) {
        row.setAttribute('data-operation-id', '1');
        adminPage.editOperation(1);
        await vi.advanceTimersByTimeAsync(100);
        
        mockApiService.updateOperation.mockResolvedValue({ success: true });
        await adminPage.saveOperation(1);
        expect(mockApiService.updateOperation).toHaveBeenCalled();
      }
    });

    it('should validate time consistency', async () => {
      adminPage.updateOperationsTable();
      const row = adminPage.operationsTableBody.querySelector('tr');
      if (row) {
        row.setAttribute('data-operation-id', '1');
        adminPage.editOperation(1);
        await vi.advanceTimersByTimeAsync(100);
        
        const startInput = row.querySelector('input[data-field="startTime"]');
        const endInput = row.querySelector('input[data-field="endTime"]');
        if (startInput && endInput) {
          startInput.value = '10:00';
          endInput.value = '08:00';
          mockApiService.updateOperation.mockResolvedValue({ success: true });
          await adminPage.saveOperation(1);
          expect(mockNotificationManager.error).toHaveBeenCalled();
        }
      }
    });
  });

  describe.skip('deleteOperation', () => {
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

  describe.skip('handleAddOperation', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
      global.prompt = vi.fn();
      global.confirm = vi.fn();
    });

    it('should add operation', async () => {
      global.prompt
        .mockReturnValueOnce('OP001')
        .mockReturnValueOnce('LT001')
        .mockReturnValueOnce('PHASE1');
      mockApiService.post.mockResolvedValue({ success: true });
      adminPage.loadData = vi.fn();
      await adminPage.handleAddOperation();
      expect(mockApiService.post).toHaveBeenCalled();
    });

    it('should not add if cancelled', async () => {
      global.prompt.mockReturnValueOnce(null);
      await adminPage.handleAddOperation();
      expect(mockApiService.post).not.toHaveBeenCalled();
    });
  });

  describe.skip('handleTransfer', () => {
    beforeEach(() => {
      adminPage = new AdminPage(mockApp);
      global.confirm = vi.fn(() => true);
    });

    it('should transfer operations', async () => {
      mockApiService.post.mockResolvedValue({ success: true, transferredCount: 5 });
      adminPage.loadData = vi.fn();
      await adminPage.handleTransfer();
      expect(mockApiService.post).toHaveBeenCalled();
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
      expect(adminPage.operatorSelect.children.length).toBe(3); // Default + 2 operators
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
      const link = { click: vi.fn(), setAttribute: vi.fn() };
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


