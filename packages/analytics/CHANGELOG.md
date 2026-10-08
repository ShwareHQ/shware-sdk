# @shware/analytics

## 11.9.0

### Minor Changes

- e46a46d: Add `fetchMetaAdPerformanceHistory` to `@shware/analytics/ads`: Meta's daily ad rows for the days before its 13 months of hourly data (up to its 37 months), each spread evenly over the hours of the account's day so a table stays hourly — whole-day sums exactly Meta's. It refuses days that still have hourly data. Also exports `spread`.

## 11.8.0

### Minor Changes

- c990163: Add `@shware/analytics/ads`: `fetchMetaAdPerformance` reads Meta ad delivery from the Insights API over `fetch` — one typed `AdPerformanceRow` per ad and hour, `hour_start` in UTC, spend, impressions, link clicks, and the platform's conversions with their click-through part — with `channel` / `medium` / `channel_group` from the attribution vocabulary, so the rows join sessions and attribution as they are. Ranges are fetched in 7-day windows; a `since` past Meta's 13 months of hourly data throws instead of returning nothing.

## 11.7.0

### Minor Changes

- 7f4e6ee: On native, the link that opened the app — at launch, or bringing it back to the front — lands the visit as a web page's URL does: pass `deepLink` from `@shware/analytics/native` to `setupAnalytics({ deepLink })`, and its URL (as `page_location`) and utm go into the tags of every event until the app goes to the background, over the install referrer's utm. A session a universal link from an email or an ad starts is no longer direct. `setupAnalytics` starts its listeners (nothing runs at import); `deepLink.open(url)` hands over a link `Linking` does not see, such as a push notification's.

## 11.6.0

### Minor Changes

- 4dd9877: `classifyTouch` files SMS and push notifications as GA4 does, in the new `sms` and `mobile_push` channel groups (`sms` as the source or the medium; a medium ending in `push` or naming mobile or a notification, or `firebase` as the source) instead of `unassigned`, and ranks them with a referrer like email, so they never take an ad's credit. Reclassify stored sessions after upgrading.

## 11.5.0

### Minor Changes

- 56f334d: Collect the `network` and `match_type` URL parameters as tags: where a Google Ads or Microsoft Advertising click was served and how its keyword matched (`a`: AI Max without a keyword), which a campaign's type alone does not say. See `UTM.md` for the final URL suffix templates.

## 11.4.0

### Minor Changes

- e12ad99: `META_PLACEMENTS` adds Meta's current `facebook_feed`, `facebook_instream` and `threads_stream`, which `classifyTouch` read as organic social under `utm_source=meta`. Reclassify stored sessions after upgrading.

## 11.3.2

### Patch Changes

- 919878d: Report the previous page as `page_referrer` after an in-app navigation, as GA4 does, instead of `document.referrer`, which a single page app never updates: a session opened later in the visit no longer counts the site the visit came from a second time.

## 11.3.1

### Patch Changes

- acf0fcf: `useAppAnalytics` sends the queue as soon as the app goes to the background, after its engagement event, instead of after the batch delay: the app may be suspended or killed before that, losing the queue — a new session's `session_start` among it.

## 11.3.0

### Minor Changes

- 08ed82c: OpenAI Conversions API: send the app events — `first_open` as `app_installed` and `app_open` as `app_opened` (`customer_action`) — for events from an app only, with `action_source` `mobile_app`, as OpenAI takes them through the Conversions API alone; the pixel never sends them.

## 11.2.0

### Minor Changes

