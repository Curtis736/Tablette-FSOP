import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TimeUtils from '../../utils/TimeUtils.js';

describe('TimeUtils', () => {
  describe('formatDuration', () => {
    it('should format seconds to HH:MM:SS', () => {
      expect(TimeUtils.formatDuration(0)).toBe('00:00:00');
      expect(TimeUtils.formatDuration(30)).toBe('00:00:30');
      expect(TimeUtils.formatDuration(60)).toBe('00:01:00');
      expect(TimeUtils.formatDuration(90)).toBe('00:01:30');
      expect(TimeUtils.formatDuration(3600)).toBe('01:00:00');
      expect(TimeUtils.formatDuration(3661)).toBe('01:01:01');
      expect(TimeUtils.formatDuration(7323)).toBe('02:02:03');
    });

    it('should handle invalid inputs', () => {
      expect(TimeUtils.formatDuration(-1)).toBe('00:00:00');
      expect(TimeUtils.formatDuration('invalid')).toBe('00:00:00');
      expect(TimeUtils.formatDuration(null)).toBe('00:00:00');
      expect(TimeUtils.formatDuration(undefined)).toBe('00:00:00');
    });
  });

  describe('parseDuration', () => {
    it('should parse HH:MM:SS to seconds', () => {
      expect(TimeUtils.parseDuration('00:00:00')).toBe(0);
      expect(TimeUtils.parseDuration('00:00:30')).toBe(30);
      expect(TimeUtils.parseDuration('00:01:00')).toBe(60);
      expect(TimeUtils.parseDuration('00:01:30')).toBe(90);
      expect(TimeUtils.parseDuration('01:00:00')).toBe(3600);
      expect(TimeUtils.parseDuration('01:01:01')).toBe(3661);
      expect(TimeUtils.parseDuration('02:02:03')).toBe(7323);
    });

    it('should parse MM:SS to seconds', () => {
      expect(TimeUtils.parseDuration('00:30')).toBe(30);
      expect(TimeUtils.parseDuration('01:00')).toBe(60);
      expect(TimeUtils.parseDuration('01:30')).toBe(90);
    });

    it('should handle invalid inputs', () => {
      expect(TimeUtils.parseDuration('')).toBe(0);
      expect(TimeUtils.parseDuration(null)).toBe(0);
      expect(TimeUtils.parseDuration(undefined)).toBe(0);
      expect(TimeUtils.parseDuration('invalid')).toBe(0);
      expect(TimeUtils.parseDuration('1')).toBe(0);
    });
  });

  describe('formatDate', () => {
    it('should format date with default format', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const formatted = TimeUtils.formatDate(date);
      expect(formatted).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    });

    it('should format date with custom format', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const formatted = TimeUtils.formatDate(date, 'DD/MM/YYYY');
      expect(formatted).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    it('should handle invalid dates', () => {
      expect(TimeUtils.formatDate(null)).toBe('-');
      expect(TimeUtils.formatDate(undefined)).toBe('-');
      expect(TimeUtils.formatDate('invalid')).toBe('-');
      expect(TimeUtils.formatDate(new Date('invalid'))).toBe('-');
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should format recent time', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);
      
      const recent = new Date('2024-01-15T11:59:30Z');
      expect(TimeUtils.formatRelativeTime(recent)).toBe('À l\'instant');
    });

    it('should format minutes ago', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);
      
      const minutesAgo = new Date('2024-01-15T11:55:00Z');
      expect(TimeUtils.formatRelativeTime(minutesAgo)).toBe('Il y a 5 minutes');
    });

    it('should format hours ago', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);
      
      const hoursAgo = new Date('2024-01-15T10:00:00Z');
      expect(TimeUtils.formatRelativeTime(hoursAgo)).toBe('Il y a 2 heures');
    });

    it('should format days ago', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);
      
      const daysAgo = new Date('2024-01-13T12:00:00Z');
      expect(TimeUtils.formatRelativeTime(daysAgo)).toBe('Il y a 2 jours');
    });

    it('should format old dates', () => {
      const now = new Date('2024-01-15T12:00:00Z');
      vi.setSystemTime(now);
      
      const oldDate = new Date('2024-01-01T12:00:00Z');
      const result = TimeUtils.formatRelativeTime(oldDate);
      expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    it('should handle invalid dates', () => {
      expect(TimeUtils.formatRelativeTime(null)).toBe('-');
      expect(TimeUtils.formatRelativeTime(undefined)).toBe('-');
    });
  });

  describe('getTimeDifference', () => {
    it('should calculate difference in seconds', () => {
      const start = new Date('2024-01-15T12:00:00Z');
      const end = new Date('2024-01-15T12:00:30Z');
      expect(TimeUtils.getTimeDifference(start, end)).toBe(30);
    });

    it('should handle invalid dates', () => {
      expect(TimeUtils.getTimeDifference(null, new Date())).toBe(0);
      expect(TimeUtils.getTimeDifference(new Date(), null)).toBe(0);
      expect(TimeUtils.getTimeDifference(null, null)).toBe(0);
    });
  });

  describe('isToday', () => {
    it('should check if date is today', () => {
      const today = new Date();
      expect(TimeUtils.isToday(today)).toBe(true);
    });

    it('should return false for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(TimeUtils.isToday(yesterday)).toBe(false);
    });

    it('should handle invalid dates', () => {
      expect(TimeUtils.isToday(null)).toBe(false);
      expect(TimeUtils.isToday(undefined)).toBe(false);
    });
  });

  describe('isThisWeek', () => {
    it('should check if date is this week', () => {
      const today = new Date();
      expect(TimeUtils.isThisWeek(today)).toBe(true);
    });

    it('should return false for last week', () => {
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 8);
      expect(TimeUtils.isThisWeek(lastWeek)).toBe(false);
    });

    it('should handle invalid dates', () => {
      expect(TimeUtils.isThisWeek(null)).toBe(false);
      expect(TimeUtils.isThisWeek(undefined)).toBe(false);
    });
  });

  describe('getStartOfDay', () => {
    it('should get start of day', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const start = TimeUtils.getStartOfDay(date);
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
    });

    it('should use current date if no date provided', () => {
      const start = TimeUtils.getStartOfDay();
      expect(start).toBeInstanceOf(Date);
    });
  });

  describe('getEndOfDay', () => {
    it('should get end of day', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const end = TimeUtils.getEndOfDay(date);
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getSeconds()).toBe(59);
    });
  });

  describe('getStartOfWeek', () => {
    it('should get start of week', () => {
      const start = TimeUtils.getStartOfWeek();
      expect(start).toBeInstanceOf(Date);
      expect(start.getHours()).toBe(0);
    });
  });

  describe('getEndOfWeek', () => {
    it('should get end of week', () => {
      const end = TimeUtils.getEndOfWeek();
      expect(end).toBeInstanceOf(Date);
      expect(end.getHours()).toBe(23);
    });
  });

  describe('toISOString', () => {
    it('should convert to ISO string', () => {
      const date = new Date('2024-01-15T14:30:00Z');
      const iso = TimeUtils.toISOString(date);
      expect(iso).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('getTodayString', () => {
    it('should get today as YYYY-MM-DD', () => {
      const today = TimeUtils.getTodayString();
      expect(today).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('getYesterdayString', () => {
    it('should get yesterday as YYYY-MM-DD', () => {
      const yesterday = TimeUtils.getYesterdayString();
      expect(yesterday).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('getTomorrowString', () => {
    it('should get tomorrow as YYYY-MM-DD', () => {
      const tomorrow = TimeUtils.getTomorrowString();
      expect(tomorrow).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('isValidDate', () => {
    it('should validate valid dates', () => {
      expect(TimeUtils.isValidDate(new Date())).toBe(true);
      expect(TimeUtils.isValidDate('2024-01-15')).toBe(true);
    });

    it('should reject invalid dates', () => {
      expect(TimeUtils.isValidDate(null)).toBe(false);
      expect(TimeUtils.isValidDate(undefined)).toBe(false);
      expect(TimeUtils.isValidDate('invalid')).toBe(false);
    });
  });

  describe('getAgeInDays', () => {
    it('should calculate age in days', () => {
      // Éviter setDate() : au changement d'heure (25 oct 2026) ça décale d'1h et Math.ceil passe à 6.
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      expect(TimeUtils.getAgeInDays(fiveDaysAgo)).toBe(5);
    });

    it('should handle invalid dates', () => {
      expect(TimeUtils.getAgeInDays(null)).toBe(0);
    });
  });

  describe('formatDurationText', () => {
    it('should format seconds', () => {
      expect(TimeUtils.formatDurationText(30)).toBe('30 secondes');
      expect(TimeUtils.formatDurationText(1)).toBe('1 seconde');
    });

    it('should format minutes', () => {
      expect(TimeUtils.formatDurationText(60)).toBe('1 minute');
      expect(TimeUtils.formatDurationText(120)).toBe('2 minutes');
    });

    it('should format hours', () => {
      expect(TimeUtils.formatDurationText(3600)).toBe('1 heure');
      expect(TimeUtils.formatDurationText(3660)).toBe('1 heure et 1 minute');
    });

    it('should format days', () => {
      expect(TimeUtils.formatDurationText(86400)).toBe('1 jour');
      expect(TimeUtils.formatDurationText(90000)).toBe('1 jour et 1 heure');
    });
  });
});

