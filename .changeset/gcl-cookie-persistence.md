---
'@shware/analytics': minor
---

Google Ads click ids survive past the landing page: `resolveClickIdCookies` now manages `_gcl_aw`/`_gcl_gb`.

Until now `gclid`/`wbraid` were read from the current page URL only, so every event after the landing page — and every returning visit — lost the click id, and the Data Manager API sender had nothing to upload for exactly the conversions it exists to recover. The click-id middleware now gives Google the same first-party HTTP persistence Meta and Reddit already had, in the pattern Google itself uses (the server-side Conversion Linker sets FPGCLAW via Set-Cookie for 90 days) and the sGTM ecosystem productized (stape Cookie Keeper re-issues `_gcl_*` over HTTP).

- **gtag's exact cookie contract, extracted from gtag.js**: values are written as `GCL.<seconds>.<clickId>` (seconds, not `_fbc`'s milliseconds), click ids validated with gtag's own `/^[\w-]+$/`, and a `gclid` enters `_gcl_aw` only when `gclsrc` is absent or `aw.ds` — `ds`/`3p.ds` clicks belong to Search Ads 360, exactly as gtag gates them. `wbraid` routes to `_gcl_gb`.
- **Ownership is shared with gtag, so the rules are stricter than for `_fbc`**: a value the module cannot parse is left untouched (never rewritten, never deleted), and a re-issue is byte-identical — labels tail included — at the window's *remaining* lifetime, so the 90-day click window never slides and a long-expired click is never revived.
- **The re-issue doubles as an ITP self-heal for gtag itself**: Safari caps JS-written cookies at 7 days (24h on ad-decorated landings); the HTTP re-issue on the next document response restores the full window for gtag's own conversion tracking too, whether or not the Data Manager sender is in use.
- **Web tags fall back to the cookies**: `getTags` now reads `gclid` from the URL first, then a still-valid `_gcl_aw` (`wbraid` likewise from `_gcl_gb`), so every event of the visit — not just the landing page's — carries the click id into the event store the server-side senders read from.
- New exports: `parseGcl`, `formatGcl`, `GCL_AW_COOKIE`, `GCL_GB_COOKIE`, `ParsedGcl`; `ResolveClickIdCookiesResult` gains `gclid` and `wbraid`.

Consent note: hosts gating `resolveClickIdCookies` on consent signals keep doing so — with `ad_storage` denied, gtag deliberately writes none of these cookies, and neither should the middleware.
