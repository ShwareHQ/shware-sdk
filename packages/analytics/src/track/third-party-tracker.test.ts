import { describe, expectTypeOf, it } from 'vitest';
// Type-only: importing the module for real would load the native Firebase binding.
import type { sendFBEvent } from '../native/fbsdk';
import type { sendFirebaseEvent } from '../native/firebase';
import type { EventName, ThirdPartyTracker, TrackName, TrackProperties } from './types';

describe('ThirdPartyTracker', () => {
  it('accepts a sync tracker and one that reports "not ready"', () => {
    const sync = <T extends EventName>(_name: TrackName<T>, _properties?: TrackProperties<T>) => {};
    const notReady = <T extends EventName>(_name: TrackName<T>) => false as boolean;
    expectTypeOf(sync).toExtend<ThirdPartyTracker>();
    expectTypeOf(notReady).toExtend<ThirdPartyTracker>();
  });

  it("is satisfied by the SDK's own native trackers", () => {
    expectTypeOf<typeof sendFirebaseEvent>().toExtend<ThirdPartyTracker>();
    expectTypeOf<typeof sendFBEvent>().toExtend<ThirdPartyTracker>();
  });

  it('rejects an async tracker, whose promise could not report "not ready"', () => {
    const asyncTracker = async <T extends EventName>(_name: TrackName<T>) => {};
    expectTypeOf(asyncTracker).not.toExtend<ThirdPartyTracker>();
  });
});
