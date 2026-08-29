import { describe, expect, it } from 'vitest';
import { propertiesSchema } from '../schema/index';
import type { TrackProperties } from './types';

/**
 * `CustomEventProperties` lets an application add its own properties to GA4's standard
 * events — which are otherwise closed shapes — and give its own events a real type.
 *
 * The change is entirely type-level, so most of what is worth checking is checked by
 * `tsc --noEmit` rather than at runtime: the assignments below fail the build if the merge
 * stops working, and each `@ts-expect-error` fails it if the rejection stops happening.
 *
 * The augmentation is global to this package's compilation, which is why the events used
 * here only ever gain optional properties — nothing else in the package can be broken by
 * that.
 */
declare module './types' {
  interface CustomEventProperties {
    begin_checkout: { type?: 'new_purchase' | 'upgrade' };
    plan_changed: { direction: 'upgrade' | 'downgrade'; effective_at: string };
  }
}

describe('CustomEventProperties', () => {
  it('adds declared properties to a standard event without losing its own', () => {
    const params: TrackProperties<'begin_checkout'> = {
      currency: 'USD',
      value: 129,
      items: [{ item_id: 'plan', item_name: 'Premium' }],
      type: 'upgrade',
    };
    expect(params.type).toBe('upgrade');
  });

  it('still type-checks the standard properties it did before', () => {
    const params: TrackProperties<'begin_checkout'> = {
      // @ts-expect-error `currency` is a string, and the standard shape still governs it.
      currency: 129,
      value: 129,
      items: [],
    };
    expect(params.value).toBe(129);
  });

  it('rejects a value outside the declared union', () => {
    const params: TrackProperties<'begin_checkout'> = {
      currency: 'USD',
      value: 129,
      items: [],
      // @ts-expect-error only 'new_purchase' and 'upgrade' were declared.
      type: 'renewal',
    };
    expect(params.value).toBe(129);
  });

  it('keeps the property scoped to the events that declared it', () => {
    const params: TrackProperties<'purchase'> = {
      currency: 'USD',
      value: 129,
      transaction_id: 'in_1',
      // @ts-expect-error `type` was declared for begin_checkout, not for purchase.
      type: 'upgrade',
    };
    expect(params.transaction_id).toBe('in_1');
  });

  it('gives a declared custom event its exact shape', () => {
    const params: TrackProperties<'plan_changed'> = {
      direction: 'upgrade',
      effective_at: '2026-09-01T00:00:00.000Z',
    };
    expect(params.direction).toBe('upgrade');
  });

  it('rejects a misspelled property on a declared custom event', () => {
    const params: TrackProperties<'plan_changed'> = {
      direction: 'upgrade',
      effective_at: '2026-09-01T00:00:00.000Z',
      // @ts-expect-error the typo this declaration exists to catch — an undeclared event
      // would have taken it without complaint.
      effectiveAt: '2026-09-01T00:00:00.000Z',
    };
    expect(params.direction).toBe('upgrade');
  });

  /**
   * The intersection in `TrackProperties` is the one thing that could quietly undo every
   * check the standard shapes provide: if `& unknown` widened instead of reducing, a
   * standard event would accept anything and nothing here would look wrong at a glance.
   *
   * Both directives below are load-bearing. Were the shape widened, they would stop matching
   * an error and `tsc` would fail them as unused — which is the failure this test wants.
   */
  it('keeps a standard event fully checked when nothing was declared for it', () => {
    // @ts-expect-error `transaction_id` is required on purchase and stays required.
    const missingRequired: TrackProperties<'purchase'> = { currency: 'USD', value: 129 };

    const wrongValueType: TrackProperties<'purchase'> = {
      currency: 'USD',
      // @ts-expect-error `value` is a number, and the standard shape still says so.
      value: 'free',
      transaction_id: 'in_1',
    };

    expect(missingRequired.currency).toBe('USD');
    expect(wrongValueType.transaction_id).toBe('in_1');
  });

  it('leaves an event nobody declared exactly as open as it was', () => {
    const params: TrackProperties<'some_other_event'> = {
      anything: 'goes',
      count: 1,
    };
    expect(params.anything).toBe('goes');
  });

  /**
   * The types would be theatre if validation dropped the keys on the way out. `takeProperties`
   * keeps arbitrary keys rather than matching them against a whitelist, and this pins that:
   * a schema that started stripping unknown properties would fail here instead of silently
   * shipping events without the dimension.
   */
  it('sends declared properties over the wire', () => {
    const parsed = propertiesSchema.parse({
      currency: 'USD',
      value: 129,
      type: 'upgrade',
    }) as Record<string, unknown>;
    expect(parsed.type).toBe('upgrade');
  });
});
