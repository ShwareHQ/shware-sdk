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
