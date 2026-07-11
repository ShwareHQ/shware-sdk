# Shware Analytics SDK

## Config

layout.tsx

```tsx
import { setupAnalytics } from '@shware/analytics';
import { getTags, getDeviceId, storage } from '@shware/analytics/web';

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

Typed as `UTMParams` (exported from `@shware/analytics`). Value unions follow the
[GA4 default channel group definitions](https://support.google.com/analytics/answer/9756891).

| Param                | Meaning                                                            | Examples                       |
| -------------------- | ------------------------------------------------------------------ | ------------------------------ |
| utm_source           | Traffic source (platform/site)                                     | `google`, `meta`, `newsletter` |
| utm_medium           | Marketing medium, **the key input for GA4 channel classification** | `cpc`, `paid_social`, `email`  |
| utm_campaign         | Campaign name                                                      | `summer_promo_2026`            |
| utm_id               | Campaign ID                                                        | `abc123`                       |
| utm_term             | Paid keyword                                                       | `virtual+staging`              |
| utm_content          | Differentiates creatives pointing to the same URL                  | `banner_a` / `banner_b`        |
| utm_source_platform  | Platform managing the buy                                          | `Google Ads`, `Manual`         |
| utm_creative_format  | Creative type                                                      | `display`, `video`             |
| utm_marketing_tactic | Targeting tactic                                                   | `remarketing`, `prospecting`   |

### Why Google Ads uses `medium=cpc`

GA4 assigns traffic to default channel groups by matching source/medium against
regex rules. All paid channels require the medium to match:

```
^(.*cp.*|ppc|retargeting|paid.*)$
```

`cpc` (cost-per-click) is the standard medium Google Ads applies with
auto-tagging (gclid), so manual tagging keeps the same value:
`source=google` + `medium=cpc` → search site list + paid regex → **Paid Search**.
An arbitrary medium like `ads` or `google` matches no rule and the traffic
falls into **Unassigned/Referral**, breaking channel reports.

### Recommended combinations

| Placement           | utm_source               | utm_medium    | GA4 channel    |
| ------------------- | ------------------------ | ------------- | -------------- |
| Google Ads search   | `google`                 | `cpc`         | Paid Search    |
| Meta paid ads       | `meta`                   | `paid_social` | Paid Social    |
| FB/IG organic posts | `facebook` / `instagram` | `social`      | Organic Social |
| Email marketing     | `newsletter`             | `email`       | Email          |
| Affiliate           | partner name             | `affiliate`   | Affiliates     |
| SMS                 | `sms`                    | `sms`         | SMS            |

### Gotchas

- Lowercase everything, no spaces (use `_` or `-`): `Google` and `google` are
  two different sources in reports.
- With Google Ads auto-tagging (gclid) enabled, manual UTMs are unnecessary;
  when both are present the manual UTM wins for display — keep the values
  consistent (`google`/`cpc`) to avoid splitting data.

## GAD params

[About gad\_\* URL parameters](https://support.google.com/google-ads/answer/16193746)

- gad_source
- gad_campaignid
- gclid

## Third Parties Advices

### Reddit

We strongly recommend using the Reddit Pixel and Conversions API (CAPI) together.

- rdt_cid: from url params
- \_rdt_uuid: from a first-party cookie

### LinkedIn

If we receive an Insight Tag event and a Conversions API event from the same account with the same eventId, we discard the Conversions API event and count only the Insight Tag event in campaign reporting.
``

- [Click IDs](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/enabling-first-party-cookies?view=li-lms-2025-10&source=recommendations): get li_fat_id from url params and cookie
