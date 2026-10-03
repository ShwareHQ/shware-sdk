import { fetch } from '@shware/utils';
import { v7 as uuidv7 } from 'uuid';
import { keys } from '../constants/storage';
import type { UpdateVisitorDTO } from '../schema/index';
import { config } from '../setup/index';
import type { Visitor } from './types';

/**
 * This visitor's id: generated here on the first visit (uuidv7) and kept in `config.storage`, so
 * it exists the moment the page loads. The first events, and the beacon of a visit left within a
 * second, go out without waiting for a round trip; the server creates the visitor from whichever
 * request naming it lands first — an events batch or the PATCH of `syncVisitor`. An id a server
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
 * Refreshes the visitor's `tags` — the last-touch counterpart to `initial_tags` — once per page
 * load: `useWebAnalytics` and `useAppAnalytics` call it on mount. Without it a visitor who never
 * signs in would keep the browser, screen and release of their first ever page load for the rest
 * of their life. Sending events never calls it — they only need `visitorId()` — so a slow or
 * failed request costs no event.
 */
export async function syncVisitor(): Promise<void> {
  const id = visitorId();
  // device_id, platform and environment are what the server creates the visitor with when this
  // PATCH is the first request to name it; a visitor it already has keeps its own.
  const body: UpdateVisitorDTO = {
    device_id: await config.getDeviceId(),
    platform: config.platform,
    environment: config.environment,
    tags: await config.getTags(),
  };
  const response = await fetch(`${config.endpoint}/visitors/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: await config.getHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Failed to sync visitor: ${response.status} ${await response.text()}`);
  }
}

export async function setVisitor(
  dto: Omit<UpdateVisitorDTO, 'tags' | 'device_id' | 'platform' | 'environment'>
) {
  const id = visitorId();
  const body: UpdateVisitorDTO = {
    ...dto,
    device_id: await config.getDeviceId(),
    platform: config.platform,
    environment: config.environment,
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
      // The visitor was updated before this ran, so a third-party setter throwing must not reject
      // a call that already succeeded.
      if (e instanceof Error) console.log(e.message);
    }
  });
  return data;
}
