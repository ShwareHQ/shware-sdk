import type { Stripe } from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  type CheckoutSession,
  getPurchaseProperties,
  mapCancellationDetails,
  mapCharge,
  mapDisputeStatus,
  mapPaymentType,
  mapRefundStatus,
  mapTime,
  money,
  price,
} from '../mapper';

function session(id: string): CheckoutSession {
  return {
    id,
    url: null,
    coupon: undefined,
    livemode: true,
    expires_at: 0,
    payment_status: 'paid',
    currency: 'usd',
    amount_total: 1999,
    line_items: undefined,
  };
}

describe('getPurchaseProperties transaction_id', () => {
  it('strips the cs_live_/cs_test_ prefix so the id fits the Google Ads 64-char cap', () => {
    const suffix = 'a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u';
    expect(getPurchaseProperties(session(`cs_live_${suffix}`)).transaction_id).toBe(suffix);
    expect(getPurchaseProperties(session(`cs_test_${suffix}`)).transaction_id).toBe(suffix);
    expect(suffix.length).toBeLessThanOrEqual(64);
  });

  it('keeps legacy short ids intact', () => {
    expect(getPurchaseProperties(session('cs_live_HbxLGWaiuKtHDidmQGnPOh3q')).transaction_id).toBe(
      'HbxLGWaiuKtHDidmQGnPOh3q'
    );
  });

  it('warns and clamps to 64 chars if Stripe lengthens ids again', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { transaction_id } = getPurchaseProperties(session(`cs_live_${'a'.repeat(100)}`));
    expect(transaction_id).toHaveLength(64);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('is deterministic so GA4/Google Ads dedup keeps working', () => {
    const id = 'cs_live_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u';
    expect(getPurchaseProperties(session(id)).transaction_id).toBe(
      getPurchaseProperties(session(id)).transaction_id
    );
  });

  it('carries the customer_type the host set on the session, and nothing when it set none', () => {
    expect(
      getPurchaseProperties({ ...session('cs_live_x'), customer_type: 'new' }).customer_type
    ).toBe('new');
    expect(getPurchaseProperties(session('cs_live_x')).customer_type).toBeUndefined();
  });

  it('leaves value and currency untouched', () => {
    const properties = getPurchaseProperties(session('cs_live_HbxLGWaiuKtHDidmQGnPOh3q'));
    expect(properties.value).toBe(19.99);
    expect(properties.currency).toBe('USD');
  });
});

describe('mapCancellationDetails', () => {
  it('is null for the all-null details every live subscription carries', () => {
    expect(
      mapCancellationDetails({
        cancellation_details: {
          comment: null,
          feedback: null,
          feedback_option: null,
          reason: null,
        },
      })
    ).toBeNull();
    expect(mapCancellationDetails({ cancellation_details: null })).toBeNull();
  });

  it('keeps the customer answers and says who acted', () => {
    expect(
      mapCancellationDetails({
        cancellation_details: {
          comment: 'Too pricey for me',
          feedback: 'too_expensive',
          feedback_option: null,
          reason: 'cancellation_requested',
        },
      })
    ).toEqual({
      initiator: 'user',
      reason: 'cancellation_requested',
      feedback: 'too_expensive',
      comment: 'Too pricey for me',
    });
    expect(
      mapCancellationDetails({
        cancellation_details: {
          comment: null,
          feedback: null,
          feedback_option: null,
          reason: 'payment_failed',
        },
      })
    ).toMatchObject({ initiator: 'system', reason: 'payment_failed', feedback: null });
  });

  it('reports a feedback value it does not know as "other"', () => {
    expect(
      mapCancellationDetails({
        cancellation_details: {
          comment: null,
          feedback: 'brand_new_value' as never,
          feedback_option: null,
          reason: 'cancellation_requested',
        },
      })
    ).toMatchObject({ feedback: 'other' });
  });
});

describe('price', () => {
  it('divides by the currency minor unit', () => {
    expect(price(1999, 'usd')).toBe(19.99);
    expect(price(500, 'jpy')).toBe(500);
    expect(price(5120, 'kwd')).toBe(5.12);
  });
});

describe('money', () => {
  it('pairs the converted amount with its currency', () => {
    expect(money(1999, 'usd')).toEqual({ amount: 19.99, currency: 'usd' });
    expect(money(500, 'jpy')).toEqual({ amount: 500, currency: 'jpy' });
  });
});

describe('mapPaymentType', () => {
  it.each([
    ['subscription_create', 'SUBSCRIPTION_START'],
    ['subscription_cycle', 'SUBSCRIPTION_RENEWAL'],
    ['subscription_update', 'SUBSCRIPTION_UPDATE'],
    ['manual', 'SUBSCRIPTION_UPDATE'],
    ['subscription_threshold', 'SUBSCRIPTION_UPDATE'],
    [null, 'SUBSCRIPTION_UPDATE'],
  ] as const)('maps billing_reason %s to %s', (reason, type) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapPaymentType({ id: 'in_1', billing_reason: reason })).toBe(type);
    warn.mockRestore();
  });
});

describe('mapRefundStatus', () => {
  it.each([
    ['pending', 'PENDING'],
    ['requires_action', 'PENDING'],
    [null, 'PENDING'],
    ['succeeded', 'SUCCEEDED'],
    ['failed', 'FAILED'],
    ['canceled', 'CANCELED'],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(mapRefundStatus({ id: 're_1', status })).toBe(expected);
  });

  it('throws on a status Stripe does not document', () => {
    expect(() => mapRefundStatus({ id: 're_1', status: 'mystery' })).toThrow(
      'Unknown refund status mystery: re_1'
    );
  });
});

describe('mapDisputeStatus', () => {
  it('upper-cases every Stripe dispute status', () => {
    expect(mapDisputeStatus({ id: 'dp_1', status: 'warning_needs_response' })).toBe(
      'WARNING_NEEDS_RESPONSE'
    );
    expect(mapDisputeStatus({ id: 'dp_1', status: 'lost' })).toBe('LOST');
  });

  it('throws on a status it does not know', () => {
    expect(() => mapDisputeStatus({ id: 'dp_1', status: 'mystery' })).toThrow(
      'Unknown dispute status mystery: dp_1'
    );
  });
});

describe('mapTime', () => {
  it('maps seconds to an ISO string', () => {
    expect(mapTime(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z');
  });

  it('maps 0 to the epoch instead of treating it as missing', () => {
    expect(mapTime(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it.each([null, undefined])('maps %s to null', (value) => {
    expect(mapTime(value)).toBeNull();
  });
});

describe('mapCharge', () => {
  it('keeps the receipt fields and maps an expanded payment intent', () => {
    const charge = {
      id: 'ch_1',
      description: 'Pro',
      currency: 'usd',
      amount: 1999,
      amount_captured: 1999,
      amount_refunded: 0,
      receipt_email: 'a@b.c',
      receipt_number: null,
      receipt_url: 'https://pay.stripe.com/receipts/x',
      status: 'succeeded',
      created: 1,
      payment_intent: { id: 'pi_1', amount: 1999, status: 'succeeded', created: 1 },
    } as unknown as Stripe.Charge;
    const mapped = mapCharge(charge);
    expect(mapped).toMatchObject({ id: 'ch_1', status: 'succeeded', receipt_number: null });
    expect(mapped.payment_intent).toMatchObject({ id: 'pi_1', status: 'succeeded' });
    expect(mapCharge({ ...charge, payment_intent: 'pi_1' }).payment_intent).toBeUndefined();
  });
});
