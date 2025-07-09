import { config } from '../setup/index';
import type { CreateLinkDTO } from '../schema/index';

export interface Link extends CreateLinkDTO {
  id: string;
  created_at: string;
}

export async function createLink(dto: CreateLinkDTO) {
  const response = await config.http.post<Link>('/links', dto);
  return response.data;
}

export async function getLink(id: string): Promise<Link | null> {
  try {
    const response = await config.http.get<Link>(`/links/${id}`);
    return response.data;
  } catch {
    return null;
  }
}
