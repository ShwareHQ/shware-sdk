import { keys } from '../constants/storage';
import { config } from '../setup/index';
import { endSession, track } from '../track/index';
import type { UserProvidedData } from '../track/types';
import { newVisitorId, visitorId } from './id';
import type { ThirdPartyUserSetter } from './types';

export { visitorId } from './id';

/**
 * The event that binds the visitor to the user who signed in on it: the server sets the visitor's
 * `user_id` and `distinct_id` from its `user_id` property, in the transaction that stores the
 * batch — which also creates the visitor when it is new, so the binding can never arrive before it.
 */
export const IDENTIFY_EVENT = 'identify';

/**
 * The visitor and user this page last identified, as `<visitor>:<user>`: identify once per binding
 * per page, not per call. The visitor is part of it because the storage is shared: another tab's
 * `reset()` replaces the visitor under this page, and the same user here must then bind the new
 * one too. Cleared by `reset()`, so the same user signing back in is identified again.
 */
let identified: string | undefined;

/** Hands the user to every third-party user setter; one that throws does not stop the others. */
function setUsers(user: Parameters<ThirdPartyUserSetter>[0]) {
  config.thirdPartyUserSetters.forEach((setter) => {
    try {
      setter(user);
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
  let visitor = '';
  try {
    const previous = config.storage.getItem(keys.user_id);
    if (previous && previous !== userId) reset();
    config.storage.setItem(keys.user_id, userId);
    visitor = visitorId();
  } catch (e: unknown) {
    if (e instanceof Error) console.log(e.message);
  }

  const binding = `${visitor}:${userId}`;
  if (binding !== identified) {
    identified = binding;
    track(IDENTIFY_EVENT, { user_id: userId }, { enableThirdPartyTracking: false });
  }

  setUsers({ user_id: userId, user_data: userData });
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
 * Once per sign-out, however many times it is called: the session and visitor are only replaced
 * while a user is identified on the device (`keys.user_id`, which `identify` writes on every page
 * load and this clears). Every tab of a site sees the sign-out and calls this, and the storage is
 * shared: a second call would cut the anonymous visitor the first one started off from the next
 * sign-in, and end its session early. A page that identified someone still has its setters told,
 * since GA holds the user per page.
 *
 * Synchronous and never throws: sign-out must not fail on analytics.
 */
export function reset() {
  let signedIn = false;
  try {
    signedIn = !!config.storage.getItem(keys.user_id);
    if (signedIn) {
      endSession();
      newVisitorId();
      config.storage.setItem(keys.user_id, '');
    }
  } catch (e: unknown) {
    if (e instanceof Error) console.log(e.message);
  }
  if (signedIn || identified) setUsers({});
  identified = undefined;
}
