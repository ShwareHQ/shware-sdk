import { describe, expect, it } from 'vitest';
import { addDays, addMonths, todayIn, zonedHourToUtc } from './time';

describe('zonedHourToUtc', () => {
  it.each([
    ['2026-10-01', 13, 'UTC', '2026-10-01T13:00:00.000Z'],
    ['2026-10-01', 0, 'America/Los_Angeles', '2026-10-01T07:00:00.000Z'],
    ['2026-01-15', 0, 'America/Los_Angeles', '2026-01-15T08:00:00.000Z'],
    ['2026-10-01', 8, 'Asia/Shanghai', '2026-10-01T00:00:00.000Z'],
    ['2026-10-01', 23, 'Asia/Kolkata', '2026-10-01T17:30:00.000Z'],
  ])('%s %i:00 in %s is %s', (date, hour, zone, expected) => {
    expect(zonedHourToUtc(date, hour, zone).toISOString()).toBe(expected);
  });

  it('keeps consecutive hours an hour apart across the spring-forward jump', () => {
    // 2026-03-08 in Los Angeles: 02:00 does not exist; 01:00 is PST and 03:00 is PDT.
    expect(zonedHourToUtc('2026-03-08', 1, 'America/Los_Angeles').toISOString()).toBe(
      '2026-03-08T09:00:00.000Z'
    );
    expect(zonedHourToUtc('2026-03-08', 3, 'America/Los_Angeles').toISOString()).toBe(
      '2026-03-08T10:00:00.000Z'
    );
  });

  it('takes the first occurrence of the hour repeated by the fall-back jump', () => {
    // 2026-11-01 in Los Angeles: 01:00 happens at 08:00 UTC (PDT) and again at 09:00 UTC (PST).
    expect(zonedHourToUtc('2026-11-01', 1, 'America/Los_Angeles').toISOString()).toBe(
      '2026-11-01T08:00:00.000Z'
    );
    expect(zonedHourToUtc('2026-11-01', 2, 'America/Los_Angeles').toISOString()).toBe(
      '2026-11-01T10:00:00.000Z'
    );
  });
});

describe('calendar dates', () => {
  it('reads today in the zone', () => {
    const now = new Date('2026-10-08T03:00:00Z');
    expect(todayIn('UTC', now)).toBe('2026-10-08');
    expect(todayIn('America/Los_Angeles', now)).toBe('2026-10-07');
  });

  it('moves by days across months and normalizes', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-1-5', 0)).toBe('2026-01-05');
  });

  it('moves by months, clamping the day', () => {
    expect(addMonths('2026-10-08', -13)).toBe('2025-09-08');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-10-08', -37)).toBe('2023-09-08');
  });
});
