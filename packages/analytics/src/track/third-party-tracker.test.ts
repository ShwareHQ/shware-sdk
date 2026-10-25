import { describe, expectTypeOf, it } from 'vitest';
import type { EventName, ThirdPartyTracker, TrackName, TrackProperties } from './types';

describe('ThirdPartyTracker', () => {
  it('accepts a sync tracker, one that reports "not ready", and an async one', () => {
    const sync = <T extends EventName>(_name: TrackName<T>, _properties?: TrackProperties<T>) => {};
    const notReady = <T extends EventName>(_name: TrackName<T>) => false as boolean;
    // `sendFirebaseEvent` and any tracker awaiting a native module: its promise is a handled call.
    const asyncTracker = async <T extends EventName>(_name: TrackName<T>) => {};

    expectTypeOf(sync).toExtend<ThirdPartyTracker>();
    expectTypeOf(notReady).toExtend<ThirdPartyTracker>();
    expectTypeOf(asyncTracker).toExtend<ThirdPartyTracker>();
  });
});
