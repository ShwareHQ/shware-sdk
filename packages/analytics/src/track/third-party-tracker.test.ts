import { describe, expectTypeOf, it } from 'vitest';
import type { EventName, ThirdPartyTracker, TrackName, TrackProperties } from './types';

describe('ThirdPartyTracker', () => {
  it('accepts a sync tracker and one that reports "not ready"', () => {
    const sync = <T extends EventName>(_name: TrackName<T>, _properties?: TrackProperties<T>) => {};
    const notReady = <T extends EventName>(_name: TrackName<T>) => false as boolean;
    expectTypeOf(sync).toExtend<ThirdPartyTracker>();
    expectTypeOf(notReady).toExtend<ThirdPartyTracker>();
  });

  it("is satisfied by the SDK's own sendFirebaseEvent", () => {
    // Type-only: importing the module would load the native Firebase binding.
    expectTypeOf<
      typeof import('../native/firebase').sendFirebaseEvent
    >().toExtend<ThirdPartyTracker>();
  });

  it('rejects an async tracker, whose promise could not report "not ready"', () => {
    const asyncTracker = async <T extends EventName>(_name: TrackName<T>) => {};
    expectTypeOf(asyncTracker).not.toExtend<ThirdPartyTracker>();
  });
});
