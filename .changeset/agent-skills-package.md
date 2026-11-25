---
'@shware/skills': minor
---

New package: agent skills for the SDK, shipped in `skills/` for skills-npm to link into `.agents/skills`. It starts with `cursor-based-pagination-api` (`@shware/http` cursors and TanStack Query infinite queries) and `user-event-tracking` (`@shware/analytics` events, including declaring custom events in `CustomEventProperties` and turning on `strict` so only declared and GA4 standard events compile).
