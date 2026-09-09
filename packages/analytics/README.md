# Shware Analytics SDK

## Client-side only

Everything this SDK holds — the session, the visitor, the tags cache, the config itself — lives in
module singletons, because there is exactly one visitor per browser or app. The package can be
imported on a server (nothing is constructed at module scope, so it evaluates fine under Cloudflare
Workers), but calling `track()` there shares one session and one visitor across every request the
isolate serves.

Server-side conversions go the other way: store the client's events, then hand them to
`@shware/analytics/server`, which takes a `TrackEvent` and forwards it to the Meta, Reddit, OpenAI,
LinkedIn, Google Ads and Microsoft Advertising conversions APIs.

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

## Page views

`page_view` fires on a path or query change, never on a hash change — GA4's enhanced measurement,
Next.js's `usePathname` + `useSearchParams` pattern and PostHog's `history_change` all draw the
line there (`?page=2` is another page to a funnel, `#faq` is not). Tracking parameters (`utm_*`
and the ad click ids) are ignored when comparing, so a landing page that cleans them out of its
URL with `replaceState` does not count itself twice. `page_load_id` rotates on exactly the same
changes. The framework `Analytics` components wire this up.

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

### Microsoft Advertising (Bing Ads)

Microsoft recommends the UET tag and the Conversions API (CAPI) together. The two deduplicate on
(`tagId`, `eventName`, `eventId`): the browser sends the internal event name as the UET action with
the event id as `event_id`, the server sends the same name as `eventName` with the same id.

Browser — pass the tag id to the framework `Analytics` component (`<Analytics uetTagId="97267979" />`
from `@shware/analytics/tanstack`, `/next` or `/react-router`), which inlines Microsoft's snippet
with `enableAutoSpaTracking: true`: the tag owns page loads, `sendUETEvent` drops `page_view` and
forwards everything else. Then:

```ts
import {
  sendUETEvent,
  setUETUser,
  setUETConsent,
  sendUETIdSync,
} from '@shware/analytics/third-parties';

setupAnalytics({
  thirdPartyTrackers: [sendUETEvent],
  // Enhanced conversions: the tag hashes the email/phone itself before they leave the page.
  thirdPartyUserSetters: [setUETUser()],
});
// Consent mode (EEA/UK/CH): push `default` before the tag loads, `update` on the visitor's choice.
setUETConsent('default', { ad_storage: 'denied', wait_for_update: 2000 });
// ID Sync, once per session: ties the visitor id CAPI sends as `anonymousId` to Microsoft's ids.
// Required for remarketing built from CAPI events, recommended for measurement. `VID` must equal
// `anonymousId` and `UID` must equal `externalId`: pass the SDK visitor id and the raw user id —
// the pixel hashes the user id with the same SHA-256 the server sender uses.
sendUETIdSync({ customerId: 255004870, visitorId: (await getVisitor()).id, userId: user.id });
```

Server — the token comes from the UET tag's "Use Conversions API" step (or the Campaign Management
API's `UetTagAuthKey/Query`; an account whose tag setup lacks that option has to ask Microsoft
Advertising support), `tagId` is the UET tag id:

```ts
import { sendMicrosoftEvents } from '@shware/analytics/server';

await sendMicrosoftEvents(process.env.MS_ADS_CAPI_TOKEN, 97267979, events, userData, {
  consent: 'granted',
});
```

- msclkid: from url params, kept in the tag's own `_uetmsclkid` cookie (`_uet<id>`, 90 days). That
  cookie is Microsoft's ITP answer, but bat.js writes it with `document.cookie`, which Safari caps
  at 7 days (24h on a landing page decorated by a classified domain — a bing.com click). Register
  the click-id middleware and `resolveClickIdCookies` re-issues it over HTTP on every document
  response, restoring the 90-day window; give it the same `domain` the tag uses (eTLD+1) so the
  two write one cookie, not two. Sent to CAPI as a dashed UUID.
- anonymousId / externalId: the SDK visitor id and SHA-256 of the user id — the same two values
  `sendUETIdSync` sends as `VID` / `UID`, which Microsoft requires to match.
- Consent: the tag writes `_uetmsclkid` only with `ad_storage` granted; the middleware writes it
  from the URL regardless, so gate it with the middleware's `shouldPersist` where consent applies
  (as for `_fbc` and `_gcl_*`).
- Validation warnings on a 200 (a removed field, a skipped event) are logged with `console.warn`;
  monitor them, the status code does not show them.
- em / ph: SHA-256 of the normalized email (dots and `+alias` stripped from the user part for every
  domain, lowercase) and of the E.164 phone.
- `page_view` events are dropped by default (the tag already reports every page load); pass
  `pageLoads: true` for a CAPI-only site to send them as `pageLoad` events, each `custom` event
  then carrying the `pageLoadId` of the page load it happened on (the `page_load_id` tag, one
  v4 UUID per page load). Not yet modelled in that mode: the revenue-only `custom` event a
  destination-URL goal with variable revenue needs alongside its `pageLoad`. With the tag on the
  page neither applies — the tag reports page loads itself.

- [Click IDs](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/enabling-first-party-cookies?view=li-lms-2025-10&source=recommendations): get li_fat_id from url params and cookie
