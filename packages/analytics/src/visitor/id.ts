import { v7 as uuidv7 } from 'uuid';
import { keys } from '../constants/storage';
import { config } from '../setup/index';

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
