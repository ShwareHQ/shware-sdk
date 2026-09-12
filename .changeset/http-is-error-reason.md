---
'@shware/http': minor
---

Add `isErrorReason(data, ...reasons)` to check whether an error body carries `ErrorInfo` with one of the given reasons, so components can claim specific errors (inline field errors) and a global handler can skip them.
