---
'@shware/analytics': minor
---

Google Ads joins the server-side senders: `sendGoogleAdsEvents` uploads conversions via the Data Manager API.

Google conversions were the one channel still reported only by the browser — gtag reading its own cookie — while Meta, Reddit, OpenAI and LinkedIn already went out server-side from stored events. The new sender speaks `events:ingest` on the Data Manager API, Google's counterpart to Meta's Conversions API and the mandated successor to the Google Ads API's `UploadClickConversions` (closed to new adopters since 2026-06-15). Same shape as the rest of `@shware/analytics/server`: a pure per-event builder (`getDataManagerEvent`), a never-throws `sendEvents`, credentials in headers and never in a URL or a log line.

- **Built for Google's hybrid setup** ("boost your tag with additional data sources"): point the config at the SAME conversion action the gtag tag reports to, and Google matches the two channels by `transactionId` — fed from `properties.transaction_id` with the event id as fallback, the same value gtag sends, so the ids agree by construction. A matched pair collapses into one conversion with the server data winning; an unmatched upload is a recovered conversion. Standalone conversion actions work too.
- **Configured like the LinkedIn sender**: `{ purchase: 111 }` maps event names to conversion action ids; unconfigured events are skipped. Mixed-action batches go out as one request with one destination per action.
- **Timed by the event**: `eventTimestamp` is `created_at` (RFC 3339 as stored — no format conversion). A queued or retried upload does not move the conversion.
- **At most one click id per event**, `gclid` preferred over `gbraid` over `wbraid`. An event with no click id still uploads when it carries hashed identifiers — the enhanced-conversions match path; one with nothing to match on is skipped rather than costing the batch (the API has no partial-failure mode).
- **Enhanced conversions**: emails and phone numbers from `UserProvidedData` are SHA-256 hashed per Google's rules — the gmail-only dot-and-plus stripping included (`normalizeEmail` is exported) — capped at the API's ten identifiers per event, declared with `encoding: 'HEX'`. EEA/UK/CH consent is forwarded via `options.consent`.
- **Auth is just an OAuth2 access token** with the `datamanager` scope plus the Google Ads account id (dashes tolerated; delegated access via `loginAccountId`). No developer token, no API Center approval — the caller exchanges its stored refresh token for the access token and stays in charge of refresh, the way it holds the tokens for every other sender.
