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

interface LocalParts {
  year: number;
  month: number;
  day: number;
  /** Lowercase three-letter weekday ('mon' … 'sun'), matching WeekdayIR. */
  weekday: string;
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
      weekday: 'short',
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
    weekday: (parts.weekday ?? '').toLowerCase().slice(0, 3),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/**
 * The UTC instant at which the wall clock in `tz` reads y-m-d hh:mm. Guess the
 * UTC value, read it back through the timezone, and correct by the difference;
 * two passes settle even across a DST transition.
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
  let ts = target;
  for (let pass = 0; pass < 2; pass++) {
    const p = localParts(ts, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (asUtc === target) break;
    ts += target - asUtc;
  }
  return ts;
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
 * is already inside a window. Scans nine calendar days so a DST-stretched day
 * cannot skip a weekday. Malformed times (the DSL validates its own input, but
 * IR may come from elsewhere) disable the window — better to send now than to
 * hold a user forever on a config typo.
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

  for (let offset = 0; offset < 9; offset++) {
    const day = localParts(nowMs + offset * DAY_MS, zone);
    if (!days.includes(day.weekday)) continue;
    const opensAt = zonedInstant(day.year, day.month, day.day, start.hh, start.mm, zone);
    const closesAt = zonedInstant(day.year, day.month, day.day, end.hh, end.mm, zone);
    if (nowMs < opensAt) return opensAt;
    if (nowMs < closesAt) return null;
    // Past this day's window (e.g. 23:00 against 09:00–17:00) → keep scanning forward
  }
  return null; // no allowed day in range (an empty days list) → do not wait
}
