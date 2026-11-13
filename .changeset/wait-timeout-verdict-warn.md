---
'@shware/workflow': patch
---

The Cloudflare host logs a warning when a `waitUntil` that threw inside the 5 s tolerance before its deadline is taken as a timeout. Cloudflare's `waitForEvent` throws the same way for an expiry and for a failure, so the clock decides; this is the one window where a broken binding reads as "the user never did it", and the log now says so with what was thrown. The verdict itself is unchanged.
