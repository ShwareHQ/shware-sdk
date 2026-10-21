---
'@shware/http': major
---

Google One Tap `prompt()` now reports why no credential was returned as flat, narrowable results: `{ authorized: false, skipped: true, reason?: SkippedReason }` (the reason is often absent under FedCM) and `{ authorized: false, dismissed: true, reason: DismissedReason }` (`cancel_called` | `flow_restarted`), next to the unchanged `unsupported` result. Breaking: `result.moment` and the `PromptMoment` type are removed. Callers that read `result.moment` should narrow with `'skipped' in result` / `'dismissed' in result` and read `result.reason`; callers that only read `authorized` / `credential` need no change.
