---
'@shware/http': minor
---

Google One Tap `prompt()` now reports a typed `outcome` when no credential is returned: `skipped` with an optional `SkippedReason` (often absent under FedCM) or `dismissed` with `cancel_called` / `flow_restarted`. The `moment` fields are deprecated, and `moment.dismissedReason` is now only set for dismissed moments.
