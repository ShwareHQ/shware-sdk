---
'@shware/analytics': minor
---

Every web event carries a `page_load_id` tag: one v4 UUID per page load, shared by all events of that page and replaced on a reload or a single-page-app route change — the same moments the SDK sends a `page_view`, so every id has a page view to point at. A module variable, deliberately not storage — the id must die with the page.

The Microsoft Conversions API sender uses it as `pageLoadId` in CAPI-only mode (`pageLoads: true`), linking each `custom` event to the `pageLoad` event it happened on; with the UET tag on the page nothing is sent, since the tag reported the page load under its own id. `getMicrosoftEvent` takes `{ consent, pageLoads }` as its third argument; the bare consent value is still accepted.
