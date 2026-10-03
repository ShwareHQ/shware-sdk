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

## Sessions and attribution

How the events this SDK sends are meant to be read on the server side, for attribution. Three
layers, each derived from the one below it:

- **Session** — one row per `session_start`. The SDK opens a session after 30 minutes without an
  event and sends exactly one `session_start` at the head of the batch that opened it, carrying
  the tags of the event that opened it: the landing page's URL, utm parameters and click ids,
  captured when that event happened rather than when the batch went out. A partial unique index on
  `event (session_id) where name = 'session_start'` makes that row the session's one record. The
  server reads its tags once, when it writes the session, with `classifyTouch`
  (`@shware/analytics/attribution`) and stores the touch on the session row; a rule change is
  applied to history by reclassifying.
- **Touchpoint** — one row per touch: every session with its stored touch, plus the touches people
  report (a survey answer, a call on a channel's number). Nothing is derived at query time.
- **Attribution** — one row per session, credited to the strongest touch of the same person
  (across devices) within a window, the session's own touch included. See the rules below.

### How a session is read as a touch (`classifyTouch`)

The channel and medium come from the first rule that says something:

| Order | Signal                                                                                          | `channel`                                                                                                          | `medium`                                           |
| ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 1     | `utm_source` in the URL                                                                         | the source, aliases folded (`fb`, `ig` → `meta`)                                                                   | `utm_medium`, or `(not set)`                       |
| 2     | A click id in the URL (`gclid`, `fbclid`, `rdt_cid`, …; never the cookie an earlier click left) | the id's platform                                                                                                  | `cpc`                                              |
| 3     | An ad landing page, `/lp/<channel>`                                                             | that channel                                                                                                       | `cpc`                                              |
| 4     | The product's own rules (`TouchRule`, e.g. a referral link)                                     | as the rule says                                                                                                   | as the rule says                                   |
| 5     | The referrer's host                                                                             | a known search engine, social network, video site or AI assistant folded to its channel; any other host kept as is | `organic` / `social` / `video` / `ai` / `referral` |
| 6     | Nothing                                                                                         | `(direct)`                                                                                                         | `(none)`                                           |

One exception: an ad-only click id of the channel itself (`'ads'` in `CLICK_ID_CHANNELS`), or the
channel's ad landing page, proves the click was paid, so the medium becomes `cpc` when it was left
out or puts the touch in an organic group — a Reddit ad tagged `utm_source=reddit&utm_medium=social`
that carries `rdt_cid`. A declared paid medium is kept as it is. `fbclid` never proves anything:
Meta puts it on organic links too; nor does another channel's id (an ad link copied and shared
under a utm of its own).

`channel_group` is GA4's default channel grouping of the two (`channelGroupOf`): `paid_search`,
`organic_search`, `paid_social`, `email`, ….

The touch's `priority` (`TOUCH_PRIORITY`, lower is stronger) decides which touch wins in the
attribution layer:

| Priority         | Touches                                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — campaign** | A utm, click id or ad landing page whose group is paid, display, affiliate or unassigned; a product rule that says so (a referral link); a reported touch staff stand behind (`phone`, `manual`)                                                                        |
| **2 — referrer** | A touch read from the referrer (organic search, social, other sites); **and** a utm, click id or ad landing page whose group comes out `organic_*`, `referral` or `email` (`utm_source=chatgpt.com` on ChatGPT's organic citations, `utm_medium=organic`, a newsletter) |
| **3 — claimed**  | A reported touch that is the user's claim (`survey`, `promo_code`)                                                                                                                                                                                                      |
| none             | Direct: no touch                                                                                                                                                                                                                                                        |

When a product rule matched as well as a campaign rule, the stronger tier holds: a referral link
shared under `utm_source=facebook` is named by the utm (`meta`, organic social) and still ranks as
the referral programme declares.

In short: a link someone paid for is 1; what the browser brought, a tag that calls itself organic,
and our own emails are 2; what the user says is 3. Email is 2 because it reaches people we already
know, often because an ad brought them, and its links (a welcome mail, a trial reminder) come
between that ad and the purchase: it must not take the ad's credit, and with no ad in the window
it still wins as the latest touch.

### How a session is credited (the attribution view)

For every session, among the same person's touches within the window (30 days in the reference
views), **the session's own touch included**:

1. the lowest `priority` wins;
2. among equals, the latest wins;
3. on a full tie, the session's own touch wins.

