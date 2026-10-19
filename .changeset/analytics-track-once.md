---
'@shware/analytics': minor
---

Add `trackOnce(name, properties, { key, ttl? })`: tracks an event at most once per key (a checkout session, an order, a store transaction). The key is remembered in the configured `storage` only after the event was sent, so a failed send is retried by the next call; storage failures fall back to tracking. The record is plain JSON (`{"v":1,"entries":[[key, expiresAt], …]}`) under `track_once.<event>`, up to the 20 latest keys per event, for 90 days by default.
