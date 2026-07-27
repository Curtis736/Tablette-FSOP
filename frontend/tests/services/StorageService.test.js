import { describe, it, expect, beforeEach, vi } from 'vitest';
import StorageService from '../../services/StorageService.js';

describe('StorageService', () => {
  let service;
  let mockLocalStorage;

  beforeEach(() => {
    const store = {};
    const setItem = vi.fn((key, value) => { store[key] = String(value); });
    const removeItem = vi.fn((key) => { delete store[key]; });
    const clear = vi.fn(() => { Object.keys(store).forEach((key) => delete store[key]); });
    const getItem = vi.fn((key) => (key in store ? store[key] : null));
    const keyFn = vi.fn((index) => Object.keys(store)[index] ?? null);

    const storageTarget = {
      getItem,
      setItem,
      removeItem,
      clear,
      key: keyFn,
      get length() {
        return Object.keys(store).length;
      },
      hasOwnProperty: (key) => Object.prototype.hasOwnProperty.call(store, key)
    };

    mockLocalStorage = new Proxy(storageTarget, {
      ownKeys: () => Object.keys(store),
      getOwnPropertyDescriptor: (_target, prop) => {
        if (Object.prototype.hasOwnProperty.call(store, prop)) {
          return { configurable: true, enumerable: true, value: store[prop] };
        }
        return undefined;
      },
      get: (target, prop) => {
        if (Object.prototype.hasOwnProperty.call(store, prop)) {
          return store[prop];
        }
        return target[prop];
      },
      has: (_target, prop) => Object.prototype.hasOwnProperty.call(store, prop)
    });

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
      mockLocalStorage.setItem('cacheData_test1', 'value1');
      mockLocalStorage.setItem('cacheData_test2', 'value2');
      mockLocalStorage.setItem('other', 'value');
      service.clearAllCache();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('cacheData_test1');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('cacheData_test2');
      expect(mockLocalStorage.removeItem).not.toHaveBeenCalledWith('other');
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
      mockLocalStorage.setItem('key1', 'value1');
      mockLocalStorage.setItem('key2', 'value2');
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

