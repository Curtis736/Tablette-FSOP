import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationManager } from '../../utils/NotificationManager.js';

describe('NotificationManager', () => {
  let manager;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    manager = new NotificationManager();
  });

  describe('constructor', () => {
    it('should create container and setup styles', () => {
      expect(manager.container).toBeTruthy();
      expect(manager.container.id).toBe('notification-container');
      expect(document.getElementById('notification-styles')).toBeTruthy();
    });
  });

  describe('show', () => {
    it('should show a notification', () => {
      const id = manager.show('Test message', 'info');
      expect(id).toBeTruthy();
      expect(manager.notifications.length).toBe(1);
    });

    it('should show notification with custom options', () => {
      const id = manager.show('Test', 'success', { title: 'Custom', duration: 5000, persistent: true });
      const notification = manager.notifications.find(n => n.id === id);
      expect(notification.title).toBe('Custom');
      expect(notification.duration).toBe(5000);
      expect(notification.persistent).toBe(true);
    });

    it('should auto-hide after duration', async () => {
      vi.useFakeTimers();
      manager.show('Test', 'info', { duration: 1000 });
      expect(manager.notifications.length).toBe(1);
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();
      expect(manager.notifications.length).toBe(0);
      vi.useRealTimers();
    });
  });

  describe('renderNotification', () => {
    it('should render notification element', () => {
      const notification = {
        id: 1,
        message: 'Test',
        type: 'info',
        title: 'Info',
        duration: 3000,
        persistent: false
      };
      manager.renderNotification(notification);
      const element = manager.container.querySelector('[data-id="1"]');
      expect(element).toBeTruthy();
      expect(element.className).toContain('notification-info');
    });

    it('should show close button for non-persistent notifications', () => {
      const notification = {
        id: 1,
        message: 'Test',
        type: 'info',
        title: 'Info',
        duration: 3000,
        persistent: false
      };
      manager.renderNotification(notification);
      const element = manager.container.querySelector('[data-id="1"]');
      expect(element.innerHTML).toContain('notification-close');
    });

    it('should not show close button for persistent notifications', () => {
      const notification = {
        id: 1,
        message: 'Test',
        type: 'info',
        title: 'Info',
        duration: 0,
        persistent: true
      };
      manager.renderNotification(notification);
      const element = manager.container.querySelector('[data-id="1"]');
      expect(element.innerHTML).not.toContain('notification-close');
    });
  });

  describe('hide', () => {
    it('should hide notification', () => {
      const id = manager.show('Test', 'info');
      manager.hide(id);
      expect(manager.notifications.length).toBe(0);
    });

    it('should handle hiding non-existent notification', () => {
      expect(() => manager.hide(999)).not.toThrow();
    });
  });

  describe('hideAll', () => {
    it('should hide all notifications', () => {
      manager.show('Test 1', 'info');
      manager.show('Test 2', 'success');
      manager.hideAll();
      expect(manager.notifications.length).toBe(0);
    });
  });

  describe('getDefaultTitle', () => {
    it('should return correct titles', () => {
      expect(manager.getDefaultTitle('success')).toBe('Succès');
      expect(manager.getDefaultTitle('error')).toBe('Erreur');
      expect(manager.getDefaultTitle('warning')).toBe('Attention');
      expect(manager.getDefaultTitle('info')).toBe('Information');
      expect(manager.getDefaultTitle('unknown')).toBe('Notification');
    });
  });

  describe('getDefaultDuration', () => {
    it('should return correct durations', () => {
      expect(manager.getDefaultDuration('success')).toBe(3000);
      expect(manager.getDefaultDuration('error')).toBe(5000);
      expect(manager.getDefaultDuration('warning')).toBe(4000);
      expect(manager.getDefaultDuration('info')).toBe(3000);
      expect(manager.getDefaultDuration('unknown')).toBe(3000);
    });
  });

  describe('getIcon', () => {
    it('should return correct icons', () => {
      expect(manager.getIcon('success')).toBe('✓');
      expect(manager.getIcon('error')).toBe('✕');
      expect(manager.getIcon('warning')).toBe('⚠');
      expect(manager.getIcon('info')).toBe('ℹ');
      expect(manager.getIcon('unknown')).toBe('ℹ');
    });
  });

  describe('convenience methods', () => {
    it('should show success notification', () => {
      const id = manager.success('Success message');
      const notification = manager.notifications.find(n => n.id === id);
      expect(notification.type).toBe('success');
    });

    it('should show error notification', () => {
      const id = manager.error('Error message');
      const notification = manager.notifications.find(n => n.id === id);
      expect(notification.type).toBe('error');
    });

    it('should show warning notification', () => {
      const id = manager.warning('Warning message');
      const notification = manager.notifications.find(n => n.id === id);
      expect(notification.type).toBe('warning');
    });

    it('should show info notification', () => {
      const id = manager.info('Info message');
      const notification = manager.notifications.find(n => n.id === id);
      expect(notification.type).toBe('info');
    });
  });

  describe('persistent', () => {
    it('should show persistent notification', () => {
      const id = manager.persistent('Persistent message', 'info');
      const notification = manager.notifications.find(n => n.id === id);
      expect(notification.persistent).toBe(true);
    });
  });

  describe('confirm', () => {
    it('should show confirmation dialog', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      const id = manager.confirm('Confirm?', onConfirm, onCancel);
      expect(id).toBeTruthy();
      const notification = manager.notifications.find(n => n.id === id);
      expect(notification.persistent).toBe(true);
      expect(notification.actions.length).toBe(2);
    });

    it('should call onConfirm when confirmed', () => {
      const onConfirm = vi.fn();
      const id = manager.confirm('Confirm?', onConfirm);
      const notification = manager.notifications.find(n => n.id === id);
      notification.actions[0].action();
      expect(onConfirm).toHaveBeenCalled();
    });

    it('should call onCancel when cancelled', () => {
      const onCancel = vi.fn();
      const id = manager.confirm('Confirm?', null, onCancel);
      const notification = manager.notifications.find(n => n.id === id);
      notification.actions[1].action();
      expect(onCancel).toHaveBeenCalled();
    });
  });
});

