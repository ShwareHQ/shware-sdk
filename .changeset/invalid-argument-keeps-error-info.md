---
'@shware/security': patch
---

A 400 from a schema validation (`parse`) now carries its `ErrorInfo` (`reason: INVALID_ARGUMENT`) ahead of the `BadRequest` detail that names the fields. Before, the `BadRequest` replaced the `ErrorInfo`, so `@shware/http`'s `getErrorInfo` found no reason on exactly the errors the README said carried one.
