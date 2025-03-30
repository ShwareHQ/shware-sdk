'use client';

import { setupAnalytics } from '@shware/analytics';
import { Analytics, sendGAEvent, sendFBEvent } from '@shware/analytics/next';
import { getDeviceId, getTags, storage } from '@shware/analytics/web';
import pkg from '../package.json';

setupAnalytics({
  release: pkg.version,
  storage: storage,
  endpoint: 'https://example.com/v1/analytics',
  getDeviceId: getDeviceId,
  getTags: () => getTags(pkg.version),
  thirdPartyTrackers: [sendGAEvent, sendFBEvent],
});

export default function UnifiedAnalytics() {
  return (
    <Analytics
      gaId="G-T479FDHP4Z"
      pixelId="615945711360202"
      debugMode={process.env.NODE_ENV === 'development'}
    />
  );
}
