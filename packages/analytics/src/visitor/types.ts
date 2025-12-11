import type { UserProperties, UserProvidedData } from '../track/gtag';
import type { Environment, Platform } from '../track/types';

export type VisitorProperties = Record<Lowercase<string>, string | number | boolean | null>;

export interface Visitor {
  id: string;
  device_id: string;
  platform: Platform;
  environment: Environment;
  properties: VisitorProperties;
}

export interface UpdateVisitorDTO {
  user_id?: string;
  distinct_id?: string;
  data?: UserProvidedData;
  properties?: UserProperties;
}

export type ThirdPartyUserSetter = (dto: UpdateVisitorDTO) => void;
