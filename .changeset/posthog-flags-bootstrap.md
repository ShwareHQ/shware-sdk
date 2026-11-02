---
'@shware/analytics': minor
---

The hooks of `posthog-js/react`, with its names and signatures, for the snippet-loaded library: `useFeatureFlag` is renamed `useFeatureFlagVariantKey`, and `useFeatureFlagEnabled`, `useFeatureFlagPayload`, `useFeatureFlagResult`, `useActiveFeatureFlags` and `usePostHog` are added. Under the new `<PosthogProvider bootstrap>` the flag hooks render the server-evaluated values on the server, through hydration and until PostHog loads.
