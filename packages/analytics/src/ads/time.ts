import type { ReportDate } from './types';

/** The zone's offset from UTC at an instant, in milliseconds (local minus UTC). */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return local - Math.floor(instant / 1000) * 1000;
}

/**
 * The UTC instant of `hour:00` on `date` (`YYYY-MM-DD`) in an IANA time zone. An hour skipped by
 * a daylight-saving jump resolves to the instant after the jump; a repeated hour to its first
 * occurrence — no platform reports delivery in a skipped hour, and a repeated one comes as a
 * single bucket.
 */
export function zonedHourToUtc(date: string, hour: number, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour);
  // The offset at the wall time read as UTC is a guess that is off by the jump near a transition;
  // the offset at that first candidate gives the other. A candidate is right when it reads back
  // as the wall time in the zone.
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  const valid = [first, second].filter((c) => c + offsetAt(c, timeZone) === wall);
  return new Date(valid.length > 0 ? Math.min(...valid) : Math.max(first, second));
}

const pad = (n: number) => String(n).padStart(2, '0');

function format(year: number, month: number, day: number): ReportDate {
  return `${year}-${pad(month)}-${pad(day)}` as ReportDate;
}

/** Today's date in an IANA time zone. */
export function todayIn(timeZone: string, now = new Date()): ReportDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now) as ReportDate;
}

/** `date` moved by whole days. */
export function addDays(date: string, days: number): ReportDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return format(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** `date` moved by whole months, the day clamped to the target month's last (03-31 − 1 → 02-28). */
export function addMonths(date: string, months: number): ReportDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return format(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(day, last));
}
