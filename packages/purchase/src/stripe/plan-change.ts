import type { Stripe } from 'stripe';
import type { PlanComparison, StripeConfig } from './config';
import { type CardFailure, type Decline, mapDecline } from './decline';
import { expanded, idOf } from './expandable';
import { type Money, mapTime, minorUnits, money } from './mapper';
import { METADATA_KEYS } from './metadata';
import { hasDelayedNotification } from './payment-method';

/**
 * Switching a Stripe subscription to another subscription product, with Apple's rules as the
 * default: a higher plan applies now, a lower plan or another period of the same plan at the
 * period end.
 *
 * An immediate change is a Stripe update with `payment_behavior: pending_if_incomplete`, so the
 * subscription stays exactly as it was unless today's invoice is paid: a card that needs 3DS parks
 * the change as a pending update (`requires_action`), a declined one voids it. A period-end change
 * is a two-phase subscription schedule: the current price until the period end, then the new one.
 * The product id travels as subscription (or phase) metadata under `METADATA_KEYS.PRODUCT_ID`,
 * which is how the app knows the plan.
 */

/** When a kind of change takes effect: now, charged on today's invoice, or at the period end. */
export type PlanChangeTiming = 'immediate' | 'period_end';

/**
 * How an immediate change bills:
 * - `restart_period`: the new plan is charged in full now, the unused rest of the current period
 *   is credited on the same invoice, and the billing cycle restarts today (Apple's upgrade, Play's
 *   `CHARGE_FULL_PRICE`).
 * - `keep_period`: only the prorated difference is charged now and the renewal date stays (Play's
 *   `CHARGE_PRORATED_PRICE`). Stripe still restarts the cycle when the new price bills over a
 *   different interval.
 */
export type ImmediateBilling = 'restart_period' | 'keep_period';

export interface PlanChangeOptions<PE extends string, BP extends string> {
  stripe: Stripe;
  /** declares `plans` and `billingPeriods`, which order the changes (`comparePlans`) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: StripeConfig<any, PE, BP, any, any>;
  /**
   * Mirror the subscription after Stripe changed it, as the app stores it. Called after every
   * change, and after a failed immediate one too, so the row never shows a state Stripe no longer
   * has. What it throws propagates.
   */
  sync: (stripeSubscriptionId: string) => Promise<void>;
  /**
   * When each kind of change applies. The defaults are Apple's: `upgrade` immediate; `downgrade`,
   * `longer` and `shorter` at the period end.
   */
  timing?: Partial<Record<Exclude<PlanComparison, 'same'>, PlanChangeTiming>>;
  /** default `restart_period` */
  immediateBilling?: ImmediateBilling;
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
 * `clientSecret` with stripe.js; the change applies once that invoice is paid
 * (`customer.subscription.pending_update_applied`), or lapses after ~23 hours
 * (`pending_update_expired`) and nothing changes.
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
 * - NOT_SWITCHABLE: past due, unpaid, paused, incomplete or trialing; the fix is the payment
 *   method, not another charge, and what a switch mid-trial should do is the app's to decide.
 * - CANCEL_SCHEDULED: set to cancel at the period end; reactivate first.
 * - CHANGE_PENDING: an earlier immediate change still waits on its payment; only the same target
 *   may be retried.
 * - UNCHANGED: already on the target product.
 * - REQUIRES_INSTANT_METHOD: an immediate change would be paid by a bank debit
 *   (`hasDelayedNotification`); `paymentMethodType` names it.
 * - DECLINED: the card was refused; `decline` says why.
 * - CONFLICT: a concurrent change on the same snapshot was applied instead.
 * - MISCONFIGURED: the subscription or config is not what a change needs (no item, no product
 *   metadata, a price without a flat amount, a pending invoice without a payment intent).
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
  readonly paymentMethodType: string | null;

