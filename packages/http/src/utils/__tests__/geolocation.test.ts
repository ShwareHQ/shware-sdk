import { describe, expect, test } from 'vitest';
import { getGeolocation, getGeolocationFromCloudflare } from '../geolocation';

function request(headers: Record<string, string>) {
  return new Request('https://example.com/', { headers });
}

describe('getGeolocationFromCloudflare', () => {
  test('reads the edge-set cf-connecting-ip and ignores a client-sent true-client-ip', () => {
    const r = request({ 'cf-connecting-ip': '203.0.113.7', 'true-client-ip': '198.51.100.1' });
    expect(getGeolocationFromCloudflare(r).ip_address).toBe('203.0.113.7');
  });

  test('never falls back to true-client-ip', () => {
    const r = request({ 'true-client-ip': '198.51.100.1' });
    expect(getGeolocationFromCloudflare(r).ip_address).toBeUndefined();
  });

  test('getGeolocation routes cf-ray requests through the same reader', () => {
    const r = request({
      'cf-ray': '8a1b2c3d4e5f-SJC',
      'cf-connecting-ip': '203.0.113.7',
      'true-client-ip': '198.51.100.1',
      'cf-ipcountry': 'US',
    });
    expect(getGeolocation(r)).toMatchObject({ ip_address: '203.0.113.7', country: 'US' });
  });
});
