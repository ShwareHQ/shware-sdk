import { fetch } from '@shware/utils';
import { config } from '../setup/index';
import type { CreateLinkDTO } from '../schema/index';

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

export async function getLink(id: string): Promise<Link | null> {
  try {
    const response = await fetch(`${config.endpoint}/links/${id}`, {
      method: 'GET',
      credentials: 'include',
      headers: await config.getHeaders(),
    });

    if (!response.ok) {
      console.error(`Failed to get link(${id}): ${response.status} ${await response.text()}`);
      return null;
    }
    return response.json() as Promise<Link>;
  } catch {
    console.error(`Failed to get link(${id}): network error`);
    return null;
  }
}
