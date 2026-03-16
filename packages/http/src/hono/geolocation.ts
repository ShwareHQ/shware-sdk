import type { Context } from 'hono';
import { getRuntimeKey } from 'hono/adapter';
import {
  type Geolocation,
  getGeolocationFromCloudflare,
  getGeolocationFromCloudfront,
  getGeolocationFromVercel,
} from '../utils/geolocation';

export function geolocation(c: Context): Geolocation {
  if (getRuntimeKey() === 'workerd') return getGeolocationFromCloudflare(c.req.raw);
  if (c.req.header('x-vercel-id')) return getGeolocationFromVercel(c.req.raw);
  return getGeolocationFromCloudfront(c.req.raw);
}
