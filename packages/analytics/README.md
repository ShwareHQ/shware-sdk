# Shware Analytics SDK

## Config

layout.tsx

```tsx
import { setupAnalytics } from '@shware/analytics';
import { getTags, getDeviceId, storage } from '@shware/analytics/web';
import { v4 as uuidv4 } from 'uuid';

setupAnalytics({
  storage,
  getTags,
  getDeviceId,
  endpoint: 'https://api.example.com/v1/analytics',
});

function App() {
  return <div>My React App</div>;
}
```

## Usage

```tsx
import { track } from '@shware/analytics';

function Button() {
  const onClick = async () => {
    await api.login();
    track('login', { method: 'google' });
  };
  return <button onClick={onClick}>Login with Google</button>;
}
```

## Backend API

- /analytics/tracks: track events
- /analytics/visitor: app visitors

## UTM params

- utm_source

## GAD params

[About gad\_\* URL parameters](https://support.google.com/google-ads/answer/16193746)

- gad_source
- gad_campaignid
- gclid

## Third Parties Advices

### Reddit

We strongly recommend using the Reddit Pixel and Conversions API (CAPI) together.

- rdt_cid: from url params
- \_rdt_uuid: from first-party cookie

### LinkedIn

If we receive an Insight Tag event and a Conversions API event from the same account with the same eventId, we discard the Conversions API event and count only the Insight Tag event in campaign reporting.

- [Click IDs](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/enabling-first-party-cookies?view=li-lms-2025-10&source=recommendations): get li_fat_id from url params and cookie