- fe333af: `setVisitor` binds the user through an `identify` event instead of a `PATCH /visitors/:id`: it hands the user to the third-party setters at once (the user's id as the distinct id) and queues `identify` with `{ user_id }` when the user differs from the one the page last identified, so the binding travels with the events that create the visitor and can never arrive before it. It is now synchronous, returns nothing and never throws. `IDENTIFY_EVENT` is exported for servers, which must bind the visitor from it (README, "Visitors") before clients upgrade; `identify` is never forwarded to third parties.

## 11.1.0

### Minor Changes

- d616c6b: Drop visitor `properties` entirely: `updateVisitorSchema` no longer takes them, `setVisitor` no longer accepts them, and the GA user setter no longer forwards them as `user_properties`. No server has stored them since visitors keep tags only, and no host passes them. A body that still carries `properties` validates as before, the field left out. The `VisitorProperties` type stays: it types a visitor's tags.
- d616c6b: `setVisitor` no longer sends the current page's tags: at sign-in the page is the login page, not where the visit came in, and the server already refreshes `visitor.tags` from each `session_start`. `updateVisitorSchema` takes `tags` as optional, so servers on this version accept a sign-in without them and still merge the tags of clients before 11.1. Upgrade the server before the clients.

### Patch Changes

- d616c6b: `createVisitorSchema` drops `properties`: clients before 11 sent a copy of their tags under it, which servers have ignored since they keep tags only. A body that still carries it validates as before, the field left out.

## 11.0.1

### Patch Changes

- f9b5320: Export the `CreateTrackEventDTO`, `CreateVisitorDTO` and `UpdateVisitorDTO` types next to their schemas, for servers that type their handlers by what the SDK sends.

## 11.0.0

### Major Changes

- 00ce319: The visitor id is generated by the SDK (a uuidv7 kept in `config.storage`, `visitorId()`) instead of by `POST /visitors`, so a new visitor's first events — and the beacon of a visit left within a second, `session_start` included — no longer wait for a round trip and are no longer lost when the page goes first. A visit makes no visitor request at all: the server creates the visitor from its first events and refreshes `visitor.tags` from each `session_start`, as person properties ride on events in PostHog. `getVisitor` and `cache.visitor` are removed (nothing read them); `setVisitor` (sign-in) still PATCHes, under the local id. An id a server issued to an older client is kept. **Breaking: the server must create visitors from `POST /events`** (README, "Visitors"); deploy it before upgrading clients. `POST /visitors` is no longer called.

## 10.3.0

### Minor Changes

- ddffc74: `classifyTouch` reads an Android app's referrer (`android-app://<package>`) as the site it stands for (`ANDROID_APP_HOSTS`): the Google app as a Google search, Gmail, LinkedIn, Reddit, Telegram and the other listed apps as their sites, an unlisted package as a referring host — before, every one of them was direct. Adds the `gmail` channel (`mail.google.com`, medium `email`, which was read as a Google search) and `telegram` (`t.me`, `telegram.org`). Reclassify stored sessions after upgrading.
- ddffc74: `classifyTouch` counts a click id only when it has a value. Clients before mid-2025 wrote every missing URL parameter as `null` into the tags, and reading the key alone named those sessions Meta clicks — Google ad clicks among them, since `fbclid` is listed first. A null, empty, `undefined` or `null` string value is no click now. Reclassify stored sessions after upgrading.

## 10.2.1

### Patch Changes

- b1c850f: Document how AI assistant visits (GEO) are classified and ranked with organic search, with worked cases, and test that they share its tier while ChatGPT's ad clicks stay paid.

## 10.2.0

### Minor Changes

- 8586454: `classifyTouch`: an ad-only click id or the ad landing page of the utm's own channel now makes the medium `cpc` when the declared `utm_medium` puts the touch in an organic group (a Reddit ad tagged `utm_medium=social` with `rdt_cid`), not only when the medium is missing. Click ids of another channel and `fbclid` still never override the utm.
- 8586454: `classifyTouch`: a utm, click id or ad landing page whose touch lands in an organic channel group, referral or email (`utm_source=chatgpt.com`, `utm_medium=organic`, a newsletter) now ranks with the referrer (`TOUCH_PRIORITY.referrer`) instead of as a campaign, so it no longer takes the credit from an ad clicked earlier in the attribution window. When a product rule matched too, the stronger of the two tiers holds (a referral link shared under a social utm keeps the programme's tier). Reclassify stored sessions after upgrading.

## 10.1.1

### Patch Changes

- 9b6693b: Google Data Manager: `normalizeEmail` removes all whitespace, including intermediate spaces, before hashing.
- 9b6693b: Google Data Manager: send the gbraid alongside the gclid when both are present, as Google recommends, instead of dropping it.
- 9b6693b: LinkedIn Conversions API: add the IPv4 address (`PLAINTEXT_IP_ADDRESS`) and, for Android events, the advertising id (`GOOGLE_AID`) to the user ids.
- 8216958: LinkedIn Conversions API: detect IPv4 addresses with `node:net`'s `isIPv4` instead of a regular expression.
- 9b6693b: Meta Conversions API: send app events with `action_source: 'app'` only when the package name and an iOS/Android OS are known (`extinfo` version `i2`/`a2`), otherwise `other`; always set the required `advertiser_tracking_enabled`.
- 9b6693b: Meta Conversions API: warn when website events are sent without `client_user_agent`, which Meta requires for them.

## 10.1.0

### Minor Changes

- d39a91c: Add a `uetConsent` prop to the `Analytics` components that pushes the UET consent mode default inside the tag snippet, ahead of bat.js. It defaults to `{ ad_storage: 'granted' }`; pass `{ ad_storage: 'denied' }` behind a consent banner, or `false` to push no default.

## 10.0.1

### Patch Changes

- 4a178bf: `createClickIdMiddleware` no longer overrides the `Cache-Control` of a response that is already `private` or `no-store` when it attaches cookies: no shared cache can store such a response, so its per-user `Set-Cookie` is safe as it is, and a browser never replays a `Set-Cookie` from its own cache. The gtag.js loader served through a first-party Google Tag Gateway (`private, max-age=900`) keeps its browser caching while its requests still re-issue the cookies, where it used to become `no-store` for every visitor carrying one. Responses that could be shared (`public`, `s-maxage`, or no `Cache-Control`) are made uncacheable as before.

## 10.0.0

### Major Changes

- 5e33cae: `createClickIdMiddleware` / `resolveClickIdCookies` now keep more of the ad platforms' cookies past Safari's limits, each as its own pixel keeps it (read from their current client code): `_rdt_cid` is re-issued for 90 days on every document response instead of only being written from the URL, and `_rdt_uuid` and `_fbp` are re-issued as they are for 90 days; OpenAI's `__oppref` is captured from the `oppref` URL parameter for 30 days and re-issued, and `__obref` re-issued for 365 days. Browser ids are never created, only re-issued, and no OpenAI cookie is written once the visitor has opted out of oaiq (`__oaiq_consent=false`). **Breaking:** `domain` is now required — the site's registrable domain in production, `null` for a host-only cookie on `localhost` — because a host-only cookie sits next to the pixel's of the same name, and Reddit's pixel deletes it; and the default `clickIdMiddleware` export, which had no domain, is removed: call `createClickIdMiddleware({ domain })`.

## 9.1.0

### Minor Changes

- 8a37b67: Google Ads (Data Manager API): new `actionType` option, `'webpage'` (default) or `'offline'`, for the kind of conversion action the events go to. A webpage action — the one the gtag tag reports to — accepts `eventSource` `WEB` or none, and fails the whole request on any other value, so non-web events are now sent there without `eventSource` instead of `APP` / `OTHER`. An offline (upload) action requires `eventSource` and keeps getting `WEB`, `APP` or `OTHER` from the platform.

### Patch Changes

- 8a37b67: The Conversions API senders leave out the events whose time their API rejects, instead of sending them: one out-of-range event fails the whole request on most of them, taking every valid event of the batch down with it. Meta, OpenAI, Reddit and Microsoft keep the last 7 days, LinkedIn the last 90; OpenAI also refuses more than 10 minutes ahead.
- 8a37b67: OpenAI pixel and Conversions API: an amount is no longer sent without a currency, at the event or the item level, since OpenAI requires a `currency` with every `amount`; `toMinorUnits` returns undefined without one. A custom event's `custom_event_name` is made valid by the new `oaiCustomEventName` (1–64 letters, digits, `_` or `-`, starting and ending with a letter or digit, not a standard event name): `Sign Up.Clicked` becomes `sign_up_clicked`, and an event whose name cannot be made valid is not sent. The pixel and the server name it the same way, so the two still deduplicate.
- 8a37b67: OpenAI pixel: `setOpenAIUser` sends the postal code as `postal_code`, the field the pixel documents, instead of `zip_code`, which it ignored. It also sends the hashed phone number, first and last name, and the region, normalized as OpenAI documents (the same `normalizeOAIPhone` / `normalizeOAIName` the Conversions API sender uses), and leaves the city's case to OpenAI.
- 8a37b67: Reddit Conversions API: an offline or undeterminable event is sent with `action_source: 'OTHER'` instead of `'UNKNOWN'`, which is not one of Reddit's values (`WEBSITE`, `APP`, `PHYSICAL_STORE`, `OTHER`). Website events now carry `event_source_url`, from which Reddit reads the domain and, when `click_id` is missing, the click id.

## 9.0.1

### Patch Changes

- ee39d8b: Stop losing the events a page holds when it is hidden or left, as GA4 and PostHog do. The session is now decided when an event is tracked, not when its batch is sent, and a `session_start` is queued right before the event that opened it. Events stay on the queue until the moment they are handed to `fetch`, so a send still waiting for the visitor or the rate limiter no longer holds them anywhere else. The new `sendPendingEvents` (exported, called by the web analytics hook on `visibilitychange` to hidden and on `pagehide`, before the engagement beacon) sends what is queued by `navigator.sendBeacon`, with the tags each event has settled on and no third-party trackers (no server ids to deduplicate them with); when no beacon can take the queue (a visitor the server does not know yet, no `sendBeacon`, a refused body) it is sent the usual way. Previously a page hidden within the 2-second batch delay lost its landing events and `session_start` while the engagement beacon still arrived. `Session.extend` no longer starts a session when none is stored, and `sendBeacon` sends nothing then. A failed batch puts its `session_start` back on the queue under its own session; a failed visitor request leaves the events queued instead of reporting them lost, and `trackAsync` then resolves at once rather than waiting for the next send (it still never rejects). A batch whose body would not fit keepalive's 64KB in-flight budget is sent without `keepalive` instead of failing outright. Engagement now counts from the session's first event rather than from its first batch.

  Beacons are now sent as `text/plain;charset=UTF-8` instead of `application/json`, so a cross-origin beacon is a CORS simple request with no preflight, which a page being closed often could not complete. **The events endpoint must accept `text/plain` before this version is deployed** — with `@shware/http`, use `zBeaconJson(createTrackEventSchema)` in place of `zValidator('json', …)`.

## 9.0.0

### Major Changes

- d2ecdbd: Name every ad click id and ad cookie tag after where it was read, and never fill one from the other. URL parameters keep their own names (`fbclid`, `gclid`, `wbraid`, `msclkid`, `rdt_cid`, `li_fat_id`, `oppref`, …) and are now read from the URL only: `gclid`, `wbraid`, `msclkid`, `rdt_cid` and `li_fat_id` no longer fall back to a cookie, so channel classification only ever sees this visit's click. The ad platforms' first-party cookies are kept raw under the cookie's name: `_fbc`, `_fbp`, `_gcl_aw`, `_gcl_gb`, `_uetmsclkid`, `_rdt_cid`, `_rdt_uuid`, `__oppref`, `__obref`, and `_li_fat_id` for LinkedIn's `li_fat_id` cookie. Breaking: the `fbc`, `fbp` and `rdt_uuid` tags are renamed to `_fbc`, `_fbp` and `_rdt_uuid`; queries reading `tags->>'fbc'` and the like need the new names. The Conversions API senders take the URL click id first and the cookie on a page without one — for Google all of `gclid` / `gbraid` / `wbraid` from the URL when it carries any, so a fresh click never goes out as an earlier one — and Meta keeps the `_fbc` cookie over a rebuilt `fbc` only when it was opened by the same `fbclid`. The old `fbc`, `fbp` and `rdt_uuid` are deprecated but still accepted by `tagsSchema` and read by the senders, for clients not yet upgraded.

### Patch Changes

- d2ecdbd: Tighten which click ids the Conversions API senders pass on. A `gclid` whose `gclsrc` marks it as Search Ads 360's (`ds`, `3p.ds`) is no longer sent to Google Ads, the same gating gtag applies to `_gcl_aw` (now shared as `isGoogleAdsGclid`), so it no longer hides a valid `_gcl_aw` click either. A URL `msclkid` not in the 32-hex shape of one is ignored in favour of the `_uetmsclkid` cookie. `parseFbc` reads `fb.<index>.<time>.<fbclid>.<appendix>`, the format Meta's Parameter Builder writes, with the fbclid as the fourth segment alone, so such a cookie is recognised as the same click instead of being rewritten with a new creationTime.
- d2ecdbd: Send the OpenAI Conversions API `user` object in the fields the API documents: the plural, hashed lists `emails_sha256`, `phone_numbers_sha256`, `external_ids_sha256`, `first_names_sha256`, `last_names_sha256` and the raw `regions`, `postal_codes`, `cities`, `countries`, from every email, phone number and address given rather than the first, normalized as documented. The singular `email_sha256`, `external_id_sha256`, `country`, `city` and `zip_code` it sent before are not in the API. Also sends the pixel's `__obref` cookie as `user.obref`, the GAID of Android events as `android_advertising_id`, and the pixel's `__oppref` cookie as `oppref` when the page URL carries none.

## 8.16.0

### Minor Changes

- 3e60fc5: Collect two more ad click ids from the landing URL: `oppref` (OpenAI's ChatGPT Ads) and `epik` (Pinterest Ads). Both name their channel in `classifyTouch` (`chatgpt`, `pinterest`), so an ad click without utm tags is a paid touch and not organic AI or a referral, and the OpenAI Conversions API events now carry `oppref`, which OpenAI matches conversions to clicks with. Snapchat's click id is read as `ScCid`, the case Snapchat appends it in (it was never captured before), and the tag is renamed from `sccid` to `ScCid` so that every click id tag is named after its URL parameter. `li_fat_id`, `ScCid`, `yclid`, `oppref` and `epik` are marked `'ads'` in `CLICK_ID_CHANNELS`. The pixels' `__oppref` / `_epik` cookies are not read: a click id names the visit's channel, and a cookie outlives the visit.
- 3e60fc5: `classifyTouch` no longer counts the `_fbc` cookie as a Meta click: it outlives the visit by 90 days, so it named later direct, search and email visits Meta. `fbclid`, read from the landing URL, still counts. A `utm_source` without a `utm_medium` is `cpc` when a click id of the same channel that its platform puts on ad clicks only came with it: `CLICK_ID_CHANNELS` entries gain a third element, `'ads'` or `'any'` (`fbclid` is `'any'`: Meta puts it on organic links too). Code destructuring `[key, channel]` is unaffected. `utm_source=th` (Meta's Threads placement) folds into `meta`. The comments record why a `utm_source` outranks a click id. Reclassify stored sessions after upgrading.

## 8.15.1

### Patch Changes

- 8315ea3: `botOf` no longer takes a page opened in Facebook's or Instagram's in-app browser for a bot when the app sends its requests with its own user agent (`[FBAN/…]`, `Instagram 445.0.0.34.44 (iPhone…) AppleWebKit/420+`); PostHog, GA4 and Matomo count these as people. Names ShapBot (Parallel, `ai_search`), Shap-User and QuillBot (`ai_assistant`), PromptingBot and Reflectionbot (`ai_crawler`), which were filed as `other`.

## 8.15.0

### Minor Changes

- 4f67386: Export a zero-dependency `botOf(tags)` from `@shware/analytics` that names and categorizes bot visitors from the request user agent, and send `tags.webdriver` from the web SDK when `navigator.webdriver` is true.

## 8.14.0

### Minor Changes

- 3410c8a: `createTrackEventSchema` corrects events stamped by a wrong client clock: an event more than a day from the server's time is moved onto it, together with the other wrong events of its batch by their latest one, keeping their order and spacing; the events on the right clock are left alone. A phone set to another year no longer writes its sessions into that year.

## 8.13.1

### Patch Changes

- 0d439e3: Upgrade dependencies and peer dependencies to their latest versions.
- Updated dependencies [0d439e3]
  - @shware/utils@1.6.2

## 8.13.0

### Minor Changes

- 5c91276: `@shware/analytics/attribution`: the channel rules learn what a year of production sessions left unassigned. `channelGroupOf` now applies GA4's source rules as well as its medium rules — `linkedin / (not set)` is `organic_social`, `google / (not set)` is `organic_search`, `email / promo` is `email` — and any medium that says email or newsletter (`outbound email`, `cold_email`) is email. A `utm_source` with the rest of the query glued on (`email&utm_medium=…`, `toolify/`) is read up to the junk, and `undefined` / `null` tag values count as absent. Meta's `{{placement}}` values as a medium (`META_PLACEMENTS`, Meta's documented list plus the ones seen: `facebook_mobile_feed`, `instagram_reels`, `whatsapp_status`, `an`, `others`, the unexpanded `{{placement}}`; listed one by one so a hand-tagged `instagram_stories` post is not an ad) are a paid Meta click whatever the source, and `pmax` is paid. `google ads` / `googleads` / `adwords` fold to `google`. The AI assistants get a channel group of their own, `organic_ai`: `chatgpt` (also `openai`), `perplexity`, `gemini`, `claude`, `copilot` (`copilot.com` too), `grok`, and the Chinese assistants `deepseek`, `doubao`, `kimi`, `qwen`, `yuanbao`, `ernie`, `zhipu`, by referrer or by ChatGPT's own `utm_source=chatgpt.com`, with `gemini.google.com`, `copilot.microsoft.com` and `yiyan.baidu.com` no longer read as Google, Microsoft and Baidu search. Products re-run their reclassification to apply this to history. The patterns themselves — `AD_LANDING_PAGE`, `PAID_MEDIUM`, `EMAIL_MEDIUM`, `REFERRERS_NOT_A_TOUCH`, the third column of `REFERRER_SITES`, and `ClassifyOptions.ownHosts` — are `RegExp` values now, not POSIX strings: since 8.12 they are read only by `classifyTouch`, no product generates SQL from them any more, and a regex literal needs no escaping convention. `.source` gives the text back if anything ever does. `REFERRERS_NOT_A_TOUCH` grows from the payment and Google / Apple / Microsoft sign-in hosts to the sign-in providers with a login host of their own (WeChat, Kakao, LINE, Naver, Yahoo, Twitch, X's OAuth 1.0a, Microsoft's login.live.com), the hosted auth services (Auth0, Okta, Supabase, Firebase, Clerk) and more payment hosts (PayPal, Alipay, Paddle, Lemon Squeezy), so a session that starts on the way back from a sign-in is not credited to it — and `nid.naver.com` / `login.yahoo.com` are no longer read as a search.

## 8.12.0

### Minor Changes

- d00dfa5: `@shware/analytics/attribution`: `classifyTouch(tags, options)` reads the tags a session arrived with as one touch — `channel`, `medium`, `channel_group`, `campaign`, `priority` — by the rules the vocabulary describes: an explicit `utm_source` (aliases folded), a click id, an ad landing page, the product's own rules (`options.rules`, e.g. a referral landing page), the referrer's host (search engines and social networks folded, payment / sign-in providers and `options.ownHosts` ignored), `(direct)` otherwise. `channelGroupOf(channel, medium)` is GA4's default channel grouping on its own. Products run this once when a session is written and store the result, instead of re-deriving it in a view per query.

## 8.11.0

### Minor Changes

- 4d342cc: `@shware/analytics/attribution`: `referral_program` joins `CHANNELS`, the channel of a product's own referral programme — a session that came through a member's link or code. How a product recognises one (a `/refer/<code>` path, a code entered at sign-up) differs too much between products to be a shared rule, so that stays with the product's `touchpoint`; the name is shared so dashboards agree. It is deliberately not `referral`, which is the channel group of any outside site.

## 8.10.0

### Minor Changes

- 2f8e209: `@shware/analytics/attribution`: the vocabulary attribution is built from, as data — `CHANNELS` and `CHANNEL_GROUPS` (GA4's default channel groups as identifiers), `SOURCE_ALIASES`, `CLICK_ID_CHANNELS` (every click id this SDK collects, mapped to its channel and checked against `AdvertisingInfo`), `REFERRER_SITES` (search engines and social networks by host pattern, with the medium GA4 gives them), `REFERRERS_NOT_A_TOUCH` (payment and sign-in hosts), `AD_LANDING_PAGE`, the paid / display / email medium rules, `TOUCH_SOURCES`, `REPORTED_TOUCH_KINDS` and `TOUCH_PRIORITY`. No SQL and no runtime code: a product's `touchpoint` view is generated from these, so a channel added here reaches every product on upgrade, and dashboards share the same names.

## 8.9.0

### Minor Changes

- e52ef6c: `distinct_id` is the server's: dropped from `updateVisitorSchema`, so the client no longer sends it, and added to `Visitor` as the person the visitor belongs to — its own id until someone signs in on it, the user's id from then on. Third-party user setters now receive `VisitorIdentity`, the PATCH payload plus the server's `distinct_id`; `setPosthogUser` identifies by it once a `user_id` is known and no longer identifies an anonymous visitor, since PostHog will not merge one identified person into another at sign-in. Pairs with the api release that maintains the column.

## 8.8.0

### Minor Changes

- 1301a5a: Drop `site_source_name` from `TrackTags`, the tag schema and the web tag capture. It was read from a URL parameter of that exact name, which Meta only sets when an ad's URL parameters spell out `site_source_name={{site_source_name}}`; the working convention is `utm_source={{site_source_name}}`, which lands the same value in `utm_source`, so the separate field was never populated. The server strips the key from a payload an older client still sends.

## 8.7.2

### Patch Changes

- 3097cde: On native, the install referrer's `utm_*` parameters are attached only on the install launch: the first launch that resolves the referrer claims them, with a marker of its own in storage, and every later launch sends the raw `install_referrer` without the utm fields. A launch that cannot reach the Play Store service, which is common right after an install, does not spend the claim, so a later launch still attributes the install. The referrer never changes, and it was spread into the tags of every launch, so every session of an Android install reported the install campaign as its own acquisition for as long as the app stayed installed; a report reading a session's tags could not tell the install from the thousandth open. iOS, which has no install referrer, is unchanged.

## 8.7.1

### Patch Changes

- 7a695e5: A `session_start` whose batch the server rejected goes out again with the session's next batch, under the same session id and with its original tags and timestamp. `fetch` already retries transient failures; this covers a batch rejected outright — one invalid event fails the whole batch, and the session's only attribution record with it — after which every later event of the session had no `session_start` to be attributed through. A session that has timed out in the meantime is not announced late: the carried-over start is dropped when the next batch opens a new session.
- 7a695e5: `session_start` carries the tags of the event that opened the session, captured when that event happened, instead of capturing its own at flush time. A batch is flushed up to two seconds after the landing, and a landing page that redirects inside that window — an ad landing page that sends the visitor on to sign-in, a router that strips the query string — stamped the session's one attribution record with the URL the utm parameters and click ids had already been stripped from, so the session looked like direct traffic.

## 8.7.0

### Minor Changes

- 9585143: Send `hashedFirstName` / `hashedLastName` in a LinkedIn conversion's `userInfo` instead of the plaintext `firstName` / `lastName` they replace, which version `202609` makes possible. The name no longer leaves the server in the clear, and the two plaintext fields are gone from `CreateLinkedinEventDTO`.

### Patch Changes

- 9585143: Move the LinkedIn Conversions API to version `202609`. Version `202509` was sunset and every call was failing with `426 NONEXISTENT_VERSION`, so no server-side LinkedIn conversion was being recorded. The `202609` schema also drops `ORACLE_MOAT_ID` as a user identifier type and adds `PLAINTEXT_IP_ADDRESS`, `SHA256_IP_ADDRESS` and `GOOGLE_AID`; `UserIdType` now matches it. The endpoint, headers and batch-create envelope are unchanged.
- 9585143: Drop a LinkedIn conversion event that carries no identifier LinkedIn can match on, instead of sending it. Validation fails such an element, and a failed element fails the entire batch — so one anonymous event used to discard every identifiable conversion travelling with it.
- 9585143: Normalize LinkedIn conversion identifiers before hashing them, as the Conversions API schema requires: an email is lower-cased with whitespace stripped, and a name additionally has its punctuation removed. An unnormalized hash is accepted by the API and then matches no member, so any value carrying capitals, padding or an apostrophe was being sent as an identifier that could never attribute.

## 8.6.0

### Minor Changes

- 8fc970c: The `Analytics` components fire Microsoft's ID Sync pixel themselves: pass `uetCustomerId` and the SDK visitor — the `anonymousId` of the events the server sends to the Conversions API — is synced once per visit, anonymous visitors included, since they are who remarketing audiences are built from. `setUETUser` re-syncs on sign-in with the user id hashed into `UID`, matching the server's `externalId`. `configureUET` and `syncUETVisitor` expose the same outside the components; a host no longer writes its own hook around `sendUETIdSync`.
- 8fc970c: `setUETUser` is the setter itself, not a factory: register it as `thirdPartyUserSetters: [setUETUser]`, not `[setUETUser()]`.

  It had copied the `setFBUser(pixelId)` shape, but UET has nothing to bind first — the snippet ties the queue to its tag — so the extra call was noise, and unlike `setGAUser`, which it now matches. The old form was published in 8.5.0 earlier the same day; any `setUETUser()` call must drop the parentheses.

## 8.5.0

### Minor Changes

- 1132186: Page views follow the industry line: a path _or query_ change is a new page, a hash change is not.

  `useWebAnalytics` had fired `page_view` on the pathname alone, so `?page=2` or `?q=shoes` never counted as a page — where GA4's enhanced measurement, Next.js's `usePathname` + `useSearchParams` pattern and PostHog's `history_change` all count it. The hook now takes the router's query string as a required second argument, and the `tanstack`, `next` and `react-router` `Analytics` components pass it (the Next one under its own Suspense boundary, as `useSearchParams` requires). The hash stays out: an in-page anchor is not a navigation.

  Tracking parameters — `utm_*` and the ad click ids `getTags` captures — are stripped before comparing, so a landing page that cleans them out of its URL with `replaceState` is not counted twice (`getPageKey`). `page_load_id` rotates on exactly the same changes, keeping every id pointed at a page view. `page_path` and `previous_page_path` remain paths; the query is in `page_location`.

- 218b5c4: The `Analytics` component of every framework entry (`tanstack`, `next`, `react-router`) takes a `uetTagId` and inlines Microsoft's UET snippet (bat.js, `enableAutoSpaTracking: true`), the way it already inlines the other vendors' tags. The tag owns page loads; `sendUETEvent` forwards everything else.

## 8.4.0

### Minor Changes

- a45741f: Every web event carries a `page_load_id` tag: one v4 UUID per page load, shared by all events of that page and replaced on a reload or a single-page-app route change — the same moments the SDK sends a `page_view`, so every id has a page view to point at. A module variable, deliberately not storage — the id must die with the page.

  The Microsoft Conversions API sender uses it as `pageLoadId` in CAPI-only mode (`pageLoads: true`), linking each `custom` event to the `pageLoad` event it happened on; with the UET tag on the page nothing is sent, since the tag reported the page load under its own id. `getMicrosoftEvent` takes `{ consent, pageLoads }` as its third argument; the bare consent value is still accepted.

## 8.3.0

### Minor Changes

- 105680a: Microsoft Advertising (Bing Ads) joins the browser trackers and the server-side senders: the UET tag via `sendUETEvent`/`setUETUser`, the Conversions API via `sendMicrosoftEvents`.

  Bing was the one paid channel this SDK had no tracker for, and Microsoft's Conversions API (CAPI) — its counterpart to Meta's — now has a published spec. Both channels are fed from the same `track()` call and deduplicate by construction: the browser pushes the internal event name as the UET action with the event id as `event_id`, the server sends the same name as `eventName` with the same id, which is exactly the (`tagId`, `eventName`, `eventId`) triple Microsoft deduplicates on.

  - **Browser** (`@shware/analytics/third-parties`): `sendUETEvent` maps events onto UET's gtag-shaped API — the GA4 event names this SDK already uses are the actions UET knows, so only parameter spellings change (`value` → `revenue_value`, `Item[]` → `items[]`); an unknown name goes out unchanged as a custom action for an event goal. `page_view` is left to the tag, which routes that action to its own page-load beacon and already fires it on load and on SPA navigations. `setUETUser()` hands the raw email/phone to the tag for enhanced conversions (the tag hashes them itself), `setUETConsent` drives consent mode, and `sendUETIdSync` fires the client-side ID Sync pixel CAPI needs for remarketing — `VID` is the SDK visitor id and `UID` the SHA-256 of the user id, the exact pair the server sends as `anonymousId`/`externalId`, which Microsoft requires to match.
  - **Server** (`@shware/analytics/server`): `sendMicrosoftEvents(token, tagId, events, data, options)` POSTs to `capi.uet.microsoft.com`, splitting batches at the API's 1,000-event limit, with `continueOnValidationError` on by default so one malformed event costs itself rather than its batch. Identifiers are hashed per Microsoft's rules — email dots and `+alias` stripped for every domain (`normalizeMicrosoftEmail`, byte-for-byte what bat.js does in the browser), E.164 phones, an anonymized `externalId` — `msclkid` is sent as the dashed UUID the API documents. Validation warnings that arrive with a 200 — a removed field, a skipped event — are logged, since the status code hides them. `page_view` events are skipped unless `pageLoads: true`, since the tag already reports page loads; that CAPI-only mode does not yet model `pageLoadId` or the revenue-only companion event a `pageLoad` needs for variable revenue.
  - **Click id persistence**: `resolveClickIdCookies` now manages `_uetmsclkid` — the UET tag's own cookie, in its own `_uet<id>` format (extracted from bat.js), so the tag and the middleware read each other's writes. The cookie is Microsoft's own ITP answer, but the tag writes it through `document.cookie`, which Safari caps at 7 days (24 hours on an ad-decorated landing page) and rewrites on every page; the middleware re-issues it over HTTP at the tag's own 90 days on each document response, so the HTTP copy is not downgraded on the next page. `getTags` falls back to it, so every event of the visit carries the click id, not just the landing page's. New exports: `parseUetMsclkid`, `formatUetMsclkid`, `formatMsclkid`, `UET_MSCLKID_COOKIE`; `ResolveClickIdCookiesResult` gains `msclkid`.

## 8.2.0

### Minor Changes

- b560c90: Google Ads click ids survive past the landing page: `resolveClickIdCookies` now manages `_gcl_aw`/`_gcl_gb`.

  Until now `gclid`/`wbraid` were read from the current page URL only, so every event after the landing page — and every returning visit — lost the click id, and the Data Manager API sender had nothing to upload for exactly the conversions it exists to recover. The click-id middleware now gives Google the same first-party HTTP persistence Meta and Reddit already had, in the pattern Google itself uses (the server-side Conversion Linker sets FPGCLAW via Set-Cookie for 90 days) and the sGTM ecosystem productized (stape Cookie Keeper re-issues `_gcl_*` over HTTP).

  - **gtag's exact cookie contract, extracted from gtag.js**: values are written as `GCL.<seconds>.<clickId>` (seconds, not `_fbc`'s milliseconds), click ids validated with gtag's own `/^[\w-]+$/`, and a `gclid` enters `_gcl_aw` only when `gclsrc` is absent or `aw.ds` — `ds`/`3p.ds` clicks belong to Search Ads 360, exactly as gtag gates them. `wbraid` routes to `_gcl_gb`.
  - **Ownership is shared with gtag, so the rules are stricter than for `_fbc`**: a value the module cannot parse is left untouched (never rewritten, never deleted), and a re-issue is byte-identical — labels tail included — at the window's _remaining_ lifetime, so the 90-day click window never slides and a long-expired click is never revived.
  - **The re-issue doubles as an ITP self-heal for gtag itself**: Safari caps JS-written cookies at 7 days (24h on ad-decorated landings); the HTTP re-issue on the next document response restores the full window for gtag's own conversion tracking too, whether or not the Data Manager sender is in use.
  - **Web tags fall back to the cookies**: `getTags` now reads `gclid` from the URL first, then a still-valid `_gcl_aw` (`wbraid` likewise from `_gcl_gb`), so every event of the visit — not just the landing page's — carries the click id into the event store the server-side senders read from.
  - New exports: `parseGcl`, `formatGcl`, `GCL_AW_COOKIE`, `GCL_GB_COOKIE`, `ParsedGcl`; `ResolveClickIdCookiesResult` gains `gclid` and `wbraid`.

  Consent note: hosts gating `resolveClickIdCookies` on consent signals keep doing so — with `ad_storage` denied, gtag deliberately writes none of these cookies, and neither should the middleware.

## 8.1.0

### Minor Changes

- 8ccef09: Google Ads joins the server-side senders: `sendGoogleAdsEvents` uploads conversions via the Data Manager API.

  Google conversions were the one channel still reported only by the browser — gtag reading its own cookie — while Meta, Reddit, OpenAI and LinkedIn already went out server-side from stored events. The new sender speaks `events:ingest` on the Data Manager API, Google's counterpart to Meta's Conversions API and the mandated successor to the Google Ads API's `UploadClickConversions` (closed to new adopters since 2026-06-15). Same shape as the rest of `@shware/analytics/server`: a pure per-event builder (`getDataManagerEvent`), a never-throws `sendEvents`, credentials in headers and never in a URL or a log line.

  - **Built for Google's hybrid setup** ("boost your tag with additional data sources"): point the config at the SAME conversion action the gtag tag reports to, and Google matches the two channels by `transactionId` — fed from `properties.transaction_id` with the event id as fallback, the same value gtag sends, so the ids agree by construction. A matched pair collapses into one conversion with the server data winning; an unmatched upload is a recovered conversion. Standalone conversion actions work too.
  - **Configured like the LinkedIn sender**: `{ purchase: 111 }` maps event names to conversion action ids; unconfigured events are skipped. Mixed-action batches go out as one request with one destination per action.
  - **Timed by the event**: `eventTimestamp` is `created_at` (RFC 3339 as stored — no format conversion). A queued or retried upload does not move the conversion.
  - **At most one click id per event**, `gclid` preferred over `gbraid` over `wbraid`. An event with no click id still uploads when it carries hashed identifiers — the enhanced-conversions match path; one with nothing to match on is skipped rather than costing the batch (the API has no partial-failure mode).
  - **Enhanced conversions**: emails and phone numbers from `UserProvidedData` are SHA-256 hashed per Google's rules — the gmail-only dot-and-plus stripping included (`normalizeEmail` is exported) — capped at the API's ten identifiers per event, declared with `encoding: 'HEX'`. EEA/UK/CH consent is forwarded via `options.consent`.
  - **Auth is just an OAuth2 access token** with the `datamanager` scope plus the Google Ads account id (dashes tolerated; delegated access via `loginAccountId`). No developer token, no API Center approval — the caller exchanges its stored refresh token for the access token and stays in charge of refresh, the way it holds the tokens for every other sender.

## 8.0.0

### Major Changes

- Move the `facebook-nodejs-business-sdk`-based Meta sender out of `./server` into a new `./server/legacy` entry, so importing `@shware/analytics/server` never pulls the 31MB SDK into a serverless bundle. The SDK-free sender previously exported as `sendMetaConversions` is renamed to `sendMetaEvents` and is now the `./server` export of that name.

  Migration: keep the old behavior with `import { sendMetaEvents } from '@shware/analytics/server/legacy'`, or drop the SDK by staying on `@shware/analytics/server` (note the new options-object signature). Callers of `sendMetaConversions` rename it to `sendMetaEvents`.

## 7.6.0

### Minor Changes

- A lightweight Meta Conversions API sender: `sendMetaConversions`.

  Built on `capi-param-builder-nodejs` (0.5MB, zero dependencies) and plain `fetch` instead of `facebook-nodejs-business-sdk` (31MB, axios and Node built-ins), which makes it bundleable for Lambda at ~28KB and actually runnable on edge runtimes like Cloudflare Workers. `sendMetaEvents` and the business-SDK path are untouched; this is the drop-in successor hosts opt into.

  The wire payload is byte-identical to what the business SDK's `ServerEvent.normalize()` produces — every hash, the deduplicated multi-value lists, the sparse extinfo object — enforced by a differential test suite plus a 120-case seeded fuzz that runs both builders over the same events, and by known-vector tests pinning each normalization rule to a concrete SHA-256. Where the two vendor libraries normalize differently (names with punctuation, accented cities, non-US postal codes), the sender sides with the business SDK so switching cannot change a single hash Meta receives.

  Differences by design, all on invalid input only: a malformed field (bad email, non-ISO country code, letters in a phone number) is dropped or forwarded hashed instead of throwing away the whole batch, and an unknown currency is uppercased and forwarded instead of rejected. `action_source` is derived from each event's `platform` — a backend-built offline conversion declares `platform: 'unknown'` and lands in Meta's `other`, exactly where the old explicit `'offline'` argument put it. The access token travels in the JSON request body, never in the URL and never in logs, and the retry/backoff behavior of the shared fetch wrapper applies.

## 7.5.1

### Patch Changes

- Server-side conversions keep a page URL while older clients are still out there.

  `source_url` became `page_location` in 7.0.0. A backend upgrades in one deploy; the browser bundles talking to it do not — a tab opened before the deploy keeps sending the old name until someone reloads it, and `tagsSchema` strips keys it does not declare, so those events reached the senders with no URL at all. Meta lost `event_source_url` and OpenAI lost `source_url` for every one of them, which costs match rate for as long as the old bundles are alive.

  `source_url` is accepted again as a deprecated tag and read as a fallback by the two senders that need it. `page_location` still wins when both are present.

  Transitional: delete `server/page-location.ts` and the `source_url` entries in `tagsSchema` and `PageInfo` once no client is sending the old name. Stored rows can be checked for it.

## 7.5.0

### Minor Changes

- Applications can type their own event properties, including on GA4's standard events.

  `TrackProperties` resolved standard events to a closed shape and everything else to an open record, which left no room in between. An application with a custom dimension on `begin_checkout` — say a `type` separating expansion revenue from new revenue — had to cast past the standard shape to attach it, and casting is how the standard properties lose their own checking too.

  `CustomEventProperties` is an empty interface applications fill by declaration merging:

  ```ts
  declare module '@shware/analytics' {
    interface CustomEventProperties {
      // Extra properties on a standard event, merged with its own.
      begin_checkout: { type?: 'new_purchase' | 'upgrade' };
      // The whole shape of an event the application defines itself.
      schedule_plan_change: { direction: 'upgrade' | 'downgrade'; effective_at: string };
    }
  }
  ```

  Keyed by event rather than one flat set of properties, so a dimension cannot leak onto events it means nothing on. Note what "custom" attaches to: the properties, not the event — `begin_checkout` is one of GA4's recommended events and stays one.

  Nothing changes for an event nobody declares. The empty case intersects with `unknown`, the identity of `&`, so those events resolve to exactly the type they did before; six of the nine new tests are negative assertions guarding that, since the risk in a change like this is quietly relaxing checks rather than failing to add them.

## 7.4.0

### Minor Changes

- Three collection gaps, found by reading what gtag.js does that we did not.

  - **The events request is sent with `keepalive: true`.** A batch waits up to two seconds before it goes out, and gtag runs every hit through a transport that survives unload — beacon or keepalive fetch — while ours died with the page: closing the tab inside the batch window aborted the request and lost every event in it, on top of whatever the `pagehide` beacon separately covers. The body stays far below keepalive's 64KB in-flight budget at the schema's 100-events-per-batch cap.
  - **`gbraid` is collected alongside `wbraid`.** Google splits post-ATT iOS attribution across the pair — `wbraid` for web-to-app, `gbraid` for app-to-web — and gtag handles both; we captured only `wbraid`, so campaigns landing with `gbraid` lost their click id at the first navigation.
  - **A nested item list is capped at 200 entries**, GA4's own item limit, truncated rather than rejected like every other property limit here. The value and key limits closed the batch-killing holes in 7.2.0; an unbounded `items` array was the one field left that could still blow a payload up.

## 7.3.2

### Patch Changes

- Fix four data-quality bugs found while building out the test suite:

  - `setFBUser` sent the street address in Meta advanced matching's `st` (state/province) field; it now sends `address.region`, matching the server-side Conversions API mapping.
  - `normalize` in the Meta mapper stripped every letter "s" from city/state/country (the character class was `[s/-]` instead of `[\s/-]`), turning "San Jose" into "an joe".
  - A 90% scroll crossing with zero engaged time (e.g. a restored scroll position in an unfocused window) permanently consumed the page's one-shot scroll flag, so the page could never report a `scroll` event; the flag is now only consumed once the event is actually sent.
  - Calling `track` with options that leave out `enableThirdPartyTracking` (e.g. just `{ onSucceed }`) silently switched third-party forwarding off; only an explicit `false` disables it now.

## 7.3.1

### Patch Changes

- Session housekeeping, no behaviour change.

  `Session.startTime` is now `lastTickTime`. It is where the engagement accumulator last settled up and is rewritten on every tick, so it never marked when the session began — a claim the 5.1.2 notes made and nothing in the code supported. `isVisible()` and `isFocused()` are removed, having never had a caller.

  The `getSession` docblock stops promising more than the lazy construction delivers. Deferring it lets the module be evaluated on a server, which is all it does: this instance, `cache` and `config` are module singletons, so calling `track()` on a server would share one session and one visitor across every request an isolate serves. The README now says so under **Client-side only**.

## 7.3.0

### Minor Changes

- A session now survives the page it started on.

  `Session` kept its id and its clock in memory, so a session lasted exactly as long as one document: a full page load started a new one, a second tab was a second session, and closing a tab and returning a minute later counted as two. Sessions were being counted per page view rather than per visit — events per session came out too low and session counts too high, and neither could be repaired after the fact.

  The identity and the timeout clock move into `config.storage`, which is `localStorage` on the web and the SQLite-backed shim on React Native, and is where `visitor_id` already lives. Every batch does one read-modify-write of that record — read the session, start a new one if it has timed out, stamp it, write it back — which is what GA4 does with its `_ga_<container>` cookie for every event it sends. Caching it in memory instead is what put the tabs out of step to begin with. Where storage is unavailable the wrapper's in-memory fallback takes over and sessions behave as they did before.

  Stored as `1.<id>.<lastEventTime>`: compact and cookie-safe rather than JSON, so a host that wants one session across its subdomains can hand `setupAnalytics` a cookie-backed `storage` without the format having to change. The leading version guards a change the parser could not otherwise survive; a field appended to the end does not need one.

  The timeout is measured from the events themselves rather than from the moment their batch goes out. A tab frozen in the background holds a batch far longer than the two seconds `track` aims for, and those events belong to the session they happened in, not to whichever one is current when the tab wakes up. `session_start` carries the timestamp of the event that opened the session for the same reason.

  Three changes follow from it:

  - **The hooks no longer send `session_start` themselves.** It was right when every page load was a new session; now a reload inside the timeout continues one, and the event would be a fiction. `sendEvents` emits it, at the front of the batch that opened the session — the only place that knows.
  - **A session that times out no longer inherits the engagement its predecessor never reported.** GA4 clears the same counter when it starts a session.
  - **`focus`, `pageshow` and becoming visible no longer extend the timeout.** GA4 measures it from the last event and nothing else, and the stored field means what its name says.

  `session_number` is deliberately not stored. GA4 counts sessions on the client because it has no visitor-level backend to ask at collection time; ranking `session_id` — a uuidv7, so ordered by time — over `visitor_id` or `user_id` answers the same question from stored events, and answers it across devices, which a per-device counter cannot do at all.

### Patch Changes

- `sendBeacon` no longer throws away the events it exists for.

  It refused to send unless `cache.visitor` and `cache.tags` were both populated, and those are per-document caches filled by the first batch's round trip. The beacon runs on `pagehide` and on the page becoming hidden, carrying the engagement time a visit accrued — so a visit short enough to end before its first batch came back had that engagement dropped in full, which is precisely the visit whose duration a bounce or landing-page report cares about most.

  The visitor id is persisted, and has been since the visitor was created, so a returning visitor already has one in storage before `getVisitor` has finished anything on this page; the beacon falls back to it. Tags fall back to an empty set rather than blocking the send — every field in `tagsSchema` is optional, and an event with no browser details is worth more than no event. A visitor with nothing stored is still skipped, since the server has no such visitor to attach anything to.

## 7.2.1

### Patch Changes

- Dependency upgrades: `uuid` 14.0.2 and `web-vitals` 6.2.0.

  The peer floors move up too — `@react-native-firebase/analytics` 26.3.2, `@tanstack/react-router` 1.170.32, `@tanstack/react-start` 1.168.49, `expo-crypto` 57.0.2, `next` 16.3.3 and `posthog-js` 1.419.4. All stay within their existing major, so a host already on a recent version of any of them is unaffected.

- Updated dependencies
  - @shware/utils@1.6.1

## 7.2.0

### Minor Changes

- One unusable property no longer costs the batch it travelled in.

  `createTrackEventSchema` validates a whole batch at once, and zod fails the entire parse when a single element fails — so one property that broke a limit took up to ten events down with it, plus whatever the client had queued behind them, and the client saw a 400 it could do nothing about. The limits themselves were the trigger: a value over 512 characters, a key over 128, more than 64 properties on one event. Values that overrun are exactly the ones derived from the page — a link's text, a URL carrying a long query — which no client can bound in advance, and no amount of care in a new SDK helps the versions already deployed in cached bundles and shipped apps.

  The property schemas now drop what does not fit instead of refusing it:

  - A string value over 512 characters is truncated. A shortened value is worth more than a lost batch.
  - A key that is empty or over 128 characters is dropped, and the event keeps its other properties. Keys are written by hand in instrumentation code, so an unusable one is a mistake in the host rather than something a visitor typed — but the mistake should cost that property, not the batch it happens to be in. Truncating a key is not an option, since two long keys would silently become one field.
  - Beyond 64 properties, the first 64 in insertion order are kept.

  This applies to event properties, to the nested item lists inside them, and to visitor properties, which had the same three limits written out twice. Key trimming, which the key schema used to do, still happens.

  Parsing valid payloads got faster rather than slower, which is the usual worry with a change like this: 22% on a typical eight-property event, 26% on a full ten-event batch, 29% on an event carrying 64 properties — measured against the previous schema on the same inputs, with both producing identical output. The strict version ran three checks through zod's pipeline for every key and another for every string value, plus a refine over the whole object; that is now one plain loop over the entries and a single `slice` per value, so the saving grows with the number of properties.

  A value of an unexpected _type_ still fails the batch. That is a wrong call rather than an overlong string, and there is no shortened form of it to keep.

  Separately, `useOutboundClickAnalytics` now sends at most 100 characters of `link_text`. An anchor can wrap a whole card, so its text runs to kilobytes of markup content that no report reads; 100 is what GA4 keeps of a text event parameter. This is about not shipping the bytes at all, not about the transport limit, which sits well above it.

## 7.1.1

### Patch Changes

- A third-party tracker can no longer take the rest of a batch down with it.

  `sendEvents` runs the registered `thirdPartyTrackers` inside the loop that hands each event its id, and that loop drains the queue with `shift`. A tracker that threw — a pixel script blocked by an extension, `posthog` reaching for `window` during SSR, a vendor global that never loaded — escaped to the catch below, so events the server had already accepted were reported to `onError`, while the ones ahead of them in the same batch had already been told they succeeded, and every tracker after the throwing one was skipped. Each tracker is now called inside its own try/catch and a failure is logged and stepped over. `setVisitor` does the same for `thirdPartyUserSetters`, where a throw also skipped the visitor cache write and rejected a call whose PATCH had already succeeded.

  The functions that could throw during server rendering now guard against it the way the rest of the trackers already did: `sendGAEvent`/`setGAUser` and `setRedditUser` check for `window` before the vendor global they were already testing, and `sendPosthogEvent` checks for `document`. `document` rather than `window` because React Native defines `window` as an alias of `global` — a window check passes there and then throws on `window.location`, which has no such alias. The others reach a vendor global that React Native never has, so they return before touching `location`.

  Also documents why `sendFBEvent` and `sendRedditEvent` each branch into two identical calls: `fbq` and `rdt` are overloaded per event type, and narrowing the union the mapper returns is what selects a single overload. Collapsing the branches, which is the obvious tidy-up, makes the call match none of them.

## 7.1.0

### Minor Changes

- Server-side conversions are timestamped with the event's own time, not the moment the request goes out.

  All four senders stamped `Date.now()` — Meta `event_time`, Reddit `event_at`, OpenAI `timestamp_ms`, LinkedIn `conversionHappenedAt` — while `TrackEvent.created_at`, which carries when the event actually happened, was never read by any of them. That is only harmless when the backend forwards each event the instant it arrives. Behind a queue, a retry, or a nightly batch, every conversion was dated to whenever the backend got round to it: the attribution window was measured from the wrong end, events already past the seven-day limit that Meta, Reddit and OpenAI all enforce looked fresh instead of being rejected, and the timestamp drifted away from the browser pixel's copy of the same conversion, which is timed correctly.

  Each sender reads `created_at` instead. It is a required field on `TrackEvent`, carried straight from the stored event, so there is nothing to fall back to: a caller that omits it now fails the request rather than silently having every conversion dated to the moment it was forwarded.

  Meta's synthesized `_fbc` moves with it. Where the tags carry a raw `fbclid` but no `_fbc` cookie, the sender builds one, and Meta's own instruction for that case is to use "the timestamp when you first observed or received this fbclid value" — the event's time is the closest the server has, and unlike `Date.now()` it does not move when a queued batch finally goes out. It now goes through `formatFbc` from the click-id module rather than repeating the format inline.

  `sendTestEvent` keeps `Date.now()`: it invents an event rather than forwarding one.

### Patch Changes

- `useWebAnalytics` no longer leaks its checkpoint listeners.

  The `mousedown`/`keydown`/`touchstart` listeners that keep the engagement accumulator up to date were registered with `capture: true` and removed without it. `removeEventListener` only matches a listener registered with the same capture flag, so all three stayed attached after the effect was cleaned up, and since the throttled handler is rebuilt on every effect run, each mount left another set behind — permanently, on `window`, referencing a throttle that had already been cancelled.

  Nothing was visibly wrong while the hook stayed mounted for the life of the page, which is the usual arrangement. A host that mounts it inside a subtree that unmounts and remounts accumulated a set per mount.

## 7.0.1

### Patch Changes

- Fixes in the send path, all of them failure modes that were silent and none of which the caller could see.

  - **A failed visitor request no longer disables tracking for the page.** `getVisitor` cleared its in-flight promise only after a successful await, so a rejection left the rejected promise in `visitorFetcher` and every later call re-threw the same failure. `sendEvents` awaits a visitor for every batch, so one failed request stopped the page from reporting anything until it was reloaded. The reset moved into a `finally`. `createVisitor` also parsed the body without checking the status: a 5xx whose body was JSON produced a `Visitor` with no `id`, which was then cached and sent as `visitor_id: undefined` on every subsequent batch, each rejected by the events schema. It throws on a non-ok response now.
  - **A link lookup that comes back empty is retried.** The per-page cache added in 7.0.0 kept a null answer forever, and `getLink` answers null for a network failure as well as for a link that does not exist — so one failed lookup dropped the `?s=` link's utm params from every later event on the page. The once-per-batch call it replaced would have retried on the next flush.
  - **The web device id goes through `config.storage`.** `getDeviceId` touched `localStorage` directly, on two counts wrongly. It bypassed the store the host passed to `setupAnalytics`, so a host that supplied its own kept `device_id` in `localStorage` while `visitor_id` and `first_visit_time` went where it asked. And the default `storage` export wraps those calls in try/catch precisely because reading site data throws in a third-party iframe, in some embedded webviews, and wherever the browser blocks it — the throw propagated out of `getTags`, so those visitors produced no tags at all. The id now lands in the same store as every other key, falling back to an in-memory map when the read throws.
  - **A short response no longer throws mid-loop.** The loop handing each event its id read `data[index].id` unguarded while draining the queue with `shift`, so a response with fewer ids than events threw partway through: the events already shifted off had been told they succeeded, and the catch reported failure to whatever was left. It reads `data.at(index)?.id` now and reports success without an id, which the callback's optional argument already allowed for.
  - **A batch that fills up cancels its pending timer.** Reaching `batch` sent the queue and returned without touching the timer the previous push had armed, leaving it to wake up later and flush an empty queue. Both paths go through one `flush` now. No visible change beyond the wasted wakeup: the next push already cleared the stale timer before arming its own.

## 7.0.0

### Major Changes

- Tags are captured when the event happens, not when its batch is sent.

  `track()` queues events and flushes them up to 2 seconds later, or once 10 have piled up, and `sendEvents` called `config.getTags()` once at that point for the whole batch. A single page app that navigated inside that window therefore stamped every pending event with the URL of the page the user had already left — the events immediately before a route change, which are usually the interesting ones. `getTags` also ran after the rate limiter's wait, widening the gap further.

  `getTags()` is now called by `track()` at the moment the event is queued, and each event carries its own tags to the flush. The contract is "the tags as of now, for this event". Nothing changes on the wire: a batch already serialized a full copy of the tags per event, since JSON has no references.

  Implementations have to be cheap enough to run per event, and two shipped ones were not:

  - `@shware/analytics/web` resolved the `?s=` link with an uncached `getLink()` request. It is now cached per link id for the lifetime of the page, and the page fields are read before that lookup is awaited — otherwise the await would reintroduce the very skew this change removes.
  - `@shware/analytics/native` called `getIosIdForVendorAsync()` and `getInstallReferrerAsync()` on every call. Neither answer changes while the app runs, so both are resolved once and the promise reused; a failed lookup is not cached, so the next event retries.

  A host that passes its own `getTags` should check the same thing: no network request, no unmemoized native call. If it throws, the event is now sent with the last built tags instead of taking the batch down with it, since the promise sits in the queue with nothing awaiting it and an unhandled rejection would surface as a global error first.

  `sendBeacon` still uses `cache.tags`, the last tags built by any of these calls. It runs during `pagehide`, where building fresh tags is not worth the risk of losing the event.

- The `source_url` tag is now `page_location`, and `page_title` joins it.

  The tag layer's page fields were named from two vocabularies at once: `page_referrer` after GA4, `source_url` after Meta's `event_source_url`. GA4 is the better fit for both, because it describes what this layer actually is — gtag sends `page_location`, `page_referrer` and `page_title` with _every_ event, not only with `page_view`, and exposes `page_location` as a global `gtag('set', ...)` value. That is exactly what a tag is here. The Meta and OpenAI mappings are one line each, written once; a tag name is typed into report queries for years, and `page_location` next to `page_referrer` reads as one pair.

  `SourceInfo` is accordingly renamed to `PageInfo` and now holds `page_location`, `page_referrer` and `page_title` — the same three fields gtag sends. It was never exported from an entry point, so only the shape matters. `page_title` is new, filled from `document.title` by `@shware/analytics/web`.

  No page path is stored: GA4 does not send one either, deriving that dimension from `page_location` in reporting. `split_part` at query time costs less than a second source of truth that can disagree with the URL.

  Migration:

  - Report queries move from `tags->>'source_url'` to `tags->>'page_location'`; `COALESCE` the two for as long as rows written by older SDKs still matter.
  - Hosts passing their own `getTags` should rename the key. Nothing breaks loudly if they miss it — `TrackTags` has an index signature, and `tagsSchema` strips unknown keys — but `source_url` will be dropped at the boundary, and Meta's `event_source_url` and OpenAI's `source_url` will go out empty, which degrades both match rates.
  - `page_location`, `page_referrer`, `page_title` and `page_path` stay on the `page_view` and `first_visit` properties as before. They are redundant with the tags now, deliberately: they are convenient to query without reaching into the tag blob.

## 6.0.0

### Major Changes

- The `source` tag is gone. Every conversions API's action source is now derived from `event.platform`.

  `TrackEvent` has carried `platform` and `environment` as top-level fields since 5.0, so they could be queried as columns instead of being dug out of a JSON blob — but nothing server-side ever read them. All three senders classified the event from `tags.source` instead, a tag with exactly two producers: `@shware/analytics/web` hard-coded `'web'`, `@shware/analytics/native` hard-coded `'app'`. Both are restatements of the platform the host already declares in `setupAnalytics`, sent on every event, and trusted from the client without ever being checked against it.

  `source` is therefore removed from `SourceInfo`, from `TrackTags`, and from the tags schema. `server/action-source.ts` derives the value instead:

  | `event.platform`            | action source |
  | --------------------------- | ------------- |
  | `web`                       | `web`         |
  | `ios`, `android`            | `app`         |
  | `macos`, `windows`, `linux` | `app`         |
  | `unknown`                   | — (see below) |

  This fixes the meaning of the desktop platforms rather than preserving it: previously the answer came from which entry point the host imported, so an Electron app on `@shware/analytics/web` was a website and a React Native desktop app was an app, with `platform: 'macos'` having no say either way. Now `platform` decides. **A host that declares `macos`/`windows`/`linux` is declaring a desktop app**; a page running in a webview that wants website semantics should declare `platform: 'web'`.

  Offline conversions are not derivable — `offline` describes how a conversion was collected (in store, imported from a CRM, taken over the phone), not what device it came from, and those events are built by a backend rather than reported by a client SDK. It is now an explicit trailing argument on the senders instead of a value a client could put in a tag:

  ```ts
  sendMetaEvents(accessToken, pixelId, events, data, appPackageName, 'offline');
  sendRedditEvents(accessToken, pixelId, events, data, testId, 'offline');
  sendOpenAIEvents(apiKey, pixelId, events, data, validateOnly, 'offline');
  ```

  The argument is typed `EventActionSource` (`'web' | 'app' | 'offline'`), exported from `@shware/analytics/server`, and overrides the derived value when present. It reaches OpenAI as `action_source: 'offline'`. Meta has no generic offline value — `physical_store` and `system_generated` are narrower claims only the caller can make — so it lands in Meta's `other`, and Reddit, which documents `WEBSITE` and `APP` only, receives `UNKNOWN`.

  Also fixed: a Meta server event whose action source could not be determined left `action_source` unset, and Meta requires the field. It now falls back to `other`.

  Migration:

  - Hosts that pass their own `getTags` should drop `source` from it. Nothing breaks if they don't — `TrackTags` has an index signature, so it still type-checks, and `tagsSchema` strips unknown keys, so the value is silently discarded server-side. Make sure `platform` in `setupAnalytics` is right instead, since it now decides how conversions are classified.
  - Backends that read `tags.source` from stored events should read the `platform` column. Rows written by older SDKs keep their `source` tag; it is redundant with `platform` for all of them.
  - `@shware/analytics/web` also stopped putting `platform` and `environment` into its tags. Neither was ever declared in `tagsSchema`, so both were already being stripped before they reached storage; this only removes the dead weight from the request body.

## 5.1.2

### Patch Changes

- Nothing is constructed at module scope anymore, so the package can be evaluated on Cloudflare Workers.

  Two module-scope singletons made importing the SDK fatal in a Worker. `setup/session.ts` ended in `export const session = new Session()`, and that constructor calls `uuidv7()`, which reads `crypto.getRandomValues`. `track/index.ts` had `const tokenBucket = new TokenBucket(...)`, whose constructor starts a refill `setInterval`. Workers forbid both outside a request handler, because module scope is evaluated once when the isolate boots and is then shared by every request it serves:

  ```
  Disallowed operation called within global scope. Asynchronous I/O
  (ex: fetch() or connect()), setting a timeout, and generating random values
  are not allowed within global scope.
  ```

  Every entry point reaches `track()`, so a host that server-renders on Workers — TanStack Start, Next, or React Router deployed to Cloudflare — took the throw while the isolate was starting, before any component rendered: a 500 on every route, not just the tracked ones. It stayed invisible in `vite dev`/`next dev`, where SSR runs in Node and a module-scope `getRandomValues` or `setInterval` is unremarkable; it only appeared under `wrangler dev` or in production. The workaround was to keep the SDK out of the server bundle by hand, importing it dynamically behind a mounted check — which also pushed `<Analytics gaId>`'s gtag snippet past hydration, exactly the delay a Tag Gateway exists to avoid.

  Both are now created on first use, by `getSession()` and internally by the first send. Importing the module runs nothing, so `<Analytics>` and `track()` can sit in a server-rendered tree again; `dist/index.mjs`, `dist/web/index.mjs` and `dist/tanstack/index.mjs` were verified to boot under `wrangler dev`. `session.startTime` is also more honest: it marks when the session began rather than when the isolate happened to start.

  `session` was never part of the public API — no entry point re-exported it and `./setup/session` is not in the `exports` map — so nothing changes for consumers.

## 5.1.1

### Patch Changes

- `sendMetaEvents`/`sendMetaEvent` no longer reject when Meta rejects the batch. Every other conversion sender in `@shware/analytics/server` logs the failure and resolves, so a host that fans out to all of them with `Promise.all` had its request fail whenever Meta alone returned a 4xx — most often locally, where an event carries no `fbp`/`fbc` and no client IP and Meta answers `error_subcode: 2804050` (customer information parameters missing or too broad). Meta failures are now logged in the same shape as the Reddit and OpenAI senders, and only the response body is logged: the raw SDK error also carries the access token in its `url`.

## 5.1.0

### Minor Changes

- Refresh `visitor.tags` on every visit. A returning visitor was fetched with `GET /visitors/:id`, which sends no body, so the only thing that ever wrote `tags` again was `setVisitor` — and hosts call that when they identify a user. Anyone who never signed in therefore kept the browser, screen, and release captured on their first ever page load, leaving `tags` permanently equal to `initial_tags`. The lookup is now a `PATCH` carrying the current `getTags()`, so `tags` is genuinely last-touch. It replaces the existing request rather than adding one.

  Backends need to be ready for it: `PATCH /visitors/:id` now runs on every visit, not just at identify, and any side effect that previously lived on the `GET` (server-derived fields such as IP geolocation) has to move there too, or it will silently stop being refreshed. Derive those fields after merging the client's tags so a caller cannot spoof them.

## 5.0.0

### Major Changes

- `useTrackImpression` drops its element type parameter and returns a callback ref: the signature is now `useTrackImpression<T extends EventName>(name, properties?): RefCallback<Element>`.

  The old signature `<R extends Element = HTMLDivElement, T extends EventName = EventName>` put two independent axes in one type-argument list. TypeScript has no partial type-argument inference, so writing `useTrackImpression<HTMLDivElement>(...)` to name the ref element silently pinned `T` to its loose `EventName` default and bypassed the standard-event payload typing (e.g. `view_promotion`'s required `items`) — and lint autofixes that strip a type argument equal to its default re-broke inference the other way. A callback ref is contravariant in the element type, so it attaches to any element without an `R` parameter; `name` is now the only inference site and explicit type arguments are never needed.

  Also fixes a missed-impression bug: the old implementation observed `ref.current` from an effect keyed on `[ref.current]`, which never re-runs when a ref mutates, so elements that mounted after the first render were never observed. The node now flows through state, and late-mounted elements are tracked.

  Migration:

  - Remove explicit type arguments: `useTrackImpression<HTMLDivElement>('view_promotion', p)` → `useTrackImpression('view_promotion', p)`.
  - Payloads for GA4 standard events are now actually type-checked; `view_promotion` requires `items: (Item & PromotionItem)[]`.
  - The return value is a `RefCallback<Element>`, not a `RefObject` — code reading `.current` from it must create its own ref and compose the two.

## 4.2.0

### Minor Changes

- Support `@react-native-firebase/analytics` 26 and `web-vitals` 6.

  - RNFB 26 made the modular `logEvent` fire-and-forget (`void` instead of `Promise<void>`), so `sendFirebaseEvent` no longer awaits it. The function itself stays `async` and callers that await it keep compiling; the await simply no longer tracks the native call, which RNFB does not report on either. Peer range moves to `^26.0.0`.
  - `web-vitals` moves to `^6.0.1`. `Metric` gains `navigationId` and `'soft-navigation'` as a `navigationType`, so a reporter that exhausts `navigationType` needs the extra branch. `useReportWebVitals` reports the same CLS, LCP, INP, FCP and TTFB and does not opt into `reportSoftNavs`, so soft navigations still produce no metrics at runtime.
  - Peer ranges follow their upstreams: `next@^16.2.12`, `posthog-js@^1.409.5`, `react-native@^0.86.2`, `react-router@^8.3.0`, `@tanstack/react-start@^1.168.34`.

## 4.1.0

### Minor Changes

- remove deprecated fields and schema

## 4.0.1

### Patch Changes

- fix: bundle bowser into dist (tsdown `noExternal`) to fix ESM/CJS interop. bowser's entry points (`main`/`browser`) resolve to the CJS-only `es5.js` with no `exports` map, so any environment that loads the package as raw ESM — e.g. Vite dev with the package excluded from `optimizeDeps` (TanStack Start does this transitively via `clickIdMiddleware`'s `@tanstack/react-start` import) — threw `SyntaxError: The requested module 'bowser/es5.js' does not provide an export named 'default'` and broke client hydration. The published dist no longer imports `bowser`, so consumers need no `optimizeDeps` workaround; `bowser` moved from dependencies to devDependencies. (Same fix as 3.8.3, ported to the 4.x line.)

## 4.0.0

### Major Changes

- Persist Meta `_fbc` and Reddit `_rdt_cid` click-id cookies server-side instead of on the client.

  **BREAKING:** the client-side `useClickIdPersistence` hook has been removed and the `Analytics` component no longer writes `_fbc`/`_rdt_cid` via `document.cookie`. To keep click-id persistence you must now set these cookies server-side — either register `clickIdMiddleware` on TanStack Start, or call `resolveClickIdCookies` in your framework's request handler. Apps that don't migrate will lose `_fbc`/`_rdt_cid` persistence.

  New server-side APIs:

  - `resolveClickIdCookies` (plus `parseFbc`, `formatFbc`, `toSetCookieHeaders`) from `@shware/analytics/server` — a framework-agnostic helper that sets `_fbc`/`_rdt_cid` on the document response following Meta's conditional-write rule: write on a new or changed `fbclid`, preserve the original `creationTime` otherwise, and clear values older than 90 days. This resolves the Events Manager "expired fbclid" warning and keeps the cookie alive for the full 90 days in Safari, where a JavaScript-set cookie on an fbclid-decorated landing page is capped to 24 hours.
  - `clickIdMiddleware` / `createClickIdMiddleware` from `@shware/analytics/tanstack` — a TanStack Start request middleware that wraps the helper and sets the cookies on the document response (with `Cache-Control: private, no-store`). `refresh` defaults to `true` as a best-effort ITP self-heal.

## 3.8.3

### Patch Changes

- fix: bundle bowser into dist (tsdown `noExternal`) to fix ESM/CJS interop; `bowser` moved from dependencies to devDependencies. See 4.0.1 for details.

## 3.8.2

### Patch Changes

- update visitor schema
- Updated dependencies
  - @shware/utils@1.5.1

## 3.8.1

### Patch Changes

- update properties field

## 3.8.0

### Minor Changes

- add visitor.tags

## 3.7.0

### Minor Changes

- update deps, ts 7, tsdown

### Patch Changes

- Updated dependencies
  - @shware/utils@1.5.0

## 3.6.4

### Patch Changes

- update deps, fix oxlint, add page_referrer
- Updated dependencies
  - @shware/utils@1.4.5

## 3.6.3

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.4

## 3.6.2

### Patch Changes

- refresh legacy system id to UUID v7

## 3.6.1

### Patch Changes

- ignore non ad events

## 3.6.0

### Minor Changes

- add openai pixel and conversions api

## 3.5.2

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.3

## 3.5.1

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.4.1

## 3.5.0

### Minor Changes

- cache fbclid

## 3.4.1

### Patch Changes

- fix xk country code for meta conversions api

## 3.4.0

### Minor Changes

- simplify useTrackImpression

## 3.3.0

### Minor Changes

- update deps
- update GA4 web-vitals properties

### Patch Changes

- Updated dependencies
  - @shware/utils@1.3.0

## 3.2.7

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.2.1

## 3.2.6

### Patch Changes

- add gaSrc props for gtag gateway

## 3.2.5

### Patch Changes

- remove localhost event

## 3.2.4

### Patch Changes

- currency case

## 3.2.3

### Patch Changes

- split posthog package

## 3.2.2

### Patch Changes

- update deps

## 3.2.1

### Patch Changes

- send posthog event

## 3.2.0

### Minor Changes

- update deps

### Patch Changes

- Updated dependencies
  - @shware/utils@1.2.0

## 3.1.3

### Patch Changes

- fix visitorId edge case

## 3.1.2

### Patch Changes

- add useTrackImpression hook

## 3.1.1

### Patch Changes

- update deps

## 3.1.0

### Minor Changes

- add tanstack router support

## 3.0.9

### Patch Changes

- replace prettier and eslint with oxfmt and oxlint
- Updated dependencies
  - @shware/utils@1.1.4

## 3.0.8

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.1.3

## 3.0.7

### Patch Changes

- add tests
- Updated dependencies
  - @shware/utils@1.1.2

## 3.0.6

### Patch Changes

- add storage keys

## 3.0.5

### Patch Changes

- update deps
- Updated dependencies
  - @shware/utils@1.1.1

## 3.0.4

### Patch Changes

- remove logs

## 3.0.3

### Patch Changes

- remove passive true

## 3.0.2

### Patch Changes

- add log

## 3.0.1

### Patch Changes

- add trigger properties

## 3.0.0

### Major Changes

- remove expo-router deps

## 2.18.0

### Minor Changes

- simplify session analytics

## 2.17.3

### Patch Changes

- add outbound click analytics

## 2.17.2

### Patch Changes

- add first_open and first_visit event, define automatically collected events

## 2.17.1

### Patch Changes

- ignore google analytics auto events

## 2.17.0

### Minor Changes

- add utils deps & fix session duration time\

## 2.16.2

### Patch Changes

- Updated dependencies
  - @shware/utils@1.0.0

## 2.16.1

### Patch Changes

- update v1 schema

## 2.16.0

### Minor Changes

- fix type mismatch
- add platform and environment field for visitor and event object
- simplify types

## 2.15.5

### Patch Changes

- export Platform and Environment enum

## 2.15.4

### Patch Changes

- make environment and platform field required

## 2.15.3

### Patch Changes

- reset session when timeout

## 2.15.2

### Patch Changes

- session active time

## 2.15.1

### Patch Changes

- update session analytics

## 2.15.0

### Minor Changes

- add sessionId

## 2.14.4

### Patch Changes

- fix content-type

## 2.14.3

### Patch Changes

- fix import error

## 2.14.2

### Patch Changes

- fix import error

## 2.14.1

### Patch Changes

- update deps

## 2.14.0

### Minor Changes

- add session analytics
- simplify getTags function
- ignore server events
- add setup cache
- add sendBeacon function
- use sync storage

## 2.13.5

### Patch Changes

- add app_launch event

## 2.13.4

### Patch Changes

- update deps

## 2.13.3

### Patch Changes

- remove slash on endpoint url

## 2.13.2

### Patch Changes

- add reddit pixel cookie

## 2.13.1

### Patch Changes

- safari ITP: store fbc to cookie and localstorage

## 2.13.0

### Minor Changes

- remove axios dependency

## 2.12.4

### Patch Changes

- global -> globalThis

## 2.12.3

### Patch Changes

- add X-RestLi-Method: BATCH_CREATE header

## 2.12.2

### Patch Changes

- conversions api error handling & retry

## 2.12.1

### Patch Changes

- add fetch utils

## 2.12.0

### Minor Changes

- add distinct_id support and remove setUserId

## 2.11.6

### Patch Changes

- fix types

## 2.11.5

### Patch Changes

- support native fingerprint

## 2.11.4

### Patch Changes

- add share params

## 2.11.3

### Patch Changes

- ignore empty events

## 2.11.2

### Patch Changes

- fix server event mapping

## 2.11.1

### Patch Changes

- fix linkedin types

## 2.11.0

### Minor Changes

- add linkedin linktr definition

## 2.10.1

### Patch Changes

- support linkedin click ids

## 2.10.0

### Minor Changes

- support linkedin conversions api

## 2.9.0

### Minor Changes

- add linkedin insight tag support

## 2.8.6

### Patch Changes

- remove metrics from conversions api

## 2.8.5

### Patch Changes

- typo \_rtd_uuid -> \_rdt_uuid

## 2.8.4

### Patch Changes

- chore remove FID

## 2.8.3

### Patch Changes

- remove meta, reddit metrics

## 2.8.2

### Patch Changes

- remove third party web vitals report

## 2.8.1

### Patch Changes

- fix: remove undefined field

## 2.8.0

### Minor Changes

- support reddit ads, refactor event utils

## 2.7.0

### Minor Changes

- add setGAUser, update setVisitor params

## 2.6.2

### Patch Changes

- add survey support

## 2.6.1

### Patch Changes

- update deps

## 2.6.0

### Minor Changes

- update event name

## 2.5.2

### Patch Changes

- update deps

## 2.5.1

### Patch Changes

- fix import

## 2.5.0

### Minor Changes

- add previous page analytics

## 2.4.1

### Patch Changes

- update deps

## 2.4.0

### Minor Changes

- replace AsyncStorage with expo-sqlite

## 2.3.11

### Patch Changes

- chore build

## 2.3.10

### Patch Changes

- add native screen analytics

## 2.3.9

### Patch Changes

- chore types

## 2.3.8

### Patch Changes

- fix types

## 2.3.7

### Patch Changes

- add types

## 2.3.5

### Patch Changes

- add install_referrer and fix screen resolution

## 2.3.4

### Patch Changes

- chore: eslint

## 2.3.3

### Patch Changes

- fix build

## 2.3.2

### Patch Changes

- add firebase & fbsdk event

## 2.3.1

### Patch Changes

- fix getInstallReferrerAsync is not available on ios

## 2.3.0

### Minor Changes

- support react-native environment

## 2.2.11

### Patch Changes

- update deps

## 2.2.10

### Patch Changes

- update deps

## 2.2.9

### Patch Changes

- update deps
