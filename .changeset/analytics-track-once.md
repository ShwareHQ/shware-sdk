---
'@shware/analytics': minor
---

Add `trackOnce(name, properties, { key, ttl? })`: tracks an event at most once per key (a checkout session, an order, a store transaction). The key is remembered in the configured `storage` only after the event was sent, so a failed send is retried by the next call; storage failures fall back to tracking. Keys are kept compact and cookie-safe, up to the 20 latest per event, for 90 days by default.
