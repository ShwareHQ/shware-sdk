import { fetch } from '@shware/utils';
import { keys } from '../constants/storage';
import type { CreateVisitorDTO } from '../schema/index';
import { cache, config } from '../setup/index';
import type { UpdateVisitorDTO, Visitor, VisitorProperties } from './types';

async function createVisitor(): Promise<Visitor> {
  const dto: CreateVisitorDTO = {
    device_id: await config.getDeviceId(),
    platform: config.platform,
    environment: config.environment,
    properties: (await config.getTags()) as VisitorProperties,
  };

  const response = await fetch(`${config.endpoint}/visitors`, {
    method: 'POST',
    credentials: 'include',
    headers: await config.getHeaders(),
    body: JSON.stringify(dto),
  });

  const data = (await response.json()) as Visitor;
  if (data.id) {
    config.storage.setItem(keys.visitor_id, data.id);
  }
  return data;
}

async function getOrCreateVisitor(): Promise<Visitor> {
  const visitorId = config.storage.getItem(keys.visitor_id);
  if (visitorId && visitorId !== 'undefined') {
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

let visitorFetcher: Promise<Visitor> | null = null;

export async function getVisitor(): Promise<Visitor> {
  if (cache.visitor) return cache.visitor;
  if (visitorFetcher) return visitorFetcher;
  visitorFetcher = getOrCreateVisitor();
  cache.visitor = await visitorFetcher;
  visitorFetcher = null;
  return cache.visitor;
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
  cache.visitor = data;
  return data;
}
