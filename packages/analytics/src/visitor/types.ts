import type { UserProvidedData } from '../track/gtag';
import type { Environment, Platform, TrackTags } from '../track/types';

export type VisitorProperties = Record<Lowercase<string>, string | number | boolean | null>;

export interface Visitor {
  id: string;
  device_id: string;
  platform: Platform;
  environment: Environment;
  tags: TrackTags;
}

export interface UpdateVisitorDTO {
  user_id?: string;
  distinct_id?: string;
  data?: UserProvidedData;
  properties?: VisitorProperties;
}

export type ThirdPartyUserSetter = (dto: UpdateVisitorDTO) => void;
