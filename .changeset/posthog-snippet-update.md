---
'@shware/analytics': patch
---

Update the PostHog snippet to PostHog's current one: it leaves an already loaded library in place, inserts `array.js` once, and retries it on the next `init` if it failed to load.