| `touch_kind` | Meaning                                                              |
| ------------ | -------------------------------------------------------------------- |
| `own`        | The session's own touch won                                          |
| `inherited`  | A direct session, credited to an earlier touch                       |
| `overridden` | The session had a touch of its own, but an earlier, stronger one won |
| `none`       | A direct session with no touch in the window                         |

| #   | What happened                                                                      | The current session is credited to | `touch_kind`         | Why                                 |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------- | -------------------- | ----------------------------------- |
| 1   | Day 1 a Meta ad click, day 2 a branded Google search                               | **Meta**                           | `overridden`         | 1 beats 2                           |
| 2   | Day 1 a Meta ad click, day 2 typed in                                              | **Meta**                           | `inherited`          | direct inherits                     |
| 3   | Day 1 an organic search, day 2 a Meta ad click                                     | **Meta**                           | `own`                | its own touch is stronger           |
| 4   | Day 1 a Meta ad click, day 3 a Google ad click                                     | **Google**                         | `own`                | both 1, the latest wins             |
| 5   | Day 1 a Meta ad click, day 2 a ChatGPT citation with its utm                       | **Meta**                           | `overridden`         | ChatGPT's organic utm ranks 2       |
| 6   | Day 1 an organic search, day 5 a ChatGPT citation                                  | **ChatGPT**                        | `own`                | both 2, the latest wins             |
| 7   | An ad click 45 days ago, an organic search today                                   | **Organic search**                 | `own`                | the ad is out of the window         |
| 8   | A Reddit ad tagged `utm_medium=social` with `rdt_cid`                              | **reddit / cpc**                   | `own`                | the click id proves a paid click    |
| 9   | Day 1 a Meta ad click, day 2 a newsletter link (`utm_medium=email`)                | **Meta**                           | `overridden`         | email ranks 2                       |
| 10  | Day 1 an organic search, day 2 a newsletter link, no ad in the window              | **Email**                          | `own`                | both 2, the latest wins             |
| 11  | A survey answer "a podcast" (backdated to the first visit), then an organic search | **Organic search**                 | `own`                | 2 beats 3; a claim only fills a gap |
| 12  | Day 1 a ChatGPT citation, day 2 a branded Google search                            | **Organic search**                 | `own`                | both 2, the latest wins             |
| 13  | Day 1 a ChatGPT citation, day 2 a ChatGPT ad click (`oppref`)                      | **chatgpt / cpc**                  | `own`                | the ad is 1                         |
| 14  | Day 1 a Meta ad click, day 2 a ChatGPT citation, day 3 typed in                    | **Meta**                           | `inherited`          | 1 beats the citation's 2            |
| 15  | The ChatGPT app opens a link with neither referrer nor utm                         | **Direct**, or what came before    | `none` / `inherited` | nothing to read                     |

**How this differs from GA4.** GA4's last non-direct click credits the latest touch that is not
direct, whatever it was: cases 1, 5 and 9 go to the search, ChatGPT and the email. Here an ad click is not
overwritten by the organic visit that follows it within the window, which is what a paid ROAS
panel expects. The touchpoint layer still has every session's own touch, so the GA4-style figure
is one query away, and `overridden` measures the difference.

**Retargeting.** No click-based model can tell whether an ad caused the visit, and retargeting is
where that shows: someone who would have come back anyway clicks a retargeting ad on the way in.
For a returning customer who was going to buy anyway:

| What happened                                                     | GA4 last non-direct click | This model |
| ----------------------------------------------------------------- | ------------------------- | ---------- |
| Clicks a retargeting ad, buys in that session                     | the ad                    | the ad     |
| Clicks a retargeting ad, types the site in the next day and buys  | the ad (direct inherits)  | the ad     |
| Clicks a retargeting ad, searches the brand the next day and buys | **the search**            | the ad     |

GA4's model only removes the third row, and that row is the credit a prospecting ad deserves (the
ad made the brand known, the search followed); the first two rows, where most of retargeting's
inflation is, stay in both. So crediting the search is not a fix. Read retargeting through the
report instead of the model:

1. **Acquisition by first touch.** A person's first touch (`user_attribution` in the reference
   views) is settled long before any retargeting reaches them, so new users and their lifetime
   value by first channel leave retargeting out by construction. Judge acquisition ROAS there.
