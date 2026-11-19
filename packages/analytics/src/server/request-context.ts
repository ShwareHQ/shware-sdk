import type { TrackTags, UserProvidedData } from '../track/types';

/**
 * The request context the server records in each event's tags (`tags.ip_address`,
 * `tags.user_agent`, the request's own address and header) outranks the caller-wide `data`:
 * a batch can hold events carried by several requests, and the tag is the one that carried this
 * event. `data` is the fallback, for callers that pass the context there instead.
 */
function tag(tags: TrackTags, key: 'ip_address' | 'user_agent'): string | undefined {
  const value = tags[key];
  return typeof value === 'string' && value ? value : undefined;
}

export function requestIpAddress(tags: TrackTags, data: UserProvidedData): string | undefined {
  return tag(tags, 'ip_address') ?? data.ip_address;
}

export function requestUserAgent(tags: TrackTags, data: UserProvidedData): string | undefined {
  return tag(tags, 'user_agent') ?? data.user_agent;
}

/** Every candidate in precedence order — for a destination that only takes some addresses. */
export function requestIpAddresses(tags: TrackTags, data: UserProvidedData): string[] {
  return [tag(tags, 'ip_address'), data.ip_address].filter((ip): ip is string => !!ip);
}
