import ms from 'ms';
import type { DurationIR } from '../ir';

/**
 * Base vocabulary shared by the whole DSL: the schema constraints an app's
 * types must satisfy, and the literal types (durations, weekdays, clock times)
 * the builder methods accept.
 *
 * Type technique: `Duration` is a template-literal union — '1 huor' is a
 * compile error, no runtime validation needed for the common case.
 */

/**
 * Event name → payload shape, supplied by the app (its analytics schema).
 * Constrained to `object` rather than `Record`: interfaces have no implicit
 * index signature, so a Record constraint would reject an interface-defined
 * schema. Event names come from `keyof E`, payloads from `E[N]`.
 */
export type EventMap = object;

/** Base shape of user properties; the app extends it with concrete fields. */
export interface UserPropertyBase {
  userId: string;
  email: string;
}

/** Duration literal: '1 hour' / '23 hours' / '30 days' — typos fail to compile. */
export type Duration = `${number} ${
  | 'second'
  | 'seconds'
  | 'minute'
  | 'minutes'
  | 'hour'
  | 'hours'
  | 'day'
  | 'days'
  | 'week'
  | 'weeks'}`;

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** 'HH:mm' (24h, leading zeros). The type cannot express digit ranges, so builders validate at runtime via timeOfDayMinutes. */
export type TimeOfDay = `${string}:${string}`;

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Parse an 'HH:mm' literal to minutes since midnight, throwing on anything the
 * type let through ('9:00', '25:00', 'ab:cd').
 * @internal shared by flow builders, not part of the public API
 */
export function timeOfDayMinutes(value: TimeOfDay): number {
  const match = TIME_OF_DAY.exec(value);
  if (!match) throw new Error(`Invalid time of day: '${value}' (expected 'HH:mm', e.g. '09:00')`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Duration parsing delegates to `ms` (typed StringValue); Duration is it's
 * stricter, full-word subset.
 * @internal shared by condition/flow/workflow, not part of the public API
 */
export function durationIR(value: Duration): DurationIR {
  const millis = ms(value);
  if (typeof millis !== 'number' || Number.isNaN(millis) || millis < 0) {
    throw new Error(`Invalid duration: '${value}'`);
  }
  return { value, ms: millis };
}
