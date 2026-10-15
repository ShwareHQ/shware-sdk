---
'@shware/workflow': minor
---

Unsubscribing now suppresses the channel: the unsubscribe link records a `suppression` row for the user, later email steps for that user are skipped, and `reachable(email)` reads false; `/t/u` answers 404 for an unknown copy.
