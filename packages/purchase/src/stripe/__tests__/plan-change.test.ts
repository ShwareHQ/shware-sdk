import type { Stripe } from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeConfig } from '../config';
import { METADATA_KEYS } from '../metadata';
import { PlanChangeError, createPlanChange } from '../plan-change';

const STARTER_MONTHLY = 'com.example.starter.monthly';
const STARTER_YEARLY = 'com.example.starter.yearly';
const PRO_MONTHLY = 'com.example.pro.monthly';
const CREDITS = 'com.example.credits';
const PERIOD_START = 1_700_000_000;
const PERIOD_END = PERIOD_START + 30 * 24 * 3600;

const config = StripeConfig.create<'com.example', 'STARTER' | 'PRO', 'MONTHLY' | 'YEARLY'>({
  mode: 'live',
  allowPromotionCodes: false,
  cancellationCouponId: 'coupon_1',
  returnUrl: 'https://example.com/return',
  cancelUrl: 'https://example.com/cancel',
  successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
  plans: ['STARTER', 'PRO'],
  billingPeriods: ['MONTHLY', 'YEARLY'],
})
  .product(STARTER_MONTHLY, 'STARTER', 'MONTHLY')
  .price('price_sm', { credits: 100, expiresIn: '30d' })
  .default('price_sm')
  .product(STARTER_YEARLY, 'STARTER', 'YEARLY')
  .price('price_sy', { credits: 1200, expiresIn: '365d' })
  .default('price_sy')
  .product(PRO_MONTHLY, 'PRO', 'MONTHLY')
  .price('price_pm', { credits: 500, expiresIn: '30d' })
  .default('price_pm')
  .product(CREDITS)
  .price('price_c', { credits: 10, expiresIn: '1y' })
  .default('price_c');

const PRICES: Record<string, Partial<Stripe.Price>> = {
  price_sm: { id: 'price_sm', unit_amount: 800, currency: 'usd', recurring: recurring('month') },
  price_sy: { id: 'price_sy', unit_amount: 8000, currency: 'usd', recurring: recurring('year') },
  price_pm: { id: 'price_pm', unit_amount: 2000, currency: 'usd', recurring: recurring('month') },
};

function recurring(interval: 'month' | 'year') {
  return { interval, interval_count: 1 } as Stripe.Price.Recurring;
}

function subscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: null,
    pending_update: null,
    schedule: null,
    latest_invoice: 'in_latest',
    customer: 'cus_1',
    default_payment_method: { id: 'pm_card', type: 'card' },
    discounts: [],
    metadata: { [METADATA_KEYS.USER_ID]: 'u1', [METADATA_KEYS.PRODUCT_ID]: STARTER_MONTHLY },
    items: {
      data: [
        {
          id: 'si_1',
          quantity: 1,
          price: { id: 'price_sm' },
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

// oxlint-disable-next-line typescript/no-explicit-any -- stands in for any Stripe resource method
type StripeCall = (...args: any[]) => Promise<any>;

/** The slice of the Stripe client the module calls, every method a mock. */
function fakeStripe(sub: Stripe.Subscription) {
  return {
    subscriptions: {
      retrieve: vi.fn<StripeCall>(async () => sub),
      update: vi.fn<StripeCall>(async () => ({ ...sub, pending_update: null })),
    },
    subscriptionSchedules: {
      create: vi.fn<StripeCall>(async () => ({
        id: 'sub_sched_1',
        current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
        phases: [{ start_date: PERIOD_START, end_date: PERIOD_END }],
      })),
      update: vi.fn<StripeCall>(async () => ({})),
      release: vi.fn<StripeCall>(async () => ({})),
    },
    prices: { retrieve: vi.fn<StripeCall>(async (id: string) => PRICES[id]) },
    paymentMethods: { retrieve: vi.fn<StripeCall>() },
    customers: { retrieve: vi.fn<StripeCall>() },
    invoices: {
      retrieve: vi.fn<StripeCall>(),
      voidInvoice: vi.fn<StripeCall>(async () => ({})),
      createPreview: vi.fn<StripeCall>(),
    },
  };
}

function setup(sub = subscription(), timing?: Parameters<typeof createPlanChange>[0]['timing']) {
  const stripe = fakeStripe(sub);
  const sync = vi.fn<(id: string) => Promise<void>>(async () => {});
  const plans = createPlanChange({ stripe: stripe as unknown as Stripe, config, sync, timing });
  return { stripe, sync, plans };
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PlanChangeError);
  return error as PlanChangeError;
}

describe('createPlanChange', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('refusals', () => {
    it.each([
      [{ status: 'canceled' }, PRO_MONTHLY, 'ALREADY_CANCELED'],
      [{ status: 'past_due' }, PRO_MONTHLY, 'NOT_SWITCHABLE'],
      [{ status: 'trialing' }, PRO_MONTHLY, 'NOT_SWITCHABLE'],
      [{ cancel_at_period_end: true }, PRO_MONTHLY, 'CANCEL_SCHEDULED'],
      [{}, STARTER_MONTHLY, 'UNCHANGED'],
      [{}, CREDITS, 'NOT_A_SUBSCRIPTION'],
      [{ metadata: {} }, PRO_MONTHLY, 'MISCONFIGURED'],
    ] as const)('refuses %o → %s with %s', async (overrides, target, reason) => {
      const { plans, stripe } = setup(subscription(overrides));
      expect((await refusal(plans.apply('sub_1', target))).reason).toBe(reason);
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('refuses another change while an immediate one waits on its payment', async () => {
      const pending = {
        expires_at: PERIOD_END,
        subscription_items: [{ price: { id: 'price_pm' } }],
      };
      const { plans } = setup(
        subscription({ pending_update: pending } as unknown as Partial<Stripe.Subscription>)
      );
      expect((await refusal(plans.apply('sub_1', STARTER_YEARLY))).reason).toBe('CHANGE_PENDING');
    });

    it('refuses an immediate change a bank debit would pay, naming the method', async () => {
      const { plans } = setup(
        subscription({
          default_payment_method: { id: 'pm_sepa', type: 'sepa_debit' },
        } as unknown as Partial<Stripe.Subscription>)
      );
      const error = await refusal(plans.preview('sub_1', PRO_MONTHLY));
      expect(error.reason).toBe('REQUIRES_INSTANT_METHOD');
      expect(error.paymentMethodType).toBe('sepa_debit');
    });
  });

  describe('timing', () => {
    it("follows Apple's rules by default: only an upgrade applies now", async () => {
      const { plans, stripe } = setup();
      expect((await plans.apply('sub_1', PRO_MONTHLY)).effect).toBe('immediate');
      expect((await plans.apply('sub_1', STARTER_YEARLY)).effect).toBe('scheduled');
      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    });

    it('applies a longer period now when the app says so', async () => {
      const { plans } = setup(subscription(), { longer: 'immediate' });
      expect((await plans.apply('sub_1', STARTER_YEARLY)).effect).toBe('immediate');
    });
  });

  describe('an immediate change', () => {
    it('restarts the period, sets the product and keys the update by its intent', async () => {
      const { plans, stripe, sync } = setup();
      await plans.apply('sub_1', PRO_MONTHLY);
      expect(stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_1',
        {
          items: [{ id: 'si_1', price: 'price_pm' }],
          proration_behavior: 'always_invoice',
          billing_cycle_anchor: { type: 'now' },
          metadata: { [METADATA_KEYS.USER_ID]: 'u1', [METADATA_KEYS.PRODUCT_ID]: PRO_MONTHLY },
          payment_behavior: 'pending_if_incomplete',
        },
        {
          idempotencyKey: `plan:sub_1:${STARTER_MONTHLY}:${PRO_MONTHLY}:${PERIOD_START}:in_latest:pm_card`,
        }
      );
      expect(sync).toHaveBeenCalledWith('sub_1');
    });

    it('keeps the period with immediateBilling: keep_period', async () => {
      const stripe = fakeStripe(subscription());
      const plans = createPlanChange({
        stripe: stripe as unknown as Stripe,
        config,
        sync: async () => {},
        immediateBilling: 'keep_period',
      });
      await plans.apply('sub_1', PRO_MONTHLY);
      const [, params] = stripe.subscriptions.update.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ];
      expect(params).not.toHaveProperty('billing_cycle_anchor');
    });

    it('releases a parked period-end change first, under a key of its own', async () => {
      const { plans, stripe } = setup(subscription({ schedule: 'sub_sched_1' }));
      await plans.apply('sub_1', PRO_MONTHLY);
      expect(stripe.subscriptionSchedules.release).toHaveBeenCalledWith(
        'sub_sched_1',
        {},
        { idempotencyKey: 'release:sub_sched_1' }
      );
    });

    function parked(intent: Record<string, unknown>) {
      const setupResult = setup();
      setupResult.stripe.subscriptions.update.mockResolvedValue({
        ...subscription(),
        pending_update: { expires_at: PERIOD_END },
        latest_invoice: 'in_pending',
      });
      setupResult.stripe.invoices.retrieve.mockResolvedValue({
        status: 'open',
        payments: {
          data: [{ payment: { payment_intent: { client_secret: 'pi_secret', ...intent } } }],
        },
      });
      return setupResult;
    }

    it('hands back the client secret when the card needs 3DS', async () => {
      const { plans, stripe } = parked({ status: 'requires_action' });
      expect(await plans.apply('sub_1', PRO_MONTHLY)).toMatchObject({
        effect: 'requires_action',
        clientSecret: 'pi_secret',
      });
      expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled();
    });

    it('voids the parked update and reports the decline when the card is refused', async () => {
      const { plans, stripe } = parked({
        status: 'requires_payment_method',
        last_payment_error: { decline_code: 'insufficient_funds', message: 'Insufficient funds' },
      });
      const error = await refusal(plans.apply('sub_1', PRO_MONTHLY));
      expect(error.reason).toBe('DECLINED');
      expect(error.decline).toEqual({
        reason: 'INSUFFICIENT_FUNDS',
        code: 'insufficient_funds',
        message: 'Insufficient funds',
      });
      expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_pending');
    });

    it('turns a card error raised by the update itself into a decline', async () => {
      const { plans, stripe, sync } = setup();
      stripe.subscriptions.update.mockRejectedValue(
        Object.assign(new Error('Your card has expired.'), {
          type: 'StripeCardError',
          code: 'expired_card',
        })
      );
      const error = await refusal(plans.apply('sub_1', PRO_MONTHLY));
      expect(error.decline?.reason).toBe('CARD_EXPIRED');
      expect(sync).toHaveBeenCalledWith('sub_1');
    });

    it('reports a reused key with other parameters as a conflict', async () => {
      const { plans, stripe } = setup();
      stripe.subscriptions.update.mockRejectedValue(
        Object.assign(new Error('Keys for idempotent requests...'), {
          type: 'StripeIdempotencyError',
        })
      );
      expect((await refusal(plans.apply('sub_1', PRO_MONTHLY))).reason).toBe('CONFLICT');
    });
  });

  describe('a period-end change', () => {
    it('parks the new price in a two-phase schedule lasting one interval of that price', async () => {
      const sub = subscription({
        discounts: ['di_1'],
        metadata: { [METADATA_KEYS.PRODUCT_ID]: PRO_MONTHLY },
        items: {
          data: [
            {
              id: 'si_1',
              quantity: 1,
              price: { id: 'price_pm' },
              current_period_start: PERIOD_START,
              current_period_end: PERIOD_END,
            },
          ],
        },
      } as unknown as Partial<Stripe.Subscription>);
      const { plans, stripe, sync } = setup(sub);
      expect(await plans.apply('sub_1', STARTER_YEARLY)).toEqual({
        effect: 'scheduled',
        effectiveAt: new Date(PERIOD_END * 1000).toISOString(),
        clientSecret: null,
      });
      expect(stripe.subscriptionSchedules.update).toHaveBeenCalledWith('sub_sched_1', {
        end_behavior: 'release',
        phases: [
          {
            start_date: PERIOD_START,
            end_date: PERIOD_END,
            items: [{ price: 'price_pm', quantity: 1 }],
            metadata: { [METADATA_KEYS.PRODUCT_ID]: PRO_MONTHLY },
            discounts: [{ discount: 'di_1' }],
            proration_behavior: 'none',
          },
          {
            items: [{ price: 'price_sy', quantity: 1 }],
            duration: { interval: 'year', interval_count: 1 },
            metadata: { [METADATA_KEYS.PRODUCT_ID]: STARTER_YEARLY },
            discounts: [{ discount: 'di_1' }],
            proration_behavior: 'none',
          },
        ],
      });
      expect(sync).toHaveBeenCalledWith('sub_1');
    });
  });

  describe('the scheduled change', () => {
    const scheduled = (status = 'active') =>
      subscription({
        schedule: {
          id: 'sub_sched_1',
          status,
          current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
          phases: [
            { start_date: PERIOD_START, end_date: PERIOD_END, metadata: {} },
            {
              start_date: PERIOD_END,
              end_date: PERIOD_END + 365 * 24 * 3600,
              items: [{ price: 'price_sy' }],
              metadata: { [METADATA_KEYS.PRODUCT_ID]: STARTER_YEARLY },
            },
          ],
        },
      } as unknown as Partial<Stripe.Subscription>);

    it('is read from the next phase of an active schedule', async () => {
      const { plans } = setup();
      expect(await plans.readScheduled(scheduled())).toEqual({
        productId: STARTER_YEARLY,
        plan: 'STARTER',
        billingPeriod: 'YEARLY',
        price: { amount: 80, currency: 'usd' },
        effectiveAt: new Date(PERIOD_END * 1000).toISOString(),
      });
      expect(await plans.readScheduled(scheduled('released'))).toBeNull();
      expect(await plans.readScheduled(subscription())).toBeNull();
    });

    it('is dropped by releasing the schedule, and nothing pending is fine', async () => {
      const { plans, stripe, sync } = setup(scheduled());
      await plans.cancelScheduled('sub_1');
      expect(stripe.subscriptionSchedules.release).toHaveBeenCalledWith('sub_sched_1');
      expect(sync).toHaveBeenCalledWith('sub_1');

      const idle = setup();
      await idle.plans.cancelScheduled('sub_1');
      expect(idle.stripe.subscriptionSchedules.release).not.toHaveBeenCalled();
    });
  });

  describe('preview', () => {
    it('shows an upgrade as the new plan minus the unused time', async () => {
      const { plans, stripe } = setup();
      stripe.invoices.createPreview.mockResolvedValue({
        currency: 'usd',
        amount_due: 1600,
        starting_balance: 0,
        period_end: PERIOD_START,
        lines: {
          data: [
            {
              amount: -400,
              period: { end: PERIOD_END },
              parent: { subscription_item_details: { proration: true } },
            },
            { amount: 2000, period: { end: PERIOD_END }, parent: null },
          ],
        },
      });
      const preview = await plans.preview('sub_1', PRO_MONTHLY);
      expect(preview).toMatchObject({
        comparison: 'upgrade',
        effect: 'immediate',
        current: { productId: STARTER_MONTHLY, price: { amount: 8 }, credits: 100 },
        target: { productId: PRO_MONTHLY, price: { amount: 20 }, credits: 500 },
        charge: { newPlan: 20, creditBack: 4, dueToday: 16, balanceApplied: 0, accountCredit: 0 },
      });
    });

    it('shows a period-end change as nothing due today', async () => {
      const { plans, stripe } = setup();
      expect(await plans.preview('sub_1', STARTER_YEARLY)).toMatchObject({
        comparison: 'longer',
        effect: 'scheduled',
        charge: null,
      });
      expect(stripe.invoices.createPreview).not.toHaveBeenCalled();
    });
  });
});
