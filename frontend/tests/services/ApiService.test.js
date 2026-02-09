import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import ApiService from '../../services/ApiService.js';

describe('ApiService', () => {
  let service;
  let mockFetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    mockFetch = global.fetch;
    
    // Mock window.location
    delete window.location;
    window.location = {
      protocol: 'http:',
      hostname: 'localhost',
      host: 'localhost:8080',
      port: '8080',
      search: ''
    };
    
    // Mock localStorage
    global.localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with local dev URL', () => {
      window.location.port = '5173';
      service = new ApiService();
      expect(service.baseUrl).toBe('http://localhost:3033/api');
    });

    it('should initialize with production URL', () => {
      window.location.port = '8080';
      window.location.hostname = 'example.com';
      service = new ApiService();
      expect(service.baseUrl).toContain('/api');
    });

    it('should handle force local backend', () => {
      window.location.search = '?directBackend';
      service = new ApiService();
      expect(service.baseUrl).toBe('http://localhost:3033/api');
    });
  });

  describe('request', () => {
    beforeEach(() => {
      service = new ApiService();
    });

    it('should queue request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'test' })
      });
      
      const promise = service.request('/test');
      // La file peut être consommée immédiatement par processQueue (async),
      // donc on valide plutôt le résultat.
      await expect(promise).resolves.toEqual({ data: 'test' });
    });
  });

  describe('executeRequest', () => {
    beforeEach(() => {
      service = new ApiService();
    });

    it('should execute successful request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'test' })
      });
      
      const result = await service.executeRequest('/test');
      expect(result).toEqual({ data: 'test' });
    });

    it('should handle 429 rate limit', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: async () => ({ error: 'Rate limit' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: 'retry' })
        });
      
      const promise = service.executeRequest('/test');
      // Laisser le code atteindre le setTimeout interne puis avancer le temps
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(3000);
      await expect(promise).resolves.toEqual({ data: 'retry' });
      vi.useRealTimers();
    });

    it('should handle error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Not found' })
      });
      
      await expect(service.executeRequest('/test')).rejects.toThrow();
    });

    it('should handle health check error', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(service.executeRequest('/health')).rejects.toThrow('SERVER_NOT_ACCESSIBLE');
    });
  });

  describe('HTTP methods', () => {
    beforeEach(() => {
      service = new ApiService();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: 'test' })
      });
    });

    it('should make GET request', async () => {
      await service.get('/test', { param: 'value' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test?param=value'),
        expect.any(Object)
      );
    });

    it('should make POST request', async () => {
      await service.post('/test', { data: 'value' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ data: 'value' })
        })
      );
    });

    it('should make PUT request', async () => {
      await service.put('/test', { data: 'value' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should make DELETE request', async () => {
      await service.delete('/test');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      service = new ApiService();
    });

    it('should return health status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok' })
      });
      
      const result = await service.healthCheck();
      expect(result.status).toBe('ok');
    });

    it('should handle server not accessible', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const result = await service.healthCheck();
      expect(result.accessible).toBe(false);
    });
  });

  describe('operator methods', () => {
    beforeEach(() => {
      service = new ApiService();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({})
      });
    });

    it('should get operator', async () => {
      await service.getOperator('OP001');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/operators/OP001'),
        expect.any(Object)
      );
    });

    it('should get all operators', async () => {
      await service.getAllOperators();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/operators'),
        expect.any(Object)
      );
    });
  });

  describe('lancement methods', () => {
    beforeEach(() => {
      service = new ApiService();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({})
      });
    });

    it('should get lancements', async () => {
      await service.getLancements('search', 50);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/lancements?search=search&limit=50'),
        expect.any(Object)
      );
    });

    it('should get lancement by code', async () => {
      await service.getLancement('LT001');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/operators/lancement/LT001'),
        expect.any(Object)
      );
    });
  });

  describe('operation methods', () => {
    beforeEach(() => {
      service = new ApiService();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({})
      });
    });

    it('should start operation', async () => {
      await service.startOperation('OP001', 'LT001');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/operators/start'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ operatorId: 'OP001', lancementCode: 'LT001' })
        })
      );
    });

    it('should pause operation', async () => {
      await service.pauseOperation('OP001', 'LT001');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/operators/pause'),
        expect.any(Object)
      );
    });

    it('should resume operation', async () => {
      await service.resumeOperation('OP001', 'LT001');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/operators/resume'),
        expect.any(Object)
      );
    });

    it('should stop operation', async () => {
      await service.stopOperation('OP001', 'LT001');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/operators/stop'),
        expect.any(Object)
      );
    });
  });

  describe('getConnectedOperators', () => {
    beforeEach(() => {
      service = new ApiService();
    });

    it('should get operators from API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ code: 'OP001' }])
      });
      
      const result = await service.getConnectedOperators();
      expect(result).toEqual([{ code: 'OP001' }]);
    });

    it('should use cache if available', async () => {
      const cached = { data: [{ code: 'OP001' }], timestamp: Date.now() };
      service.cache.set('/admin/operators', cached);
      
      const result = await service.getConnectedOperators();
      expect(result).toEqual([{ code: 'OP001' }]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should force refresh', async () => {
      const cached = { data: [{ code: 'OP001' }], timestamp: Date.now() };
      service.cache.set('/admin/operators', cached);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ code: 'OP002' }])
      });
      
      const result = await service.getConnectedOperators(true);
      expect(result).toEqual([{ code: 'OP002' }]);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('validateLancementCode', () => {
    beforeEach(() => {
      service = new ApiService();
    });

    it('should validate code successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, valid: true })
      });
      
      const result = await service.validateLancementCode('LT001');
      expect(result.success).toBe(true);
    });

    it('should handle validation error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      });
      
      const result = await service.validateLancementCode('LT001');
      expect(result.success).toBe(false);
    });

    it('should handle network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const result = await service.validateLancementCode('LT001');
      expect(result.success).toBe(false);
    });
  });
});

