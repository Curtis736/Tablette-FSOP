import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import ScannerManager from '../../utils/ScannerManager.js';

describe.skip('ScannerManager', () => {
  let manager;
  let mockVideo;
  let mockCanvas;
  let mockStream;

  beforeEach(() => {
    manager = new ScannerManager();
    
    mockVideo = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
    
    mockCanvas = {
      getContext: vi.fn(() => ({
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) }))
      }))
    };
    
    mockStream = {
      getTracks: vi.fn(() => [{
        stop: vi.fn()
      }])
    };
    
    global.navigator = {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream)
      }
    };
    
    global.ZXing = undefined;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(manager.isScanning).toBe(false);
      expect(manager.stream).toBeNull();
      expect(manager.onCodeScanned).toBeNull();
    });
  });

  describe('init', () => {
    it('should set callbacks', () => {
      const onCodeScanned = vi.fn();
      const onError = vi.fn();
      manager.init(onCodeScanned, onError);
      expect(manager.onCodeScanned).toBe(onCodeScanned);
      expect(manager.onError).toBe(onError);
    });
  });

  describe('loadZXing', () => {
    it('should return true if ZXing already loaded', async () => {
      global.ZXing = { BrowserMultiFormatReader: class {} };
      const result = await manager.loadZXing();
      expect(result).toBe(true);
    });

    it('should wait for existing script', async () => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@latest';
      document.head.appendChild(script);
      
      vi.useFakeTimers();
      const promise = manager.loadZXing();
      vi.advanceTimersByTime(100);
      global.ZXing = { BrowserMultiFormatReader: class {} };
      vi.advanceTimersByTime(100);
      const result = await promise;
      expect(result).toBe(true);
      vi.useRealTimers();
    });

    it('should try to load from CDN', async () => {
      const script = document.createElement('script');
      script.onload = () => {
        global.ZXing = { BrowserMultiFormatReader: class {} };
      };
      document.createElement = vi.fn(() => script);
      document.head.appendChild = vi.fn();
      
      const result = await manager.loadZXing();
      expect(document.createElement).toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('should start scanner successfully', async () => {
      manager.init(vi.fn(), vi.fn());
      await manager.start(mockVideo, mockCanvas);
      expect(manager.isScanning).toBe(true);
      expect(mockVideo.srcObject).toBe(mockStream);
    });

    it('should handle legacy getUserMedia', async () => {
      delete global.navigator.mediaDevices;
      global.navigator.getUserMedia = vi.fn((constraints, success) => {
        success(mockStream);
      });
      
      manager.init(vi.fn(), vi.fn());
      await manager.start(mockVideo, mockCanvas);
      expect(manager.isScanning).toBe(true);
    });

    it('should handle webkitGetUserMedia', async () => {
      delete global.navigator.mediaDevices;
      global.navigator.webkitGetUserMedia = vi.fn((constraints, success) => {
        success(mockStream);
      });
      
      manager.init(vi.fn(), vi.fn());
      await manager.start(mockVideo, mockCanvas);
      expect(manager.isScanning).toBe(true);
    });

    it('should handle mozGetUserMedia', async () => {
      delete global.navigator.mediaDevices;
      global.navigator.mozGetUserMedia = vi.fn((constraints, success) => {
        success(mockStream);
      });
      
      manager.init(vi.fn(), vi.fn());
      await manager.start(mockVideo, mockCanvas);
      expect(manager.isScanning).toBe(true);
    });

    it('should throw error if no API available', async () => {
      delete global.navigator.mediaDevices;
      delete global.navigator.getUserMedia;
      delete global.navigator.webkitGetUserMedia;
      delete global.navigator.mozGetUserMedia;
      
      manager.init(vi.fn(), vi.fn());
      await expect(manager.start(mockVideo, mockCanvas)).rejects.toThrow();
    });

    it('should handle ZXing error gracefully', async () => {
      manager.loadZXing = vi.fn().mockRejectedValue(new Error('ZXing error'));
      manager.init(vi.fn(), vi.fn());
      
      await manager.start(mockVideo, mockCanvas);
      expect(manager.isScanning).toBe(true);
    });
  });

  describe('stop', () => {
    it('should stop scanner and release resources', () => {
      manager.stream = mockStream;
      manager.videoElement = mockVideo;
      manager.canvasElement = mockCanvas;
      manager.isScanning = true;
      
      manager.stop();
      
      expect(manager.isScanning).toBe(false);
      expect(mockStream.getTracks()[0].stop).toHaveBeenCalled();
      expect(mockVideo.srcObject).toBeNull();
    });
  });

  describe('startScanningLoop', () => {
    it('should use ZXing if available', () => {
      global.ZXing = {
        BrowserMultiFormatReader: class {
          decodeFromVideoDevice() {}
        }
      };
      
      manager.videoElement = mockVideo;
      manager.startScanningLoop();
      
      expect(manager.codeReader).toBeInstanceOf(ZXing.BrowserMultiFormatReader);
    });

    it('should fallback if ZXing not available', () => {
      global.ZXing = undefined;
      manager.startScanningLoop();
      expect(manager.codeReader).toBeUndefined();
    });
  });

  describe('handleCodeScanned', () => {
    it('should call callback and stop', () => {
      const callback = vi.fn();
      manager.onCodeScanned = callback;
      manager.isScanning = true;
      manager.stop = vi.fn();
      
      manager.handleCodeScanned('LT001');
      
      expect(callback).toHaveBeenCalledWith('LT001');
      expect(manager.stop).toHaveBeenCalled();
    });

    it('should not process if not scanning', () => {
      const callback = vi.fn();
      manager.onCodeScanned = callback;
      manager.isScanning = false;
      
      manager.handleCodeScanned('LT001');
      
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('handleError', () => {
    it('should format error messages', () => {
      const callback = vi.fn();
      manager.onError = callback;
      
      const error = new Error('Test');
      error.name = 'NotAllowedError';
      manager.handleError(error);
      
      expect(callback).toHaveBeenCalled();
    });

    it('should handle different error types', () => {
      const callback = vi.fn();
      manager.onError = callback;
      
      const errors = [
        { name: 'NotFoundError' },
        { name: 'NotReadableError' },
        { name: 'OverconstrainedError' },
        { name: 'Unknown', message: 'Test' }
      ];
      
      errors.forEach(err => {
        manager.handleError(err);
      });
      
      expect(callback).toHaveBeenCalledTimes(errors.length);
    });
  });

  describe('isSupported', () => {
    it('should return true if MediaDevices available', () => {
      expect(ScannerManager.isSupported()).toBe(true);
    });

    it('should return true if legacy API available', () => {
      delete global.navigator.mediaDevices;
      global.navigator.getUserMedia = vi.fn();
      expect(ScannerManager.isSupported()).toBe(true);
    });

    it('should return true even if no API detected', () => {
      delete global.navigator.mediaDevices;
      delete global.navigator.getUserMedia;
      delete global.navigator.webkitGetUserMedia;
      delete global.navigator.mozGetUserMedia;
      expect(ScannerManager.isSupported()).toBe(true);
    });
  });
});

