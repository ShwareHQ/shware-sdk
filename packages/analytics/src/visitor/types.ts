export type VisitorProperties = Record<Lowercase<string>, string | number | boolean | null>;

export interface Visitor {
  id: string;
  device_id: string;
  properties: VisitorProperties;
}

export interface CreateVisitorDTO {
  device_id: string;
  properties?: VisitorProperties;
}

export interface UpdateVisitorDTO {
  properties: VisitorProperties;
}

export type ThirdPartyUserSetter = (properties: VisitorProperties) => void;