  constructor(
    reason: PlanChangeErrorReason,
    message: string,
    extra: { decline?: Decline; paymentMethodType?: string } = {}
  ) {
    super(message);
    this.name = 'PlanChangeError';
    this.reason = reason;
    this.decline = extra.decline ?? null;
    this.paymentMethodType = extra.paymentMethodType ?? null;
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

const DEFAULT_TIMING: Record<Exclude<PlanComparison, 'same'>, PlanChangeTiming> = {
  upgrade: 'immediate',
  downgrade: 'period_end',
  longer: 'period_end',
  shorter: 'period_end',
};

/**
 * Where an immediate change parked as a pending update stands, read from its invoice's
 * PaymentIntent (the subscription's latest invoice; a pending update expires by the period end at
 * the latest, so no renewal invoice can come after it).
 * - `challenge`: the bank wants the cardholder to authenticate; stripe.js runs it with the secret.
 * - `paid`: paid in the meantime (another tab finished the challenge); Stripe applies the update.
 * - `declined`: the attempt is over (a declined card, or a challenge that failed or was abandoned).
 *   The invoice is voided, which drops the pending update; a concurrent duplicate finds it void.
 */
type ParkedUpdate =
  | { state: 'challenge'; result: PlanChangeResult }
  | { state: 'paid' }
  | { state: 'declined'; failure: CardFailure };

/** stripe-node's error classes, matched by their `type` so this module needs no runtime import. */
function stripeErrorType(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('type' in error)) return null;
  return typeof error.type === 'string' ? error.type : null;
}

const now = () => new Date().toISOString();

export function createPlanChange<PE extends string, BP extends string>(
  options: PlanChangeOptions<PE, BP>
): PlanChange<PE, BP> {
  const { stripe, config, sync } = options;
  const timing = { ...DEFAULT_TIMING, ...options.timing };
  const immediateBilling = options.immediateBilling ?? 'restart_period';

  async function planSummary(productId: string): Promise<PlanSummary<PE, BP>> {
    const price = await stripe.prices.retrieve(config.getPriceId(productId));
    if (price.unit_amount === null) {
      throw new PlanChangeError('MISCONFIGURED', `Price ${price.id} has no amount`);
    }
    return {
      productId,
      plan: config.getPlan(productId),
      billingPeriod: config.getBillingPeriod(productId),
      price: money(price.unit_amount, price.currency),
      credits: config.getCreditAmount(productId),
    };
  }

  /**
   * Whether a pending update moves the subscription to `productId`: its one item carries the price
   * an immediate change sets for that product. Anything else counts as a different target.
   */
  function pendingUpdateTargets(pending: Stripe.Subscription.PendingUpdate, productId: string) {
    const items = pending.subscription_items ?? [];
    const only = items.length === 1 ? items[0] : undefined;
    return only?.price.id === config.getPriceId(productId);
  }

  /**
   * The payment method an invoice on this subscription is charged to: its own default when it has
   * one (Checkout pins the card it collected), else the customer's invoice default. Retrieved whole
   * because an immediate change needs its `type`.
   */
  async function chargedPaymentMethod(sub: Stripe.Subscription) {
    const own = sub.default_payment_method;
    if (own) return typeof own === 'string' ? stripe.paymentMethods.retrieve(own) : own;
    const customer = await stripe.customers.retrieve(idOf(sub.customer), {
      expand: ['invoice_settings.default_payment_method'],
    });
    if (customer.deleted) return null;
    const preferred = customer.invoice_settings.default_payment_method;
    if (!preferred) return null;
    return typeof preferred === 'string' ? stripe.paymentMethods.retrieve(preferred) : preferred;
  }

  /** The subscription plus the checks every change starts with. */
  async function subscriptionForChange(stripeSubscriptionId: string, productId: string) {
    if (!config.isSubscription(productId)) {
      throw new PlanChangeError('NOT_A_SUBSCRIPTION', `Not a subscription product: ${productId}`);
    }
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId, { expand: ['schedule'] });
    if (sub.status === 'canceled') {
      throw new PlanChangeError('ALREADY_CANCELED', 'Subscription already canceled');
    }
    if (sub.status !== 'active') {
      throw new PlanChangeError('NOT_SWITCHABLE', `Subscription is ${sub.status}`);
    }
    if (sub.cancel_at_period_end || sub.cancel_at !== null) {
      throw new PlanChangeError('CANCEL_SCHEDULED', 'Subscription is scheduled to cancel');
    }
    // An earlier immediate change parked until its invoice is paid (3DS). The customer may still be
    // authenticating it, so it is never voided or replaced here: asking for the same target again
    // resumes it, anything else is refused. Checked before UNCHANGED because the metadata still
    // names the plan from before the pending update.
    const resumesPendingUpdate = sub.pending_update
      ? pendingUpdateTargets(sub.pending_update, productId)
      : false;
    if (sub.pending_update && !resumesPendingUpdate) {
      throw new PlanChangeError(
        'CHANGE_PENDING',
        `Subscription has a pending update until ${mapTime(sub.pending_update.expires_at)}`
      );
    }
    const currentProductId = sub.metadata[METADATA_KEYS.PRODUCT_ID];
    if (!currentProductId || !config.isSubscription(currentProductId)) {
      throw new PlanChangeError('MISCONFIGURED', `Subscription ${sub.id} names no known product`);
    }
    const comparison = config.comparePlans(currentProductId, productId);
    if (comparison === 'same') throw new PlanChangeError('UNCHANGED', 'Already on this plan');
    const item = sub.items.data.at(0);
    if (!item) throw new PlanChangeError('MISCONFIGURED', `Subscription ${sub.id} has no items`);

    const immediate = timing[comparison] === 'immediate';
    const base = { sub, item, currentProductId, comparison, immediate, resumesPendingUpdate };
    if (!immediate) return { ...base, paymentMethodId: null };
    // Checked here so the preview refuses before the customer confirms, and the change refuses
    // before a parked period-end change is released. A bank debit would leave the pending update
    // processing past its ~23 hours and then report a decline the customer never had.
    const paymentMethod = await chargedPaymentMethod(sub);
    if (paymentMethod && hasDelayedNotification(paymentMethod.type)) {
      throw new PlanChangeError(
        'REQUIRES_INSTANT_METHOD',
        `Immediate plan change cannot be paid by ${paymentMethod.type}`,
        { paymentMethodType: paymentMethod.type }
      );
    }
    return { ...base, paymentMethodId: paymentMethod?.id ?? null };
  }

