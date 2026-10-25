---
'@shware/analytics': minor
---

`setVisitor({})` (a missing or empty `user_id`) now signs the visitor out: the page forgets the identified user, so signing back in sends `identify` again, and the PostHog user setter calls `posthog.reset()`, and the GA user setter clears GA's `user_id` (`gtag('set', 'user_id', null)`). A `logout` event no longer resets PostHog; call `setVisitor({})` on sign-out alongside `track('logout')`.
