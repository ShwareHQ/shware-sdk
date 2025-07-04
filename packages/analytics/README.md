## Config

layout.tsx

```tsx
import { setupAnalytics } from '@shware/analytics';
import { v4 as uuidv4 } from 'uuid';

setupAnalytics({
  endpoint: 'https://api.example.com/v1/analytics',
  storage: {
    getItem: async (key) => localStorage.getItem(key),
    setItem: async (key, value) => localStorage.setItem(key, value),
  },
  deviceIdFetcher: async () => {
    const cached = localStorage.getItem('device_id');
    if (cached) return cached;
    const id = crypto?.randomUUID ? crypto.randomUUID() : uuidv4();
    localStorage.setItem('device_id', id);
    return id;
  },
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
