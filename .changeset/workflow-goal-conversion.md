---
'@shware/workflow': minor
---

Conversion is recorded apart from how an instance ends: outcomes and `finished` reports carry `convertedAt` (stored as `instance.converted_at`), so `exitOnMatch: false` keeps its conversion. The goal only counts events inside its window — `performed` gets an upper bound (`untilMs`, through `countEvents`/`listEventPayloads`), so a purchase after `within` closed never converts even when the check runs later — and the wait for the window after the last step also ends on `exitWhen`.
