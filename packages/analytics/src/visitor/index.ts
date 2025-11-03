import { config } from '../setup/index';
import { fetch } from '../utils/fetch';
import type { CreateVisitorDTO, UpdateVisitorDTO, Visitor, VisitorProperties } from './types';

const key = 'visitor_id';

async function createVisitor(): Promise<Visitor> {
  const dto: CreateVisitorDTO = {
    device_id: await config.getDeviceId(),
    properties: (await config.getTags()) as VisitorProperties,
  };

  const response = await fetch(`${config.endpoint}/visitors`, {
    method: 'POST',
    credentials: 'include',
    headers: await config.getHeaders(),
    body: JSON.stringify(dto),
  });

  const data = (await response.json()) as Visitor;
  await config.storage.setItem(key, data.id);
  return data;
}

async function getOrCreateVisitor(): Promise<Visitor> {
  const visitorId = await config.storage.getItem(key);
  if (visitorId) {
    const response = await fetch(`${config.endpoint}/visitors/${visitorId}`, {
      method: 'GET',
      credentials: 'include',
      headers: await config.getHeaders(),
    });

    if (!response.ok) return createVisitor();
    return response.json() as Promise<Visitor>;
  } else {
    return createVisitor();
  }
}

let visitor: Visitor | null = null;
let visitorFetcher: Promise<Visitor> | null = null;

export async function getVisitor(): Promise<Visitor> {
  if (visitor) return visitor;
  if (visitorFetcher) return visitorFetcher;
  visitorFetcher = getOrCreateVisitor();
  visitor = await visitorFetcher;
  visitorFetcher = null;
  return visitor;
}

export async function setVisitor(dto: UpdateVisitorDTO) {
  const { id } = await getVisitor();
  const response = await fetch(`${config.endpoint}/visitors/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: await config.getHeaders(),
    body: JSON.stringify(dto),
  });

  if (!response.ok) throw new Error('Failed to set visitor');
  const data = (await response.json()) as Visitor;

  config.thirdPartyUserSetters.forEach((setter) => setter(dto));
  visitor = data;
  return data;
}
