import { describe, it, expect, beforeEach, vi } from 'vitest';
import StorageService from '../../services/StorageService.js';

describe('StorageService', () => {
  let service;
  let mockLocalStorage;

  beforeEach(() => {
    mockLocalStorage = {
      data: {},
      getItem: vi.fn((key) => mockLocalStorage.data[key] || null),
      setItem: vi.fn((key, value) => {
        mockLocalStorage.data[key] = value;
        // Simuler un localStorage réel: les clés sont énumérables sur l'objet
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key) => {
        delete mockLocalStorage.data[key];
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => { mockLocalStorage.data = {}; }),
      hasOwnProperty: vi.fn((key) => key in mockLocalStorage.data)
    };
    global.localStorage = mockLocalStorage;
    service = new StorageService();
  });

  describe('getCurrentOperator', () => {
    it('should get current operator', () => {
      const operator = { code: 'OP001', nom: 'Test' };
      mockLocalStorage.setItem('currentOperator', JSON.stringify(operator));
      expect(service.getCurrentOperator()).toEqual(operator);
    });

    it('should return null if no operator', () => {
      expect(service.getCurrentOperator()).toBeNull();
    });

    it('should handle invalid JSON', () => {
      mockLocalStorage.setItem('currentOperator', 'invalid json');
      expect(service.getCurrentOperator()).toBeNull();
    });
  });

  describe('setCurrentOperator', () => {
    it('should set current operator', () => {
      const operator = { code: 'OP001', nom: 'Test' };
      service.setCurrentOperator(operator);
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('currentOperator', JSON.stringify(operator));
    });

    it('should remove operator if null', () => {
      service.setCurrentOperator(null);
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('currentOperator');
    });
  });

  describe('clearCurrentOperator', () => {
    it('should clear current operator', () => {
      service.clearCurrentOperator();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('currentOperator');
    });
  });

  describe('getUserPreferences', () => {
    it('should get user preferences', () => {
      const prefs = { theme: 'dark' };
      mockLocalStorage.setItem('userPreferences', JSON.stringify(prefs));
      expect(service.getUserPreferences()).toEqual(prefs);
    });

    it('should return default preferences if none', () => {
      const prefs = service.getUserPreferences();
      expect(prefs.theme).toBe('light');
      expect(prefs.language).toBe('fr');
    });
  });

  describe('setUserPreferences', () => {
    it('should set user preferences', () => {
      service.setUserPreferences({ theme: 'dark' });
      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });
  });

  describe('getAppSettings', () => {
    it('should get app settings', () => {
      const settings = { apiUrl: 'http://test' };
      mockLocalStorage.setItem('appSettings', JSON.stringify(settings));
      expect(service.getAppSettings()).toEqual(settings);
    });

    it('should return default settings if none', () => {
      const settings = service.getAppSettings();
      expect(settings).toHaveProperty('apiUrl');
      expect(settings).toHaveProperty('timeout');
    });
  });

  describe('setAppSettings', () => {
    it('should set app settings', () => {
      service.setAppSettings({ timeout: 60000 });
      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });
  });

  describe('setCacheData', () => {
    it('should set cache data', () => {
      service.setCacheData('test', { data: 'value' });
      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });
  });

  describe('getCacheData', () => {
    it('should get cache data', () => {
      const cacheItem = {
        data: { value: 'test' },
        timestamp: Date.now(),
        ttl: 300000
      };
      mockLocalStorage.setItem('cacheData_test', JSON.stringify(cacheItem));
      expect(service.getCacheData('test')).toEqual({ value: 'test' });
    });

    it('should return null if cache expired', () => {
      const cacheItem = {
        data: { value: 'test' },
        timestamp: Date.now() - 400000,
        ttl: 300000
      };
      mockLocalStorage.setItem('cacheData_test', JSON.stringify(cacheItem));
      expect(service.getCacheData('test')).toBeNull();
    });

    it('should return null if no cache', () => {
      expect(service.getCacheData('nonexistent')).toBeNull();
    });
  });

  describe('clearCacheData', () => {
    it('should clear cache data', () => {
      service.clearCacheData('test');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('cacheData_test');
    });
  });

  describe('clearAllCache', () => {
    it('should clear all cache', () => {
      mockLocalStorage.data = {
        'cacheData_test1': 'value1',
        'cacheData_test2': 'value2',
        'other': 'value'
      };
      // Refléter ces clés sur l'objet lui-même pour Object.keys(localStorage)
      Object.entries(mockLocalStorage.data).forEach(([k, v]) => (mockLocalStorage[k] = v));
      service.clearAllCache();
      expect(mockLocalStorage.removeItem).toHaveBeenCalled();
    });
  });

  describe('clearAll', () => {
    it('should clear all storage', () => {
      service.clearAll();
      expect(mockLocalStorage.clear).toHaveBeenCalled();
    });
  });

  describe('getStorageSize', () => {
    it('should calculate storage size', () => {
      mockLocalStorage.data = { key1: 'value1', key2: 'value2' };
      Object.entries(mockLocalStorage.data).forEach(([k, v]) => (mockLocalStorage[k] = v));
      const size = service.getStorageSize();
      expect(size).toBeGreaterThan(0);
    });
  });

  describe('isStorageAvailable', () => {
    it('should return true if storage available', () => {
      expect(service.isStorageAvailable()).toBe(true);
    });

    it('should return false if storage not available', () => {
      mockLocalStorage.setItem = vi.fn(() => { throw new Error(); });
      expect(service.isStorageAvailable()).toBe(false);
    });
  });

  describe('createSession', () => {
    it('should create session', () => {
      service.createSession('OP001');
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('currentSession', expect.any(String));
    });
  });

  describe('getCurrentSession', () => {
    it('should get current session', () => {
      const session = { operatorId: 'OP001', startTime: new Date().toISOString() };
      mockLocalStorage.setItem('currentSession', JSON.stringify(session));
      expect(service.getCurrentSession()).toEqual(session);
    });

    it('should return null if no session', () => {
      expect(service.getCurrentSession()).toBeNull();
    });
  });

  describe('updateSessionActivity', () => {
    it('should update session activity', () => {
      const session = { operatorId: 'OP001', startTime: new Date().toISOString() };
      mockLocalStorage.setItem('currentSession', JSON.stringify(session));
      service.updateSessionActivity();
      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });

    it('should not update if no session', () => {
      service.updateSessionActivity();
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('clearSession', () => {
    it('should clear session', () => {
      service.clearSession();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('currentSession');
    });
  });
});

