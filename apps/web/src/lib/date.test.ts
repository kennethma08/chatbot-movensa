import { describe, expect, it } from 'vitest';
import { dateKey, formatDate, parseDate } from './date';

describe('date helpers', () => {
  it('formats valid API timestamps', () => {
    expect(parseDate('2026-09-19T15:30:00.000Z')).toBeInstanceOf(Date);
    expect(dateKey('2026-09-19T15:30:00.000Z')).not.toBeNull();
    expect(formatDate('2026-09-19T15:30:00.000Z', { year: 'numeric' })).toBe('2026');
  });

  it('falls back instead of throwing for missing or invalid values', () => {
    expect(parseDate(undefined)).toBeNull();
    expect(dateKey('not-a-date')).toBeNull();
    expect(formatDate('not-a-date', { dateStyle: 'medium' })).toBe('—');
  });
});