  /** The parameters of an immediate change, shared by the preview and the real update. */
  function immediateChangeParams(item: Stripe.SubscriptionItem, productId: string) {
    return {
      items: [{ id: item.id, price: config.getPriceId(productId) }],
      proration_behavior: 'always_invoice' as const,
      ...(immediateBilling === 'restart_period'
        ? { billing_cycle_anchor: { type: 'now' as const } }
        : {}),
    };
  }

  async function settleParkedUpdate(sub: Stripe.Subscription): Promise<ParkedUpdate> {
    const invoiceId = idOf(sub.latest_invoice);
    if (!invoiceId) {
      throw new PlanChangeError('MISCONFIGURED', `Pending update on ${sub.id} has no invoice`);
    }
    // A second call because Stripe caps expansion at four levels below the subscription.
    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['payments.data.payment.payment_intent'],
    });
    const intent = invoice.payments?.data.at(0)?.payment.payment_intent;
    if (!intent || typeof intent === 'string' || !intent.client_secret) {
      throw new PlanChangeError(
        'MISCONFIGURED',
        `Pending invoice ${invoiceId} has no payment intent`
      );
    }
    switch (intent.status) {
      case 'requires_action':
        return {
          state: 'challenge',
          result: {
            effect: 'requires_action',
            effectiveAt: now(),
            clientSecret: intent.client_secret,
          },
        };
      case 'succeeded':
        return { state: 'paid' };
      case 'requires_payment_method':
        if (invoice.status !== 'void') await stripe.invoices.voidInvoice(invoiceId);
        return { state: 'declined', failure: intent.last_payment_error };
      default:
        throw new PlanChangeError(
          'MISCONFIGURED',
          `Pending invoice ${invoiceId} has its payment in state ${intent.status}`
        );
    }
  }

  function declined(failure: CardFailure) {
    const decline = mapDecline(failure);
    return new PlanChangeError('DECLINED', decline.message ?? 'Payment declined', { decline });
  }

  const applied = (): PlanChangeResult => ({
    effect: 'immediate',
    effectiveAt: now(),
    clientSecret: null,
  });

  async function readScheduled(sub: Stripe.Subscription) {
    const schedule = expanded(sub.schedule, `Schedule of subscription ${sub.id}`);
    if (!schedule) return null;
    if (schedule.status !== 'active' && schedule.status !== 'not_started') return null;
    // The next phase is found from `current_phase`, not the wall clock, so it also holds for
    // customers on a Stripe test clock.
    const current = schedule.current_phase;
    if (!current) return null;
    const next = schedule.phases.find((phase) => phase.start_date >= current.end_date);
    if (!next) return null;

    const productId = next.metadata?.[METADATA_KEYS.PRODUCT_ID];
    if (!productId || productId === sub.metadata[METADATA_KEYS.PRODUCT_ID]) return null;
    // A product that left the config, or a next phase without a flat price (set up in the
    // dashboard), must not wedge every sync of this subscription; it just stops showing.
    if (!config.isSubscription(productId)) {
      console.error(`Schedule ${schedule.id} next phase names unknown product ${productId}`);
      return null;
    }
    const priceId = idOf(next.items.at(0)?.price);
    if (!priceId) {
      console.error(`Schedule ${schedule.id} next phase has no price`);
      return null;
    }
    const price = await stripe.prices.retrieve(priceId);
    if (price.unit_amount === null) {
      console.error(`Schedule ${schedule.id} next phase price ${priceId} has no unit amount`);
      return null;
    }
    return {
      productId,
      plan: config.getPlan(productId),
      billingPeriod: config.getBillingPeriod(productId),
      price: money(price.unit_amount, price.currency),
      effectiveAt: mapTime(next.start_date),
    };
  }

  async function preview(stripeSubscriptionId: string, productId: string) {
    const { sub, item, currentProductId, comparison, immediate } = await subscriptionForChange(
      stripeSubscriptionId,
      productId
    );
    const [current, target] = await Promise.all([
      planSummary(currentProductId),
      planSummary(productId),
    ]);
    if (!immediate) {
      return {
        comparison,
        effect: 'scheduled' as const,
        current,
        target,
        effectiveAt: mapTime(item.current_period_end),
        charge: null,
      };
    }

    const invoice = await stripe.invoices.createPreview({
      subscription: sub.id,
      subscription_details: immediateChangeParams(item, productId),
    });
    // Proration lines are the credit for unused time (negative); the rest is the new plan.
    let creditBack = 0;
    let newPlan = 0;
    let nextBillingAt = invoice.period_end;
    for (const line of invoice.lines.data) {
      if (line.parent?.subscription_item_details?.proration) {
        creditBack -= line.amount;
      } else {
        newPlan += line.amount;
        nextBillingAt = Math.max(nextBillingAt, line.period.end);
      }
    }
    const units = minorUnits(invoice.currency);
    // starting_balance is negative when the customer holds credit; Stripe applies it to the total.
    const balanceApplied = Math.min(
      Math.max(0, -invoice.starting_balance),
      Math.max(0, newPlan - creditBack)
    );
    return {
      comparison,
      effect: 'immediate' as const,
      current,
      target,
      effectiveAt: now(),
      charge: {
        newPlan: newPlan / units,
        creditBack: creditBack / units,
        dueToday: invoice.amount_due / units,
        balanceApplied: balanceApplied / units,
        accountCredit: Math.max(0, creditBack - newPlan) / units,
        currency: invoice.currency,
        nextBillingAt: mapTime(nextBillingAt),
      },
    };
  }

  async function applyNow(
    sub: Stripe.Subscription,
    item: Stripe.SubscriptionItem,
    currentProductId: string,
    productId: string,
    paymentMethodId: string | null
  ): Promise<PlanChangeResult> {
    // Stripe refuses item changes on a subscription a schedule manages, so a parked period-end
    // change is released first. A released schedule is terminal, so its id alone keys the release:
    // a concurrent duplicate gets the first release back instead of an "already released" error.
    const scheduleId = idOf(sub.schedule);
    if (scheduleId) {
      await stripe.subscriptionSchedules.release(
        scheduleId,
        {},
        { idempotencyKey: `release:${scheduleId}` }
      );
    }
    // Nothing else serializes two identical requests: both pass the UNCHANGED check on the same
    // snapshot, and a second update would bill again. So the update is keyed by its intent: this
    // subscription, from this plan to that one, within this period, on top of this latest invoice,
    // charged to this payment method. Requests read from the same snapshot build the same key and
    // parameters, so Stripe applies the update once and replays it to the other; any real change
    // (a later A→B→C, a new period, a declined attempt's own invoice, another card) gets a new key.
    const idempotencyKey = [
      'plan',
      sub.id,
      currentProductId,
      productId,
      item.current_period_start,
      idOf(sub.latest_invoice) ?? 'none',
      paymentMethodId ?? 'none',
    ].join(':');
    let updated: Stripe.Subscription;
    try {
      updated = await stripe.subscriptions.update(
        sub.id,
        {
          ...immediateChangeParams(item, productId),
          metadata: { ...sub.metadata, [METADATA_KEYS.PRODUCT_ID]: productId },
          payment_behavior: 'pending_if_incomplete',
        },
        { idempotencyKey }
      );
    } catch (error) {
      // `pending_if_incomplete` absorbs declines, so a card error here is one Stripe refused to
      // attempt at all (an expired card, say).
      if (stripeErrorType(error) === 'StripeCardError') throw declined(error as CardFailure);
      // Same key, different parameters: the subscription changed between two requests built on
      // the same snapshot. Nothing was applied by this one.
      if (stripeErrorType(error) === 'StripeIdempotencyError') {
        throw new PlanChangeError('CONFLICT', 'Plan change conflicts with a concurrent one');
      }
      throw error;
    } finally {
      await sync(sub.id);
    }
    if (!updated.pending_update) return applied();
    const parked = await settleParkedUpdate(updated);
    if (parked.state === 'challenge') return parked.result;
    await sync(sub.id);
    if (parked.state === 'paid') return applied();
    // A declined card parks the update just like 3DS does; it was voided above.
    throw declined(parked.failure);
  }

  async function applyAtPeriodEnd(
    sub: Stripe.Subscription,
    item: Stripe.SubscriptionItem,
    productId: string
  ): Promise<PlanChangeResult> {
    // The new phase lasts one interval of the target price, after which the schedule releases the
    // subscription and it keeps renewing on that price.
    const targetPrice = await stripe.prices.retrieve(config.getPriceId(productId));
    if (!targetPrice.recurring) {
      throw new PlanChangeError('MISCONFIGURED', `Price ${targetPrice.id} is not recurring`);
    }
    // No idempotency keys here: Stripe allows one schedule per subscription, so a concurrent
    // duplicate's `create` fails, and rewriting the phases twice from one snapshot changes nothing.
    // A key would replay a released schedule for "keep current plan" then the same change again.
    const schedule =
      sub.schedule && typeof sub.schedule !== 'string'
        ? sub.schedule
        : await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
    const current = schedule.current_phase;
    const phase = schedule.phases.find((p) => p.start_date === current?.start_date);
    if (!current || !phase) {
      throw new PlanChangeError('MISCONFIGURED', `Schedule ${schedule.id} has no current phase`);
    }
    // A discount on the subscription has to be carried into both phases by hand, since the update
    // replaces every phase. Reusing it by id keeps its clock (a repeating coupon re-attached would
    // start its months over), and one that has run out is simply dropped by Stripe.
    const discounts = sub.discounts.map((d) => ({ discount: idOf(d) }));
    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: 'release',
      phases: [
        {
          start_date: current.start_date,
          end_date: item.current_period_end,
          items: [{ price: item.price.id, quantity: item.quantity }],
          metadata: sub.metadata,
          discounts,
          proration_behavior: 'none',
        },
        {
          items: [{ price: targetPrice.id, quantity: 1 }],
          duration: {
            interval: targetPrice.recurring.interval,
            interval_count: targetPrice.recurring.interval_count,
          },
          metadata: { ...sub.metadata, [METADATA_KEYS.PRODUCT_ID]: productId },
          discounts,
          proration_behavior: 'none',
        },
      ],
    });
    await sync(sub.id);
    return {
      effect: 'scheduled',
      effectiveAt: mapTime(item.current_period_end),
      clientSecret: null,
    };
  }

  async function apply(stripeSubscriptionId: string, productId: string) {
    const { sub, item, currentProductId, immediate, resumesPendingUpdate, paymentMethodId } =
      await subscriptionForChange(stripeSubscriptionId, productId);

    if (resumesPendingUpdate) {
      // The same change again while an earlier attempt is parked. A challenge still waiting is
      // handed back as is; one that failed or was abandoned has its invoice voided and the change is
      // attempted again below, so retrying after closing the 3DS window starts a fresh challenge.
      const parked = await settleParkedUpdate(sub);
      if (parked.state === 'challenge') return parked.result;
      if (parked.state === 'paid') {
        await sync(sub.id);
        return applied();
      }
    }
    if (immediate) return applyNow(sub, item, currentProductId, productId, paymentMethodId);
    return applyAtPeriodEnd(sub, item, productId);
  }

  async function cancelScheduled(stripeSubscriptionId: string) {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId, { expand: ['schedule'] });
    const scheduleId = idOf(sub.schedule);
    if (scheduleId && (await readScheduled(sub))) {
      await stripe.subscriptionSchedules.release(scheduleId);
    }
    await sync(sub.id);
  }

  return { preview, apply, cancelScheduled, readScheduled };
}
