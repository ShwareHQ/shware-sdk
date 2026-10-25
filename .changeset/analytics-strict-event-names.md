---
'@shware/analytics': minor
---

Add an opt-in `strict` switch: merging `strict: true` into the new `AnalyticsOptions` interface restricts `track`, `trackOnce`, `trackAsync`, `sendBeacon`, `useTrackImpression` and the third-party senders to GA4's standard events and the events declared in `CustomEventProperties`, so a misspelled or undeclared event name is a compile error; without it nothing changes. Properties are strict too: an undeclared event has no open `Record` fallback.
