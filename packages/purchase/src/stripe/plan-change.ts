import type { Stripe } from 'stripe';
import type { PlanComparison, StripeConfig } from './config';
import type { Decline } from './decline';
import type { Money } from './mapper';

/**
 * Switching a Stripe subscription to another subscription product, with Apple's rules as the
 * default: a higher plan applies now, a lower plan at the period end. Interface only for now: every
 * method throws until the implementation moves over from the template.
 */

/** When a kind of change takes effect: now, charged on today's invoice, or at the period end. */
export type PlanChangeTiming = 'immediate' | 'period_end';

/**
 * How an immediate change bills:
 * - `restart_period`: the new plan is charged in full now, the unused rest of the current period
 *   is credited on the same invoice, and the billing cycle restarts today (Apple's upgrade, Play's
 *   `CHARGE_FULL_PRICE`).
 * - `keep_period`: only the prorated difference is charged now and the renewal date stays (Play's
 *   `CHARGE_PRORATED_PRICE`).
 */
export type ImmediateBilling = 'restart_period' | 'keep_period';

export interface PlanChangeOptions<PE extends string, BP extends string> {
  stripe: Stripe;
  /** declares `plans` and `billingPeriods`, which order the changes (`comparePlans`) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: StripeConfig<any, PE, BP, any, any>;
  /**
   * Mirror the subscription after Stripe changed it, as the app stores it. Called after every
   * change, and after a failed one too, so the row never shows a state Stripe no longer has.
   */
  sync: (stripeSubscriptionId: string) => Promise<void>;
  /**
   * When each kind of change applies. The defaults: `upgrade` and `longer` immediate, `downgrade`
   * and `shorter` at the period end.
   */
  timing?: Partial<Record<Exclude<PlanComparison, 'same'>, PlanChangeTiming>>;
  /** default `restart_period` */
  immediateBilling?: ImmediateBilling;
  /**
   * Whether a trialing subscription may switch. Default false: what a switch mid-trial should do
   * (keep the trial on the new plan, or end it and charge) is the app's decision to make first.
   */
  allowTrialing?: boolean;
}

export interface PlanSummary<PE extends string = string, BP extends string = string> {
  productId: string;
  plan: PE;
  billingPeriod: BP;
  /** the plan's list price */
  price: Money;
  /** credits granted per billing period */
  credits: number;
}

/** A change parked in the subscription's schedule, to apply at the period end. */
export interface ScheduledPlanChange<PE extends string = string, BP extends string = string> {
  productId: string;
  plan: PE;
  billingPeriod: BP;
  price: Money;
  effectiveAt: string;
}

/** What a change would do, before anything is charged. */
export interface PlanChangePreview<PE extends string = string, BP extends string = string> {
  comparison: Exclude<PlanComparison, 'same'>;
  effect: 'immediate' | 'scheduled';
  current: PlanSummary<PE, BP>;
  target: PlanSummary<PE, BP>;
  /** now for an immediate change, the current period end for a scheduled one */
  effectiveAt: string;
  /** immediate only: today's invoice */
  charge: {
    newPlan: number;
    creditBack: number;
    dueToday: number;
    /** existing customer balance Stripe applies to this invoice */
    balanceApplied: number;
    /** credit beyond the new plan's price, left on the customer balance */
    accountCredit: number;
    currency: string;
    /** the first regular renewal on the new plan */
    nextBillingAt: string;
  } | null;
}

/**
 * The outcome of a change. `requires_action`: the card needs authentication (3DS) for
 * `clientSecret` with stripe.js; the change applies once that invoice is paid, or lapses after
 * ~23 hours and nothing changes.
 */
export interface PlanChangeResult {
  effect: 'immediate' | 'scheduled' | 'requires_action';
  effectiveAt: string;
  clientSecret: string | null;
}

/**
 * Why a change was refused:
 * - NOT_A_SUBSCRIPTION: the target product is not a subscription in the config.
 * - ALREADY_CANCELED: the subscription has ended.
 * - NOT_SWITCHABLE: past due, unpaid, paused, incomplete, or trialing without `allowTrialing`;
 *   the fix is the payment method, not another charge.
 * - CANCEL_SCHEDULED: set to cancel at the period end; reactivate first.
 * - CHANGE_PENDING: an earlier immediate change still waits on its payment; only the same target
 *   may be retried.
 * - UNCHANGED: already on the target product.
 * - REQUIRES_INSTANT_METHOD: an immediate change would be paid by a bank debit
 *   (`hasDelayedNotification`).
 * - DECLINED: the card was refused; `decline` says why.
 * - CONFLICT: a concurrent change on the same snapshot was applied instead.
 * - MISCONFIGURED: the subscription or config is not what a change needs (no item, no product
 *   metadata, a pending invoice without a payment intent).
 */
export const PLAN_CHANGE_ERROR_REASONS = [
  'NOT_A_SUBSCRIPTION',
  'ALREADY_CANCELED',
  'NOT_SWITCHABLE',
  'CANCEL_SCHEDULED',
  'CHANGE_PENDING',
  'UNCHANGED',
  'REQUIRES_INSTANT_METHOD',
  'DECLINED',
  'CONFLICT',
  'MISCONFIGURED',
] as const;

export type PlanChangeErrorReason = (typeof PLAN_CHANGE_ERROR_REASONS)[number];

/** A refused change. The app turns `reason` (and `decline`) into its own error response. */
export class PlanChangeError extends Error {
  readonly reason: PlanChangeErrorReason;
  readonly decline: Decline | null;

  constructor(reason: PlanChangeErrorReason, message: string, decline: Decline | null = null) {
    super(message);
    this.name = 'PlanChangeError';
    this.reason = reason;
    this.decline = decline;
  }
}

export interface PlanChange<PE extends string = string, BP extends string = string> {
  /** What switching `stripeSubscriptionId` to `productId` would charge and when it would apply. */
  preview(stripeSubscriptionId: string, productId: string): Promise<PlanChangePreview<PE, BP>>;
  /** Switch `stripeSubscriptionId` to `productId`; throws {@link PlanChangeError} when refused. */
  apply(stripeSubscriptionId: string, productId: string): Promise<PlanChangeResult>;
  /** Drop a change scheduled for the period end ("keep current plan"); nothing pending is fine. */
  cancelScheduled(stripeSubscriptionId: string): Promise<void>;
  /**
   * The change scheduled on a subscription retrieved with `expand: ['schedule']`, for the app's
   * mirror of it, or null when none is pending.
   */
  readScheduled(subscription: Stripe.Subscription): Promise<ScheduledPlanChange<PE, BP> | null>;
}

export function createPlanChange<PE extends string, BP extends string>(
  options: PlanChangeOptions<PE, BP>
): PlanChange<PE, BP> {
  void options;
  const notImplemented = (method: string) => () =>
    Promise.reject(new Error(`createPlanChange: ${method} is not implemented yet`));
  return {
    preview: notImplemented('preview'),
    apply: notImplemented('apply'),
    cancelScheduled: notImplemented('cancelScheduled'),
    readScheduled: notImplemented('readScheduled'),
  };
}
