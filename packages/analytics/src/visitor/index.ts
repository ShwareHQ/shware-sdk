import { keys } from '../constants/storage';
import { config } from '../setup/index';
import { endSession, track } from '../track/index';
import type { UserProvidedData } from '../track/types';
import { newVisitorId } from './id';
import type { VisitorIdentity } from './types';

export { visitorId } from './id';

/**
 * The event that binds the visitor to the user who signed in on it: the server sets the visitor's
 * `user_id` and `distinct_id` from its `user_id` property, in the transaction that stores the
 * batch — which also creates the visitor when it is new, so the binding can never arrive before it.
 */
export const IDENTIFY_EVENT = 'identify';

/**
 * The user this page has identified the visitor as: identify once per user per page, not per call.
 * Cleared by `reset()`, so the same user signing back in is identified again.
 */
let identified: string | undefined;

/** Hands the identity to every third-party user setter; one that throws does not stop the others. */
function setUsers(identity: VisitorIdentity) {
  config.thirdPartyUserSetters.forEach((setter) => {
    try {
      setter(identity);
    } catch (e: unknown) {
      if (e instanceof Error) console.log(e.message);
    }
  });
}

/**
 * Hands the signed-in user to the analytics: the third-party user setters (gtag, the pixels) now,
 * and the server through an `identify` event, sent when the user differs from the one this page
 * last identified — a host calls this on every page load once someone is signed in. Like any
 * event it goes with the next batch or the page-hide beacon; `userData` is handed to the setters
 * only, never stored with the event.
 *
 * The visitor's sessions so far — those before the sign-in included — become this user's. So a
 * different user than the one last identified on this device (an expired session, a sign-out the
 * host never reported) is `reset()` first: the previous user's visitor stays theirs, and this one
 * starts on a new visitor.
 *
 * Synchronous and never throws: sign-in must not fail on analytics.
 */
export function identify(userId: string, userData?: UserProvidedData) {
  try {
    const previous = config.storage.getItem(keys.user_id);
    if (previous && previous !== userId) reset();
    config.storage.setItem(keys.user_id, userId);
  } catch (e: unknown) {
    if (e instanceof Error) console.log(e.message);
  }

  if (userId !== identified) {
    identified = userId;
    track(IDENTIFY_EVENT, { user_id: userId }, { enableThirdPartyTracking: false });
  }

  // Once bound, the server's person key for the visitor is the user's id, so the setters are told
  // that rather than waiting for the server to say it.
  setUsers({ user_id: userId, user_data: userData, distinct_id: userId });
}

/**
 * Signs the visitor out, as PostHog's `reset()` does: call it on sign-out, after
 * `track('logout')`, so that event still belongs to the user leaving.
 *
 * - The current session ends: what it accrued goes out as a `user_engagement`
 *   (`trigger: 'reset'`), as when the page is closed, and the queue is sent under the visitor
 *   and session its events happened in.
 * - A new visitor starts, and the next event opens a new session on it. Everything until the next
 *   sign-in is anonymous, and becomes whoever's signs in next; the visitor that is left stays the
 *   previous user's, with its history.
 * - The third-party setters drop the user (PostHog resets its identity, GA clears its user_id).
 *
 * The device id and the first visit or first open stay: they describe the device, not the person.
 *
 * Synchronous and never throws: sign-out must not fail on analytics.
 */
export function reset() {
  try {
    endSession();
    newVisitorId();
    config.storage.setItem(keys.user_id, '');
  } catch (e: unknown) {
    if (e instanceof Error) console.log(e.message);
  }
  identified = undefined;
  setUsers({ distinct_id: null });
}
