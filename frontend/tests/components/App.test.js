import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import App from '../../components/App.js';

// Mock des dépendances
vi.mock('../../components/OperateurInterface.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    loadLancements: vi.fn()
  }))
}));

vi.mock('../../components/AdminPage.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    loadData: vi.fn()
  }))
}));

vi.mock('../../services/ApiService.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    getOperator: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ status: 'ok' })
  }))
}));

vi.mock('../../services/StorageService.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    getCurrentOperator: vi.fn(),
    setCurrentOperator: vi.fn(),
    clearCurrentOperator: vi.fn(),
    clearAllCache: vi.fn()
  }))
}));

vi.mock('../../utils/NotificationManager.js', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn()
  }
}));

describe('App', () => {
  let app;
  let mockDocument;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="loginScreen" class="screen"></div>
      <div id="operatorScreen" class="screen"></div>
      <div id="adminScreen" class="screen"></div>
      <div id="adminLoginScreen" class="screen"></div>
      <div id="currentOperator"></div>
      <form id="loginForm"></form>
      <form id="adminLoginForm"></form>
      <button id="logoutBtn"></button>
      <button id="backToOperatorBtn"></button>
      <button id="adminModeBtn"></button>
      <button id="backToLoginBtn"></button>
      <input id="operatorCode" />
      <input id="adminUsername" />
      <input id="adminPassword" />
    `;
    
    global.window.location = {
      protocol: 'http:',
      hostname: 'localhost',
      port: '8080'
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize app', () => {
      app = new App();
      expect(app.currentScreen).toBe('login');
      expect(app.currentOperator).toBeNull();
      expect(app.isAdmin).toBe(false);
    });
  });

  describe('showLoginScreen', () => {
    it('should show login screen', () => {
      app = new App();
      app.showLoginScreen();
      expect(document.getElementById('loginScreen').classList.contains('active')).toBe(true);
      expect(app.currentScreen).toBe('login');
    });
  });

  describe('showOperatorScreen', () => {
    it('should show operator screen', () => {
      app = new App();
      app.currentOperator = { code: 'OP001', nom: 'Test' };
      app.showOperatorScreen();
      expect(document.getElementById('operatorScreen').classList.contains('active')).toBe(true);
      expect(app.currentScreen).toBe('operator');
    });
  });

  describe('showAdminLoginScreen', () => {
    it('should show admin login screen', () => {
      app = new App();
      app.showAdminLoginScreen();
      expect(document.getElementById('adminLoginScreen').classList.contains('active')).toBe(true);
      expect(app.currentScreen).toBe('adminLogin');
    });
  });

  describe('showAdminScreen', () => {
    it('should show admin screen', async () => {
      app = new App();
      await app.showAdminScreen();
      expect(document.getElementById('adminScreen').classList.contains('active')).toBe(true);
      expect(app.currentScreen).toBe('admin');
    });
  });

  describe('handleLogin', () => {
    it('should handle successful login', async () => {
      app = new App();
      const mockOperator = { code: 'OP001', nom: 'Test' };
      app.apiService.operatorLogin = vi.fn().mockResolvedValue({ operator: mockOperator });
      
      document.getElementById('operatorCode').value = 'OP001';
      const event = { preventDefault: vi.fn() };
      
      await app.handleLogin(event);
      
      expect(event.preventDefault).toHaveBeenCalled();
      expect(app.currentOperator).toEqual(mockOperator);
    });

    it('should handle login error', async () => {
      app = new App();
      app.apiService.operatorLogin = vi.fn().mockRejectedValue(new Error('Not found'));
      
      document.getElementById('operatorCode').value = 'OP001';
      const event = { preventDefault: vi.fn() };
      
      await app.handleLogin(event);
      expect(app.currentOperator).toBeNull();
    });

    it('should not login with empty code', async () => {
      app = new App();
      document.getElementById('operatorCode').value = '';
      const event = { preventDefault: vi.fn() };
      
      await app.handleLogin(event);
      expect(app.currentOperator).toBeNull();
    });
  });

  describe('handleAdminLogin', () => {
    it('should handle successful admin login', async () => {
      app = new App();
      app.apiService.adminLogin = vi.fn().mockResolvedValue({ success: true, user: { name: 'Admin' } });
      
      document.getElementById('adminUsername').value = 'admin';
      document.getElementById('adminPassword').value = 'password';
      const event = { preventDefault: vi.fn() };
      
      await app.handleAdminLogin(event);
      
      expect(app.isAdmin).toBe(true);
    });

    it('should handle failed admin login', async () => {
      app = new App();
      app.apiService.adminLogin = vi.fn().mockResolvedValue({ success: false });
      
      document.getElementById('adminUsername').value = 'admin';
      document.getElementById('adminPassword').value = 'wrong';
      const event = { preventDefault: vi.fn() };
      
      await app.handleAdminLogin(event);
      
      expect(app.isAdmin).toBe(false);
    });
  });

  describe('handleLogout', () => {
    it('should handle logout', () => {
      app = new App();
      app.currentOperator = { code: 'OP001' };
      app.isAdmin = true;
      
      app.handleLogout();
      
      expect(app.currentOperator).toBeNull();
      expect(app.isAdmin).toBe(false);
    });
  });

  describe('getApiService', () => {
    it('should return api service', () => {
      app = new App();
      expect(app.getApiService()).toBe(app.apiService);
    });
  });

  describe('getNotificationManager', () => {
    it('should return notification manager', () => {
      app = new App();
      expect(app.getNotificationManager()).toBeDefined();
    });
  });

  describe('getStorageService', () => {
    it('should return storage service', () => {
      app = new App();
      expect(app.getStorageService()).toBe(app.storageService);
    });
  });

  describe('showLoading', () => {
    it('should show loading state', () => {
      app = new App();
      app.showLoading(true);
      const buttons = document.querySelectorAll('#loginForm button, #adminLoginForm button');
      buttons.forEach(btn => {
        expect(btn.disabled).toBe(true);
      });
    });

    it('should hide loading state', () => {
      app = new App();
      app.showLoading(false);
      const buttons = document.querySelectorAll('#loginForm button, #adminLoginForm button');
      buttons.forEach(btn => {
        expect(btn.disabled).toBe(false);
      });
    });
  });
});

