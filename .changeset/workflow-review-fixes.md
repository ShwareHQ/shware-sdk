---
'@shware/workflow': minor
---

Review fixes: `u.userId` now reads the user's own id (it is never stored in the profile); events a journey emits with `.sendEvent()` pass the same contract check as `/events` (an undeclared event, a bad literal or a missing field also fails `compileConfig`; a refusal at run time ends the step without retries), and `.sendEvent()` only accepts scalar payload fields, in the types and when the workflow is defined; contracts accept an explicit list of schema types and walk every container (tuple, intersection, record, catchall), and both contracts and templates refuse value-changing checks (`.overwrite`, `.trim`, `.toLowerCase`, …) as well as custom refinements; `/preview/<key>` takes its props as `?props=<JSON>`, so number and boolean fields can be previewed.
