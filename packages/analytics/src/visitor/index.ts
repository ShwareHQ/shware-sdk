import type { UpdateVisitorDTO } from '../schema/index';
import { config } from '../setup/index';
import { track } from '../track/index';

export { visitorId } from './id';

/**
 * The event that binds the visitor to the user who signed in on it: the server sets the visitor's
 * `user_id` and `distinct_id` from its `user_id` property, in the transaction that stores the
 * batch — which also creates the visitor when it is new, so the binding can never arrive before it.
 */
export const IDENTIFY_EVENT = 'identify';

/** The user this page has identified the visitor as: identify once per user, not per call. */
let identified: string | undefined;

/**
 * Hands the signed-in user to the analytics: the third-party user setters (gtag, the pixels) now,
 * and the server through an `identify` event, sent when the user differs from the one this page
 * last identified — a host calls this on every page load once someone is signed in. Like any
 * event it goes with the next batch or the page-hide beacon; `user_data` is handed to the setters
 * only, never stored with the event.
 *
 * Synchronous and never throws: sign-in must not fail on analytics.
 */
export function setVisitor(dto: Omit<UpdateVisitorDTO, 'tags'>) {
  if (dto.user_id && dto.user_id !== identified) {
    identified = dto.user_id;
    track(IDENTIFY_EVENT, { user_id: dto.user_id }, { enableThirdPartyTracking: false });
  }

  // Once bound, the server's person key for the visitor is the user's id, so the setters are told
  // that rather than waiting for the server to say it.
  const identity = { ...dto, distinct_id: dto.user_id ?? null };
  config.thirdPartyUserSetters.forEach((setter) => {
    try {
      setter(identity);
    } catch (e: unknown) {
      // One third-party script does not get to stop the others.
      if (e instanceof Error) console.log(e.message);
    }
  });
}
