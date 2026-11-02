import { v7 as uuidv7, validate, version } from 'uuid';
import { keys } from '../constants/storage';
import { config } from '../setup/index';

/**
 * This visitor's id: generated here on the first visit (uuidv7) and kept in `config.storage`, so
 * it exists the moment the page loads. The first events, and the beacon of a visit left within a
 * second, go out without waiting for a round trip; the server creates the visitor from its first
 * events. A uuidv7 a server issued to an older client is kept as it is: the visitor continues.
 * Anything else stored there is replaced, because the server rejects every batch carrying it:
 * clients before 11.0 kept the int64 id older servers issued, and healed it by recreating the
 * visitor when the server refused it; without that round trip the id would never change.
 *
 * Needs a server that creates visitors from events (see the README, "Visitors"); one that still
 * only creates them on `POST /visitors` rejects the events of a new visitor.
 */
export function visitorId(): string {
  const stored = config.storage.getItem(keys.visitor_id);
  // Also covers the string 'undefined' an old client stored for an unset id. Replacing it below
  // writes the new id back, which clears the bad value from storage for good.
  if (stored && validate(stored) && version(stored) === 7) return stored;
  return newVisitorId();
}

/** Starts a new visitor on this device — `reset()` — and returns its id. */
export function newVisitorId(): string {
  const id = uuidv7();
  config.storage.setItem(keys.visitor_id, id);
  return id;
}
