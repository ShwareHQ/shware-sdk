import type { Session } from './types';

/**
 * The session attribute holding the signed-in principal's name, and the one index the
 * repositories keep (`findByIndexNameAndIndexValue`), so `kick` and `listSessions` can find every
 * session of a user.
 */
export const PRINCIPAL_NAME_INDEX_NAME = 'principalName';

export function principalNameOf(session: Session): string | null {
  const name = session.getAttribute(PRINCIPAL_NAME_INDEX_NAME);
  return name === null ? null : String(name);
}
