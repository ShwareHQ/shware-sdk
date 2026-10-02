---
'@shware/analytics': patch
---

The Conversions API senders leave out the events whose time their API rejects, instead of sending them: one out-of-range event fails the whole request on most of them, taking every valid event of the batch down with it. Meta, OpenAI, Reddit and Microsoft keep the last 7 days, LinkedIn the last 90; OpenAI also refuses more than 10 minutes ahead.
