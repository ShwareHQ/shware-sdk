import { fetch } from '@shware/utils';
import { v7 as uuidv7 } from 'uuid';
import { keys } from '../constants/storage';
import type { UpdateVisitorDTO } from '../schema/index';
import { config } from '../setup/index';
import type { Visitor } from './types';

/**
 * This visitor's id: generated here on the first visit (uuidv7) and kept in `config.storage`, so
 * it exists the moment the page loads. The first events, and the beacon of a visit left within a
 * second, go out without waiting for a round trip; the server creates the visitor from its first
 * events. An id a server issued to an older client is kept as it is: the visitor continues.
 *
 * Needs a server that creates visitors from events (see the README, "Visitors"); one that still
 * only creates them on `POST /visitors` rejects the events of a new visitor.
 */
export function visitorId(): string {
  const stored = config.storage.getItem(keys.visitor_id);
  if (stored && stored !== 'undefined') return stored;
  const id = uuidv7();
  config.storage.setItem(keys.visitor_id, id);
  return id;
}

export async function setVisitor(dto: Omit<UpdateVisitorDTO, 'tags'>) {
  const id = visitorId();
  const response = await fetch(`${config.endpoint}/visitors/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: await config.getHeaders(),
    // No tags: the server refreshes them from each session_start, where the visit came in. At
    // sign-in the page is the login page, not the touch, and its tags would overwrite the landing's.
    body: JSON.stringify(dto),
  });

  if (!response.ok) throw new Error('Failed to set visitor');
  const data = (await response.json()) as Visitor;

  // Setters get the server's distinct_id — the person the visitor now belongs to — not anything
  // the client could have said about it.
  const identity = { ...dto, distinct_id: data.distinct_id ?? null };
  config.thirdPartyUserSetters.forEach((setter) => {
    try {
      setter(identity);
    } catch (e: unknown) {
      // The visitor was updated before this ran, so a third-party setter throwing must not reject
      // a call that already succeeded.
      if (e instanceof Error) console.log(e.message);
    }
  });
  return data;
}
