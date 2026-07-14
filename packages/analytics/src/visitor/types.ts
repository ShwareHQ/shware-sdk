import type { UpdateVisitorDTO } from '../schema';
import type { Environment, Platform, TrackTags } from '../track/types';

export type VisitorProperties = Record<Lowercase<string>, string | number | boolean | null>;

export interface Visitor {
  id: string;
  device_id: string;
  platform: Platform;
  environment: Environment;
  tags: TrackTags;
}

export type ThirdPartyUserSetter = (dto: UpdateVisitorDTO) => void;
