/**
 * Time-window scheduling — when does the next send window open?
 *
 * Pure functions of (nowMs, days, between, tz): the interpreter calls them
 * inside a durable step, so the answer is checkpointed and replay-safe.
 * Timezone math goes through Intl.DateTimeFormat (available in Node, workerd
 * and browsers alike) — no tz database dependency. An unknown timezone falls
 * back to UTC rather than failing the journey.
 */

const DAY_MS = 86_400_000;

/** Indexed by Date#getUTCDay, matching WeekdayIR's lowercase three-letter form. */
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Cached per-timezone formatter; throws on an invalid timezone id. */
function formatterFor(tz: string): Intl.DateTimeFormat {
  let dtf = formatters.get(tz);
  if (dtf === undefined) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(tz, dtf);
  }
  return dtf;
}

/** Validate a timezone id, falling back to UTC — a bad profile value must not wedge the journey. */
export function resolveTimeZone(tz: string): string {
  try {
    formatterFor(tz);
    return tz;
  } catch {
    return 'UTC';
  }
}

function localParts(ms: number, tz: string): LocalParts {
  const parts: Partial<Record<string, string>> = {};
  for (const part of formatterFor(tz).formatToParts(new Date(ms))) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** The zone's UTC offset at an instant, as (wall clock read as if it were UTC) − instant. */
function offsetMsAt(ts: number, tz: string): number {
  const p = localParts(ts, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ts;
}

/**
 * The first instant at or after `before` whose offset differs from the one
 * there — i.e. the DST transition separating the two bounds. Bisects on the
 * minute grid, the finest granularity any tz rule uses, so the loop lands on
 * the transition itself rather than merely near it.
 */
function transitionBetween(before: number, after: number, tz: string): number {
  const startOffset = offsetMsAt(before, tz);
  let lo = before;
  let hi = after;
  while (hi - lo > 60_000) {
    // Halve on whole minutes: both bounds stay minute-aligned, so mid is
    // strictly inside (lo, hi) and the loop cannot stall.
    const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
    if (offsetMsAt(mid, tz) === startOffset) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * The UTC instant at which the wall clock in `tz` reads y-m-d hh:mm.
 *
 * Guess the UTC value from the offset at the guess, read it back through the
 * timezone and correct by the difference; a second pass settles every wall
 * time that exists, and picks the earlier of the two when a fall-back repeats
 * an hour.
 *
 * A wall time inside a spring-forward gap exists on no clock, so the two
 * corrections straddle the transition and neither reads back as asked. The
 * convention here is the usual one: move forward to the first instant that
 * does exist, i.e. the transition itself — 02:30 on a US spring-forward day
 * resolves to 03:00. Without that branch the correction bottoms out on the low
 * side and the window opens an hour *before* its configured start.
 */
function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): number {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const first = target - offsetMsAt(target, tz);
  if (offsetMsAt(first, tz) === target - first) return first;
  const second = target - offsetMsAt(first, tz);
  if (offsetMsAt(second, tz) === target - second) return second;
  return transitionBetween(Math.min(first, second), Math.max(first, second), tz);
}

const TIME = /^(\d{1,2}):(\d{2})$/;

function parseTime(value: string): { hh: number; mm: number } | null {
  const match = TIME.exec(value);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

/**
 * The instant the next [start, end) window opens in `tz`, or null when nowMs
 * is already inside a window. Scans nine calendar days so every weekday is
 * reachable. Malformed times (the DSL validates its own input, but IR may come
 * from elsewhere) disable the window — better to send now than to hold a user
 * forever on a config typo.
 */
export function nextWindowStart(
  nowMs: number,
  days: readonly string[],
  between: readonly [string, string],
  tz: string
): number | null {
  const start = parseTime(between[0]);
  const end = parseTime(between[1]);
  if (start === null || end === null) return null;
  const zone = resolveTimeZone(tz);

  // Step the local *calendar*, not the absolute clock: a spring-forward day is
  // 23 hours long, so nowMs + n·24h crosses two local midnights and skips that
  // date entirely — the send would be held until the weekday came round again.
  // Date.UTC arithmetic over the civil date has no DST to trip on, and
  // getUTCDay names the same weekday the zone does.
  const today = localParts(nowMs, zone);
  const firstDay = Date.UTC(today.year, today.month - 1, today.day);

  for (let offset = 0; offset < 9; offset++) {
    const date = new Date(firstDay + offset * DAY_MS);
    if (!days.includes(WEEKDAYS[date.getUTCDay()])) continue;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const opensAt = zonedInstant(year, month, day, start.hh, start.mm, zone);
    const closesAt = zonedInstant(year, month, day, end.hh, end.mm, zone);
    if (nowMs < opensAt) return opensAt;
    if (nowMs < closesAt) return null;
    // Past this day's window (e.g. 23:00 against 09:00–17:00) → keep scanning forward
  }
  return null; // no allowed day in range (an empty days list) → do not wait
}
