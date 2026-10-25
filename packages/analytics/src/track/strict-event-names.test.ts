import { describe, expect, it } from 'vitest';
import { useTrackImpression } from '../hooks/use-track-impression';
import { sendBeacon, track, trackAsync } from './index';
import { trackOnce } from './once';

/**
 * `AnalyticsOptions['strict']` left off, as it is for this package's own compilation:
 * every entry point keeps taking any event name, exactly as before the switch existed. The
 * switch turned on is checked in `strict-event-names/`, a program of its own — a declaration
 * merge is global to its program, so it cannot be turned on for one file of this one.
 *
 * Type-level: `tsc --noEmit` is what fails if an undeclared name stops compiling here. The calls
 * sit in a function that is never called, so nothing is sent; it is named like a hook because
 * one of the calls is one.
 */
describe('strict off (the default)', () => {
  it('accepts an event nobody declared, with open properties', () => {
    const useCalls = () => {
      track('anything', { anything: 'goes', count: 1 });
      track('purchse');
      track('begin_checkout ');
      trackOnce('anything', { a: 1 }, { key: 'k' });
      void trackAsync('anything', { a: true });
      sendBeacon('anything', { a: null });
      useTrackImpression('anything', { a: 'b' });
    };
    expect(useCalls).toBeTypeOf('function');
  });

  it('keeps checking the properties of a standard event', () => {
    const calls = () => {
      // @ts-expect-error `transaction_id` is required on purchase.
      track('purchase', { currency: 'USD', value: 129 });
    };
    expect(calls).toBeTypeOf('function');
  });
});
