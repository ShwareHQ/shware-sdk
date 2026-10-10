/**
 * Debug time scale: divide every duration in a workflow's IR by a factor so a
 * journey written in days plays out in seconds — with a factor of 3600, a
 * `delay('2 days')` sleeps 48 s, a `waitUntil(..., { timeout: '3 days' })`
 * gives up after 72 s, and a goal `within: '30 days'` closes after 12 min.
 *
 * Everything that is a Duration scales together (delays, random delays, wait
 * timeouts, goal and `performed(... within)` windows inside the workflow), so
 * the journey keeps its shape, just faster. What does not scale: wall-clock
 * `timeWindow`s (they are times of day, not durations) and the windows inside
 * segment definitions, which live in the store rather than the workflow body.
 *
 * Durations are recognised structurally — an object whose only keys are
 * `value` (the source text) and `ms` — which is the DurationIR shape and
 * nothing else in the IR. The text is kept so the studio still shows what was
 * written.
 */
export function scaleDurations<T>(ir: T, factor: number): T {
  if (!(factor > 0) || factor === 1) return ir;
  return walk(ir, factor) as T;
}

function walk(value: unknown, factor: number): unknown {
  if (Array.isArray(value)) return value.map((item) => walk(item, factor));
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 2 && typeof record.value === 'string' && typeof record.ms === 'number') {
    return { value: record.value, ms: Math.max(0, Math.round(record.ms / factor)) };
  }
  return Object.fromEntries(keys.map((key) => [key, walk(record[key], factor)]));
}