2. **Keep retargeting apart.** Name retargeting campaigns so they can be told apart
   (`utm_campaign` with an `rt_` prefix, say), and read the session-level attribution of those
   campaigns split into new and returning people: a high share of returning people is credit that
   was probably not incremental.
3. **Measure the increment when the spend justifies it.** A holdout (Meta's Conversion Lift, a
   geo split) is the only way to answer whether the ad caused the purchase.

Special cases in the model ("an ad clicked by a paying customer does not override") are not
worth it: the rules get harder to explain, and the first two rows remain.

### AI assistants (GEO)

Visits an AI assistant sends — a citation in ChatGPT, Perplexity, Gemini, Claude, Copilot,
DeepSeek and the others in `REFERRER_SITES` — are `organic_ai`, read from the referrer or from the
assistant's own utm (`utm_source=chatgpt.com`). They rank with organic search, priority 2, on
purpose: both are earned, not bought, and come from a question the user asked.

- **Not above SEO**: a citation would otherwise take the credit from the ad clicked before it, and
  from the search that followed it.
- **Not below SEO**: "ask ChatGPT, then search the brand" would then always go to the search, and
  GEO would read lower than it is.
- **Apart from ChatGPT's ads**: a click on a ChatGPT ad carries `oppref` and is paid, priority 1
  (`paid_other`); the citations next to it stay `organic_ai`.

GA4's default grouping has no AI group and files these visits under Referral; `organic_ai` is an
addition so GEO and SEO can be compared side by side.

What the data cannot show, and how to read around it:

1. **Dark AI traffic.** The assistants' desktop and mobile apps, and links copied into a browser,
   often arrive with neither referrer nor utm, and are counted as direct (case 15). GEO is always
   undercounted.
2. **Discovery credited to search.** Someone who learns the brand from an assistant and searches
   it the next day is credited to the search (case 12), as in every last-touch model.
