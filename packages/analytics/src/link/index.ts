import { fetch } from '@shware/utils';
import type { CreateLinkDTO } from '../schema/index';
import { config } from '../setup/index';

export interface Link extends CreateLinkDTO {
  id: string;
  created_at: string;
}

export async function createLink(dto: CreateLinkDTO) {
  const response = await fetch(`${config.endpoint}/links`, {
    method: 'POST',
    credentials: 'include',
    headers: await config.getHeaders(),
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    throw new Error(`Failed to create link: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<Link>;
}

/**
 * The link a `?s=` id names. `null` when the server says there is none (a 4xx: a mistyped or
 * expired id, or a `?s=` that was never a link id): that answer will not change while the page is
 * open, so callers cache it. A 5xx or a network failure, once the retrying `fetch` gives up, is
 * thrown instead — the link may well exist, so a caller should look it up again later rather than
 * remember "no link".
 */
export async function getLink(id: string): Promise<Link | null> {
  const response = await fetch(`${config.endpoint}/links/${id}`, {
    method: 'GET',
    credentials: 'include',
    headers: await config.getHeaders(),
  });
  if (response.ok) return (await response.json()) as Link;
  const detail = `${response.status} ${await response.text()}`;
  if (response.status >= 400 && response.status < 500) {
    console.error(`No link(${id}): ${detail}`);
    return null;
  }
  throw new Error(`Failed to get link(${id}): ${detail}`);
}
