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
 * one too.
 *
 * `undefined` until this page identifies anyone; `null` once it has signed out (`reset()`), so the
 * same user signing back in is identified again, and a later `reset()` here knows it has nothing
 * left to sign out — the device's identity, if any, is someone this page has not identified.
 */
let identified: string | null | undefined;

/** Hands the user to every integration's user setter; one that throws does not stop the others. */
function setUsers(user: Parameters<ThirdPartyUserSetter>[0]) {
  config.integrations.forEach(({ setUser }) => {
    try {
      setUser?.(user);
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
    if (previous && previous !== userId) {
      // Another user is on the device: start over whatever this page last identified.
      startOver();
      setUsers({});
    }
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
 * Only the sign-out this page knows of: the session and visitor are replaced while the device's
 * identity (`keys.user_id` and the visitor, shared by every tab) is still the one this page last
 * identified, or the page has neither identified nor signed out anyone (a host that identifies at
 * sign-in only, on a page loaded since). Every tab of a site sees a sign-out and calls this,
 * some of them late — a tab frozen in the background handles it on resuming, after another tab
 * may have signed out and in again. A call that finds no user, or someone else's binding, is
 * stale: replacing that would cut the new anonymous visitor off from the next sign-in, or end the
 * next user's session and leave their pages on a visitor nobody identified. It only clears this
 * page: its setters are still told, since GA holds the user per page.
 *
 * Synchronous and never throws: sign-out must not fail on analytics.
 */
export function reset() {
  let current = false;
  try {
    const user = config.storage.getItem(keys.user_id);
    current = !!user && (identified === undefined || identified === `${visitorId()}:${user}`);
    if (current) startOver();
  } catch (e: unknown) {
    if (e instanceof Error) console.log(e.message);
  }
  if (current || identified) setUsers({});
  identified = null;
}

/**
 * Ends the device's session and starts a new visitor with no user: `reset()` for the sign-out it
 * knows of, `identify` for a user signing in over another.
 */
function startOver() {
  endSession();
  newVisitorId();
  config.storage.setItem(keys.user_id, '');
}
