import { fetch } from '@shware/utils';
import { v7 as uuidv7 } from 'uuid';
import { keys } from '../constants/storage';
import type { UpdateVisitorDTO } from '../schema/index';
import { cache, config } from '../setup/index';
import type { Visitor } from './types';

/**
 * This visitor's id: generated here on the first visit (uuidv7) and kept in `config.storage`, so
 * it exists the moment the page loads. The first events, and the beacon of a visit left within a
 * second, go out without waiting for a round trip; the server creates the visitor from whichever
 * request naming it lands first — an events batch or the PATCH of `getVisitor`. An id a server
 * issued to an older client is kept as it is: the visitor continues.
 *
 * Needs a server that creates visitors from those requests (see the README, "Visitors"); one that
 * still only creates them on `POST /visitors` rejects the events of a new visitor.
 */
export function visitorId(): string {
  const stored = config.storage.getItem(keys.visitor_id);
  if (stored && stored !== 'undefined') return stored;
  const id = uuidv7();
  config.storage.setItem(keys.visitor_id, id);
  return id;
}

/**
 * What the server needs to create the visitor when this request is the first to name it; a
 * visitor it already has keeps its own. Optional in the schema, so an older server ignores them.
 */
async function creationFields(): Promise<
  Pick<UpdateVisitorDTO, 'device_id' | 'platform' | 'environment'>
> {
  return {
    device_id: await config.getDeviceId(),
    platform: config.platform,
    environment: config.environment,
  };
}

/**
 * PATCH, not GET: `tags` is the last-touch counterpart to `initial_tags`, and the only thing that
 * ever refreshed it was `setVisitor`, which hosts call when they identify a user. A visitor who
 * never signs in therefore kept the browser, screen, and release captured on their first ever page
 * load — for the rest of their life — leaving `tags` permanently equal to `initial_tags`. The
 * response is the server's view of the visitor, its `distinct_id` above all.
 */
async function syncVisitor(): Promise<Visitor> {
  const id = visitorId();
  const body: UpdateVisitorDTO = { ...(await creationFields()), tags: await config.getTags() };
  const response = await fetch(`${config.endpoint}/visitors/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: await config.getHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Failed to sync visitor: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as Visitor;
}

let visitorFetcher: Promise<Visitor> | null = null;

/**
 * The server's view of this visitor, synced once per page. Events do not wait for it — they only
 * need `visitorId()` — so a slow or failed request costs no event.
 */
export async function getVisitor(): Promise<Visitor> {
  if (cache.visitor) return cache.visitor;
  if (visitorFetcher) return visitorFetcher;
  visitorFetcher = syncVisitor();
  try {
    cache.visitor = await visitorFetcher;
    return cache.visitor;
  } finally {
    // In a `finally`, so a rejected attempt is not left in `visitorFetcher` for every later
    // caller to await again.
    visitorFetcher = null;
  }
}

export async function setVisitor(
  dto: Omit<UpdateVisitorDTO, 'tags' | 'device_id' | 'platform' | 'environment'>
) {
  const id = visitorId();
  const body: UpdateVisitorDTO = {
    ...dto,
    ...(await creationFields()),
    tags: await config.getTags(),
  };
  const response = await fetch(`${config.endpoint}/visitors/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: await config.getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error('Failed to set visitor');
  const data = (await response.json()) as Visitor;

  // Setters get the server's distinct_id — the person the visitor now belongs to — not anything
  // the client could have said about it.
  const identity = { ...body, distinct_id: data.distinct_id ?? null };
  config.thirdPartyUserSetters.forEach((setter) => {
    try {
      setter(identity);
    } catch (e: unknown) {
      // The visitor was updated before this ran, so a third-party setter throwing must not skip
      // the cache write below or reject a call that already succeeded.
      if (e instanceof Error) console.log(e.message);
    }
  });
  cache.visitor = data;
  return data;
}
