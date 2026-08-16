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

/** 'HH:mm'. TODO: validate at runtime — template literal types cannot express leading zeros. */
export type TimeOfDay = `${string}:${string}`;

/**
 * Duration parsing delegates to `ms` (typed StringValue); Duration is its
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
