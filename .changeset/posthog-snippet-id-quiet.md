---
'@shware/analytics': patch
---

Rename the PostHog and GA4 script ids to `posthog-snippet` and `google-analytics`: an element's id is readable as `window[id]`, so the `posthog` id made the snippet build its stub on the `<script>` element, and the first queued call (`onFeatureFlags` from the flag hooks) threw `t.push is not a function`, crashing the page before the library loaded.
