import { config } from '../setup/index';
import type { CreateVisitorDTO, UpdateVisitorDTO, Visitor, VisitorProperties } from './types';

const key = 'visitor_id';

async function createVisitor(): Promise<Visitor> {
  const dto: CreateVisitorDTO = {
    device_id: await config.getDeviceId(),
    properties: (await config.getTags()) as VisitorProperties,
  };
  const headers = await config.getHeaders();
  const response = await config.http.post<Visitor>(`/visitors`, dto, { headers });
  return response.data;
}

async function getOrCreateVisitor(): Promise<Visitor> {
  const visitorId = await config.storage.getItem(key);
  if (visitorId) {
    try {
      const headers = await config.getHeaders();
      const response = await config.http.get<Visitor>(`/visitors/${visitorId}`, { headers });
      return response.data;
    } catch {
      const visitor = await createVisitor();
      await config.storage.setItem(key, visitor.id);
      return visitor;
    }
  } else {
    const visitor = await createVisitor();
    await config.storage.setItem(key, visitor.id);
    return visitor;
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

export async function setVisitor(properties: VisitorProperties) {
  const dto: UpdateVisitorDTO = { properties };
  const { id } = await getVisitor();
  const headers = await config.getHeaders();
  const response = await config.http.patch<Visitor>(`/visitors/${id}`, dto, { headers });
  config.thirdPartyUserSetters.forEach((setter) => setter(properties));
  visitor = response.data;
  return response.data;
}

export async function setUserId(userId: string) {
  const { id } = await getVisitor();
  const dto: UpdateVisitorDTO = { user_id: userId };
  const headers = await config.getHeaders();
  const response = await config.http.patch<Visitor>(`/visitors/${id}`, dto, { headers });
  visitor = response.data;
  return response.data;
}
