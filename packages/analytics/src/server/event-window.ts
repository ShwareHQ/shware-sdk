const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * How old, and how far ahead, an event's time may be for each conversions API. One event out of
 * range fails the whole request on most of them — Meta "process[es] no events", LinkedIn
 * "all records fail" — so a backlog flushed late, or one event with a bad clock, would take every
 * valid event of its batch down with it.
 *
 * A minute is taken off each maximum age: the request reaches the API after this check.
 */
export const EVENT_WINDOWS = {
  /** https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event */
  meta: { maxAgeMs: 7 * DAY - MINUTE },
  /** https://developers.openai.com/ads/conversions-api: "within the last 7 days and no more than 10 minutes in the future" */
  openai: { maxAgeMs: 7 * DAY - MINUTE, maxFutureMs: 10 * MINUTE },
  /** Reddit: `event_at` "can't be older than seven days". */
  reddit: { maxAgeMs: 7 * DAY - MINUTE },
  /** https://learn.microsoft.com/en-us/advertising/guides/uet-conversion-api-integration */
  microsoft: { maxAgeMs: 7 * DAY - MINUTE },
  /** https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/conversions-api: "within the past 90 days" */
  linkedin: { maxAgeMs: 90 * DAY - MINUTE },
} as const satisfies Record<string, { maxAgeMs: number; maxFutureMs?: number }>;

/**
 * The events whose time the API accepts, as of now; the rest are left out and logged. `now` is a
 * parameter for the tests, which freeze the clock.
 */
export function withinWindow<E extends { created_at: string; name: string }>(
  platform: keyof typeof EVENT_WINDOWS,
  events: E[],
  now: number = Date.now()
): E[] {
  const window: { maxAgeMs: number; maxFutureMs?: number } = EVENT_WINDOWS[platform];
  const kept = events.filter((event) => {
    const time = new Date(event.created_at).getTime();
    if (Number.isNaN(time)) return false;
    if (now - time > window.maxAgeMs) return false;
    if (window.maxFutureMs !== undefined && time - now > window.maxFutureMs) return false;
    return true;
  });
  const skipped = events.length - kept.length;
  if (skipped > 0) {
    const names = events.filter((event) => !kept.includes(event)).map((event) => event.name);
    console.warn(
      `Skipped ${skipped} ${platform} conversion(s) outside the API's time window: ${names.join(', ')}`
    );
  }
  return kept;
}
