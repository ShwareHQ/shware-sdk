import { invariant } from './utils';
import { options, http } from './setup';
import type { CreateVisitorDTO, UpdateVisitorDTO, Visitor, VisitorProperties } from './types';

const key = 'visitor_id';
async function getOrCreateVisitor(): Promise<Visitor> {
  invariant(options.storage, 'storage is required');
  invariant(options.endpoint, 'endpoint is required');
  invariant(options.tagsFetcher, 'tagsFetcher is required');
  invariant(options.deviceIdFetcher, 'deviceIdFetcher is required');

  const visitorId = await options.storage.getItem(key);
  if (visitorId) {
    const response = await http.get<Visitor>(`/visitors/${visitorId}`);
    return response.data;
  } else {
    const dto: CreateVisitorDTO = {
      device_id: await options.deviceIdFetcher(),
      properties: await options.tagsFetcher(),
    };
    const response = await http.post<Visitor>(`/visitors`, dto);
    await options.storage.setItem(key, response.data.id);
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
  const response = await http.patch<Visitor>(`/visitors/${id}`, dto);
  visitor = response.data;
  return response.data;
}
