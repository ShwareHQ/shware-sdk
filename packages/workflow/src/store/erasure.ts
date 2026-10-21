/** Where a user stands with erasure: see `JourneyStore.erasureState`. */
export type ErasureState = 'none' | 'erasing' | 'erased';

/**
 * The user has an erasure tombstone — requested and under way, or carried out — so nothing may
 * be written about them: a write that got through would come back after the erase, or bring an
 * erased user back. Thrown by the store from the conditional write itself (the gate), and by the
 * entry points that check first for a fast answer; the HTTP surface answers 410.
 */
export class UserErasedError extends Error {
  override readonly name = 'UserErasedError';
  constructor(readonly userId: string) {
    super(`user ${userId} is erased`);
  }
}
