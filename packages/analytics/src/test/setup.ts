import type { Options } from '../setup/index';
import type { TrackTags } from '../track/types';

/**
 * The SDK's state — `config`, `cache`, the session singleton, the track queue — lives in module
 * scope, exactly as it does in a browser. Tests therefore load the modules fresh per test with
 * `vi.resetModules()` and dynamic imports; this file only provides the pieces every test hands to
 * `setupAnalytics`, and is itself imported dynamically so it joins the same module graph.
 */
export function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

export function baseOptions(overrides: Partial<Options> = {}): Options {
  return {
    release: '1.0.0',
    storage: memoryStorage(),
    endpoint: 'https://api.test',
    platform: 'web',
    environment: 'production',
    getTags: (): TrackTags => ({}),
    getDeviceId: () => 'device-1',
    ...overrides,
  };
}

/** A minimal ok Response whose json body is `data`. */
export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Read the URL passed to the real Fetch API, including Request inputs. */
export function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  return input instanceof Request ? input.url : input.toString();
}

/** These transports serialize JSON to a text body; an absent or binary body is a test failure. */
export function textRequestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new Error('Expected a text request body');
  return init.body;
}
