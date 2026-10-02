---
'@shware/analytics': patch
---

OpenAI pixel and Conversions API: an amount is no longer sent without a currency, at the event or the item level, since OpenAI requires a `currency` with every `amount`; `toMinorUnits` returns undefined without one. A custom event's `custom_event_name` is made valid by the new `oaiCustomEventName` (1–64 letters, digits, `_` or `-`, starting and ending with a letter or digit, not a standard event name): `Sign Up.Clicked` becomes `sign_up_clicked`, and an event whose name cannot be made valid is not sent. The pixel and the server name it the same way, so the two still deduplicate.
