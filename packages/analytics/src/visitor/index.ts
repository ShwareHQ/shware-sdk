import { config } from '../setup';
import type { CreateVisitorDTO, UpdateVisitorDTO, Visitor, VisitorProperties } from '../../types';

const key = 'visitor_id';
async function getOrCreateVisitor(): Promise<Visitor> {
  const visitorId = await config.storage.getItem(key);
  if (visitorId) {
    const response = await config.http.get<Visitor>(`/visitors/${visitorId}`);
    return response.data;
  } else {
    const dto: CreateVisitorDTO = {
      device_id: await config.getDeviceId(),
      properties: await config.getTags(),
    };
    const response = await config.http.post<Visitor>(`/visitors`, dto);
    await config.storage.setItem(key, response.data.id);
    return response.data;
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
  const response = await config.http.patch<Visitor>(`/visitors/${id}`, dto);
  visitor = response.data;
  return response.data;
}
