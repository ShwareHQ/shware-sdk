import { describe, expect, it, vi } from 'vitest';
import { type CheckoutSession, getPurchaseProperties, mapCancellationDetails } from '../mapper';

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
        cancellation_details: { comment: null, feedback: null, reason: null },
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
        cancellation_details: { comment: null, feedback: null, reason: 'payment_failed' },
      })
    ).toMatchObject({ initiator: 'system', reason: 'payment_failed', feedback: null });
  });

  it('reports a feedback value it does not know as "other"', () => {
    expect(
      mapCancellationDetails({
        cancellation_details: {
          comment: null,
          feedback: 'brand_new_value' as never,
          reason: 'cancellation_requested',
        },
      })
    ).toMatchObject({ feedback: 'other' });
  });
});
