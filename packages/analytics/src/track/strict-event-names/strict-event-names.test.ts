import { describe, expect, it } from 'vitest';
import { useTrackImpression } from '../../hooks/use-track-impression';
import { setupConversions } from '../../server/setup-conversions';
import { sendBeacon, track } from '../index';
import { trackOnce } from '../once';
import type { TrackProperties } from '../types';

/**
 * `AnalyticsOptions['strict']` turned on, as an application turns it on: merged next
 * to its `CustomEventProperties`.
 *
 * A declaration merge is global to its program, so this directory is a program of its own
 * (`./tsconfig.json`, excluded from the package's), type-checked by the second `tsc` of
 * `check-types`. Everything else in the package — the loose-mode tests included — compiles
 * with the switch off.
 *
 * Each `@ts-expect-error` is load-bearing: were an undeclared name to compile again, `tsc` would
 * fail it as unused. The calls sit in a function that is never called, so nothing is sent; one
 * that calls the hook is named like a hook.
 */
declare module '../types' {
  interface AnalyticsOptions {
    strict: true;
  }
  interface CustomEventProperties {
    plan_changed: { direction: 'upgrade' | 'downgrade' };
    account_deleted: undefined;
  }
}

describe('strict on', () => {
  it('accepts the standard events and the declared ones', () => {
    const useCalls = () => {
      track('purchase', { currency: 'USD', value: 129, transaction_id: 'in_1' });
      track('logout');
      track('plan_changed', { direction: 'upgrade' });
      track('account_deleted');
      trackOnce('plan_changed', { direction: 'downgrade' }, { key: 'k' });
      sendBeacon('page_view');
      useTrackImpression('view_item', { currency: 'USD', value: 1, items: [] });
      void setupConversions({ destinations: [] }).track({
        id: 'in_1',
        name: 'plan_changed',
        userId: 'u1',
        properties: { direction: 'upgrade' },
        createdAt: '2026-11-01T00:00:00.000Z',
      });
    };
    expect(useCalls).toBeTypeOf('function');
  });

  it('rejects a misspelled standard event', () => {
    const calls = () => {
      // @ts-expect-error not an event: `purchase`, misspelled.
      track('purchse', { currency: 'USD', value: 129, transaction_id: 'in_1' });
    };
    expect(calls).toBeTypeOf('function');
  });

  it('rejects a name with a trailing space', () => {
    const calls = () => {
      // @ts-expect-error `begin_checkout` with a trailing space is another event.
      track('begin_checkout ', { currency: 'USD', value: 129, items: [] });
    };
    expect(calls).toBeTypeOf('function');
  });

  it('rejects an undeclared event at every entry point', () => {
    const useCalls = () => {
      // @ts-expect-error declared nowhere.
      track('some_other_event');
      // @ts-expect-error declared nowhere.
      trackOnce('some_other_event', undefined, { key: 'k' });
      // @ts-expect-error declared nowhere.
      sendBeacon('some_other_event');
      // @ts-expect-error declared nowhere.
      useTrackImpression('some_other_event');
      void setupConversions({ destinations: [] }).track({
        id: 'in_1',
        // @ts-expect-error declared nowhere.
        name: 'some_other_event',
        userId: 'u1',
        createdAt: '2026-11-01T00:00:00.000Z',
      });
    };
    expect(useCalls).toBeTypeOf('function');
  });

  it('still checks the properties of a declared event', () => {
    const calls = () => {
      // @ts-expect-error only 'upgrade' and 'downgrade' were declared.
      track('plan_changed', { direction: 'sideways' });
    };
    expect(calls).toBeTypeOf('function');
  });

  it('drops the open record an undeclared event fell back to', () => {
    // @ts-expect-error nothing is assignable to the properties of an event that cannot be tracked.
    const params: TrackProperties<'some_other_event'> = { anything: 'goes' };
    expect(params).toBeDefined();
  });
});
