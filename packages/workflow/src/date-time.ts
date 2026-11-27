/**
 * The `DateTime` a date trigger is written with ('YYYY-MM-DD HH:mm:ss', UTC), read in one place:
 * the DSL refuses what this cannot read, and the store routes by the instant it answers.
 */

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * The instant a `DateTime` names, as epoch milliseconds; undefined when it is not one (the wrong
 * shape, or a date the calendar does not have: '2026-02-30 09:00:00').
 */
export function dateTimeMs(at: string): number | undefined {
  const match = DATE_TIME.exec(at);
  if (match === null) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(ms);
  // Date.UTC rolls an impossible date over into the next month; a date that survives the round
  // trip is one the calendar has
  return back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day &&
    hour < 24 &&
    minute < 60 &&
    second < 60
    ? ms
    : undefined;
}
