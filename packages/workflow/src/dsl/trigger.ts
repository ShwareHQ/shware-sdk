import type { TriggerIR } from '../ir';
import { type Condition, type PayloadWhere, type SegmentRef, condIR } from './condition';
import { type EventRef, payloadRefs } from './refs';

/**
 * Triggers — the four ways into a workflow, mirroring customer.io's campaign
 * trigger types. A trigger is a plain reusable object; the event name and
 * payload types flow in from an e.xxx reference, so the factory itself needs
 * no generics.
 */

/** 'YYYY-MM-DD HH:mm:ss'. TODO: validate at runtime — template literals cannot express leading zeros. */
export type DateTime = string;

/** Trigger reference: what trigger.xxx() returns, reusable across workflows. */
export interface TriggerRef {
  readonly type: 'event' | 'segment' | 'date' | 'webhook';
}

/** @internal the compiled shape behind a TriggerRef — workflow.toIR reads .ir off it */
export interface TriggerInternal extends TriggerRef {
  readonly ir: TriggerIR;
}

const makeTrigger = (ir: TriggerIR): TriggerRef => {
  const impl: TriggerInternal = { type: ir.type, ir };
  return impl;
};

export interface EventTriggerOptions {
  filter?: Condition;
}

/** Trigger factory: four ways in, mirroring customer.io's campaign trigger types. */
export interface TriggerFactory {
  /**
   * Event trigger: the event name comes from an e.xxx reference (types flow in
   * from it, so the factory itself needs no generics). Two independent gates:
   * - the optional second argument is a payload where clause (typed refs, the
   *   ordinary predicates — compiles to IR data the UI renders):
   *   trigger.event(e.login, (p) => eq(p.platform, 'web'))
   * - `filter` tests the user's profile (customer.io's trigger Filters).
   * The user enters only if the event fired *and* both gates hold.
   */
  event<P>(event: EventRef<P>, opts?: EventTriggerOptions): TriggerRef;
  event<P>(event: EventRef<P>, where: PayloadWhere<P>, opts?: EventTriggerOptions): TriggerRef;

  /**
   * Segment-entry trigger: the user enters the moment they go from not
   * matching to matching. Only a named segment is accepted — entry semantics
   * need a membership table, which an anonymous expression cannot provide.
   * Runtime note: membership is maintained lazily (re-evaluated on the user's
   * ingest/identify activity), so purely time-driven drift — e.g. an
   * inactivity segment becoming true by clock alone — is only observed on the
   * user's next activity. TODO: a cron sweep for time-driven segments.
   */
  segment(segment: SegmentRef): TriggerRef;

  /**
   * Scheduled trigger (one-shot, e.g. '2026-12-25 09:00:00', interpreted as
   * UTC). TODO: not routed by the runtime yet — deployBundle reports it in
   * `unrouted`; the implementation goes through cron + Queues (instance
   * creation is rate-limited, a date trigger fans out to the whole audience at
   * once). TODO: cron/recurring form.
   */
  date(at: DateTime): TriggerRef;

  /** Webhook trigger: third-party or external code fires it via a URL; the runtime allocates the endpoint. */
  webhook(): TriggerRef;
}

/**
 * Trigger definition: a plain object — event names come from e.xxx references.
 *
 *   const login = trigger.event(e.login, { filter: newUsers7d });
 */
export const trigger: TriggerFactory = {
  event: <P>(
    ev: EventRef<P>,
    whereOrOpts?: PayloadWhere<P> | EventTriggerOptions,
    maybeOpts?: EventTriggerOptions
  ) => {
    const where = typeof whereOrOpts === 'function' ? whereOrOpts : undefined;
    const opts = typeof whereOrOpts === 'function' ? maybeOpts : whereOrOpts;
    return makeTrigger({
      type: 'event',
      event: ev.name,
      ...(where !== undefined ? { where: condIR(where(payloadRefs<P>())) } : {}),
      ...(opts?.filter !== undefined ? { filter: condIR(opts.filter) } : {}),
    });
  },
  segment: (seg) => makeTrigger({ type: 'segment', segment: seg.name }),
  date: (at) => makeTrigger({ type: 'date', at }),
  webhook: () => makeTrigger({ type: 'webhook' }),
};