3. **Read GEO by first touch** (`user_attribution` in the reference views), where the assistant
   that introduced the brand keeps the credit, and **ask**: a sign-up survey ("where did you hear
   about us?" with the assistants as options) stored as a reported touch (`survey`, priority 3)
   never overrides a tracked touch, but measures how much of the direct traffic the assistants
   brought.

### Compared with other tools

How other tools credit a visit, as far as their documented defaults go (they change often; check
the vendor's documentation before relying on a detail):

| Tool                                                | Main model                                                                                                                                                                   | Direct visits                                               | Priority between channels                                         | Window                                                   | Across devices                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------- |
| **GA4**                                             | Data-driven by default; paid and organic last click, and Google paid channels last click, as options                                                                         | Inherit the last non-direct source                          | Only in "Google paid channels last click", for Google Ads         | 30 days (configurable)                                   | Signed-in user id, Google signals |
| **PostHog**                                         | A session's entry source (`$entry_utm_*`, `$entry_referring_domain`, grouped GA4-style) and a person's first touch (`$initial_*`); funnels break down by first or last touch | A direct session stays direct: no look-back                 | None                                                              | —                                                        | Merged persons via `identify`     |
| **Mixpanel**                                        | Picked per report: first touch, last touch, linear, U-shaped, time decay, participation                                                                                      | Only events with utm count as touches, so direct is skipped | None                                                              | Configurable look-back                                   | Identity merge                    |
| **Amplitude**                                       | Initial / latest utm user properties (latest changes only on a new utm), plus multi-touch models                                                                             | Skipped                                                     | None                                                              | Configurable                                             | Identity merge                    |
| **Adobe Analytics**                                 | Marketing channels classified by ordered processing rules; first and last touch channel with expiry; Attribution IQ models incl. algorithmic                                 | Usually set not to override                                 | **Yes**: per channel, whether it overrides the last touch         | Visit or days, configurable                              | Identity stitching                |
| **Ad platforms** (Meta, Google Ads, …)              | Each claims the conversions it touched (Meta: 7-day click, 1-day view by default; Google Ads: data-driven)                                                                   | Not their concern                                           | Only themselves, so platforms **claim the same conversion twice** | Their own                                                | Their own accounts                |
| **Mobile measurement partners** (AppsFlyer, Adjust) | Last click on install, with a **priority hierarchy** (click over view, device id match over probabilistic); organic when nothing in the window                               | Organic install                                             | **Yes**, the core of the model                                    | Click about 7 days, configurable; re-attribution windows | Device                            |
| **HubSpot**                                         | A contact's original source (first touch) and multi-touch revenue models                                                                                                     | Does not change the first touch                             | None                                                              | —                                                        | Contact                           |

Where this model stands:

| Trait                                                 | Shared with                                                                                                         | Unlike                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Direct visits inherit an earlier source               | GA4, Mixpanel, Amplitude, Adobe — the common ground                                                                 | PostHog's session-level source, which does not look back                               |
| Channels are ranked, a paid touch over an organic one | **Adobe's override rules, the MMPs' priority hierarchy** — the tools built for marketing and media-buying decisions | The product analytics tools (PostHog, Mixpanel, Amplitude), where every touch is equal |
| One touch per session                                 | Every first- or last-touch model                                                                                    | Multi-touch models, which split the credit                                             |
| A first-touch view per person                         | GA4's first user source, PostHog's and Amplitude's initial properties, HubSpot's original source                    | —                                                                                      |

So this is a rule-based last-touch model with channel priority: more favourable to ads than the
product analytics tools, in the same family as Adobe's and the MMPs' rules. Two consequences to
expect: a platform's own dashboard will report more conversions than this model credits it with
(it counts view-through, and every platform claims a shared conversion), and the sum of the
platforms' own figures exceeds the real total.

### Other models

The touchpoint layer keeps every touch, so other models can be added next to this one as views,
without changing it:

- **Multi-touch (rule-based)**: the credit of one conversion is split across the touches on its
  path, by a fixed rule — linear (equal shares), time decay (more to the recent ones), position
  based (40% first, 40% last, 20% spread over the middle). Useful to see which channels open a
  journey and which close it; the shares are a convention, not a measurement.
- **Data-driven (algorithmic)**: a model learns from converting and non-converting paths how much
  each touch raises the chance of converting (Shapley values or Markov chains), and splits the
  credit by that. GA4's and Google Ads' default; it needs a large volume of conversions to be
  stable, and it is still a model of correlation, not of causation.
- **Incrementality**: only a holdout experiment (a conversion lift study, a geo split) measures
  what an ad caused. It answers a different question from every model above, and is the one to
  run when the spend on a channel is large enough to matter.

What the SDK guarantees for this to hold:

- `session_start` is sent once per session, first in its batch, with the opening event's tags and
  timestamp. If the server rejected that batch, it goes out again with the session's next batch
  under the same session id; the server's unique index drops a duplicate should both land.
- On native, the install referrer's `utm_*` are attached only on the launch that first resolves
  the referrer, so a later session is a touch only when it actually arrived through something.
- `session_id` is a client-generated uuidv7 persisted in `config.storage`, shared across tabs and
  reloads. It is a grouping key, not an identity: event and visitor ids are the server's.
- The person a visitor belongs to is the server's too: `visitor.distinct_id`, the visitor's own id
  until someone signs in on it and the user's id from then on. The client never sends it;
  `setVisitor` hands the server's value to the third-party user setters, and PostHog is identified
  by it once a user is known.

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

## Click ids and ad cookies

Each tag is named after where it was read. A URL parameter keeps its own name (`fbclid`, `gclid`,
`msclkid`, `oppref`, `ScCid`); an ad platform's first-party cookie keeps the cookie's name, which
starts with an underscore (`_fbc`, `_fbp`, `_gcl_aw`, `_gcl_gb`, `_uetmsclkid`, `_rdt_cid`,
`_rdt_uuid`, `__oppref`, `__obref`). The one exception is LinkedIn's `li_fat_id` cookie, named
like its URL parameter, which the tags keep as `_li_fat_id`. A tag is never filled from the other
source.

- Channel classification reads the URL parameters only: they are this visit's click, where a click
  cookie lives on for weeks after it.
- The Conversions API senders take the URL parameter first and the cookie on a page without one —
  the later pages and visits a conversion usually happens on. On the landing page the URL is this
  click while the cookie may still hold an earlier one.
- Clients older than 9.0.0 send `fbc`, `fbp` and `rdt_uuid` for `_fbc`, `_fbp` and `_rdt_uuid`;
  the senders still read them as a fallback (deprecated).

### Keeping the cookies past Safari's limits (TanStack Start)

The pixels write their cookies through `document.cookie`, which Safari caps at 7 days (24 hours on
a landing page decorated by an ad click), so a visitor returning a week later has lost the click
and, for the browser ids, gets a new identity. `createClickIdMiddleware` re-issues them over HTTP
on every document response — the server-set copy is not capped — and captures the click ids from
the landing URL:

| Cookie                    | Written by                                                   | Re-issued for                                                      |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `_fbc`                    | this middleware, from `fbclid`                               | its remaining 90 days (never slides: Meta warns on a moved fbclid) |
| `_gcl_aw` / `_gcl_gb`     | gtag                                                         | their remaining 90 days                                            |
| `_fbp`, `_rdt_uuid`       | the Meta / Reddit pixel                                      | 90 days, as the pixel itself rewrites them on every page           |
| `_rdt_cid`, `_uetmsclkid` | the Reddit pixel / UET tag, and this middleware from the URL | 90 days, as their pixel does                                       |
| `__oppref`                | oaiq, and this middleware from `oppref`                      | 30 days                                                            |
| `__obref`                 | oaiq                                                         | 365 days                                                           |

A browser id is only ever re-issued, never created: the pixel creates it. Nothing is written for
OpenAI once the visitor has opted out of oaiq (`__oaiq_consent=false`).

`domain` is required: in production the site's registrable domain (e.g. `.example.com`), where
the pixels write theirs — a host-only cookie would be a second cookie of the same name, which
the pixels read in its place or delete. `null` (host-only) is only for `localhost`:

```ts
// src/start.ts
import { createClickIdMiddleware } from '@shware/analytics/tanstack';

const clickIdMiddleware = createClickIdMiddleware(
  import.meta.env.DEV ? { domain: null, secure: false } : { domain: '.example.com' }
);
export const startInstance = createStart(() => ({ requestMiddleware: [clickIdMiddleware] }));
```

## Third Parties Advices

### Reddit

We strongly recommend using the Reddit Pixel and Conversions API (CAPI) together.

- rdt_cid: from url params, else the `_rdt_cid` cookie
- \_rdt_uuid: from a first-party cookie

### LinkedIn

If we receive an Insight Tag event and a Conversions API event from the same account with the same eventId, we discard the Conversions API event and count only the Insight Tag event in campaign reporting.
``

### OpenAI (ChatGPT Ads)

The pixel captures `oppref` from the landing URL into its `__oppref` cookie (30 days) and keeps a
browser reference in `__obref` (365 days); it writes both only with measurement consent. The
Conversions API does not capture either: the sender passes `oppref` (the URL's, else
`__oppref`) and `user.obref`, and the user identifiers as the plural, hashed lists the API takes.

### Microsoft Advertising (Bing Ads)

Microsoft recommends the UET tag and the Conversions API (CAPI) together. The two deduplicate on
(`tagId`, `eventName`, `eventId`): the browser sends the internal event name as the UET action with
the event id as `event_id`, the server sends the same name as `eventName` with the same id.

Browser — pass the tag id and the customer id to the framework `Analytics` component
(`<Analytics uetTagId="97267979" uetCustomerId="255004870" />` from `@shware/analytics/tanstack`,
`/next` or `/react-router`). It inlines Microsoft's snippet with `enableAutoSpaTracking: true` (the
tag owns page loads, `sendUETEvent` drops `page_view` and forwards everything else) and fires the
Conversions API's ID Sync pixel once per visit for the SDK visitor — anonymous visitors included,
they are who remarketing audiences are built from. Then:

```ts
import { sendUETEvent, setUETUser, setUETConsent } from '@shware/analytics/third-parties';

setupAnalytics({
  thirdPartyTrackers: [sendUETEvent],
  // Enhanced conversions: the tag hashes the email/phone itself before they leave the page.
  thirdPartyUserSetters: [setUETUser],
});
// Consent mode (EEA/UK/CH): push `default` before the tag loads, `update` on the visitor's choice.
setUETConsent('default', { ad_storage: 'denied', wait_for_update: 2000 });
```

ID Sync ties the visitor id CAPI receives as `anonymousId` to Microsoft's ids — required for
remarketing built from CAPI events, recommended for measurement. `setUETUser` re-syncs on sign-in
with the user id hashed into `UID` (the same SHA-256 the server sends as `externalId`). Outside the
`Analytics` components, `configureUET({ customerId })` + `syncUETVisitor()` do the same.

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

- [Click IDs](https://learn.microsoft.com/en-us/linkedin/marketing/conversions/enabling-first-party-cookies?view=li-lms-2025-10&source=recommendations): get li_fat_id from url params, else the Insight Tag's `li_fat_id` cookie (the `_li_fat_id` tag)
