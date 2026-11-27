import { describe } from 'vitest';
import { cloudflareDriver } from './cloudflare-driver';
import { conformance } from './suite';

describe('cloudflare', () => {
  conformance(cloudflareDriver);
});
