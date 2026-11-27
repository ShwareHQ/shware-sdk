import type { TriggerIR } from '../ir';
import { type Condition, type PayloadWhere, type SegmentRef, condIR } from './condition';
import { type EventRef, type TriggerPayloadRefs, payloadRefs, triggerPayloadRefs } from './refs';

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

/**
 * What `trigger.event()` returns: the trigger, and a handle on the event that
 * fired it. `payload` is the table of that event's fields as the journey
 * entered with them:
 *
 *   const checkout = trigger.event(e.begin_checkout);
 *   workflow({ id: 'checkout_recovery', trigger: checkout })
 *     .branch([gte(checkout.payload.value, 100), (w) => w.email(email.vip_offer)])
 *     .email(email.reminder, { total: checkout.payload.value });
 *
 * The value is a snapshot: a later begin_checkout does not change what a
 * running journey reads. A reference is only valid in the workflow this
 * trigger starts — compileBundle refuses it anywhere else.
 */
export interface EventTriggerRef<P = unknown> extends TriggerRef {
  readonly type: 'event';
  readonly payload: TriggerPayloadRefs<P>;
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
  /**
   * Let a visitor who has not signed in enter: such a journey reaches them by push, having no
   * address to email. Off by default, because an entry made as a visitor is still theirs after
   * signing in, and counts against the workflow's `reentry` policy like any other entry.
   */
  visitors?: boolean;
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
  event<P>(event: EventRef<P>, opts?: EventTriggerOptions): EventTriggerRef<P>;
  event<P>(
    event: EventRef<P>,
    where: PayloadWhere<P>,
    opts?: EventTriggerOptions
  ): EventTriggerRef<P>;

  /**
   * Segment-entry trigger: the journey starts when the user goes from not
   * matching the segment to matching it. It is about entering, not about being
   * in: someone who already matched when the segment was deployed (or when its
   * condition last changed) is recorded as a member and starts nothing. Each
   * fresh qualification (left the segment, matched again) is one entry attempt
   * under the workflow's `reentry` policy; staying a member never enters again.
   *
   * Only a named segment is accepted — entry needs a membership table, which an
   * anonymous expression cannot have. Membership is re-evaluated on the user's
   * own activity (ingest, identify) and by the scheduled sweep, which is what
   * sees a segment entered by the clock alone (`not(performed(e.login, {
   * within: '7 days' }))`).
   *
   * To act on everyone who is in a segment now, name it in a condition instead
   * (a trigger's `filter`, a `branch`): that asks each user at that moment.
   */
  enters(segment: SegmentRef): TriggerRef;

  /** @deprecated Renamed `trigger.enters`: the same trigger, named for what it waits for. */
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
    const impl: TriggerInternal & EventTriggerRef<P> = {
      type: 'event',
      ir: {
        type: 'event',
        event: ev.name,
        ...(where !== undefined ? { where: condIR(where(payloadRefs<P>())) } : {}),
        ...(opts?.filter !== undefined ? { filter: condIR(opts.filter) } : {}),
        ...(opts?.visitors === true ? { visitors: true } : {}),
      },
      payload: triggerPayloadRefs<P>(ev.name),
    };
    return impl;
  },
  enters: (seg) => makeTrigger({ type: 'segment', segment: seg.id }),
  // oxlint-disable-next-line typescript/no-deprecated -- the alias itself
  segment: (seg) => makeTrigger({ type: 'segment', segment: seg.id }),
  date: (at) => makeTrigger({ type: 'date', at }),
  webhook: () => makeTrigger({ type: 'webhook' }),
};
