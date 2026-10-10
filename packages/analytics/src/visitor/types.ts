import type { UpdateVisitorDTO } from '../schema';
import type { Environment, Platform, TrackTags } from '../track/types';

export type VisitorProperties = Record<Lowercase<string>, string | number | boolean | null>;

export interface Visitor {
  id: string;
  /**
   * The person this visitor belongs to, kept by the server: the visitor's own id until someone
   * signs in on it, the user's id from then on. What first-party attribution counts people by,
   * and what third parties are told to identify the visitor as. Null only from a server that
   * predates it.
   */
  distinct_id: string | null;
  device_id: string;
  platform: Platform;
  environment: Environment;
  tags: TrackTags;
}

/**
 * What a third-party user setter is handed after `setVisitor`: the payload that was sent, plus
 * the server's `distinct_id` for the visitor as it now stands.
 */
export type VisitorIdentity = UpdateVisitorDTO & Pick<Visitor, 'distinct_id'>;

export type ThirdPartyUserSetter = (identity: VisitorIdentity) => void;
