---
'@shware/http': minor
---

`errorHandler` classifies hono's `HTTPException` and client disconnects instead of reporting both as unknown 500s.

- An `HTTPException` (malformed JSON body, `bearerAuth` rejection, …) maps its HTTP status onto the canonical `Code`, so callers get the standard error body with the real status instead of a 500. One that carries its own `res` is returned untouched, preserving headers such as `WWW-Authenticate`.
- A request the client abandoned mid-flight — tab closed, navigation, aborted fetch — answers 499 `CANCELLED` and logs a single line. A body truncated by a disconnect is not a server fault, and the response is discarded anyway.
- Status errors are recognized by shape as well as by `instanceof`, so a duplicated copy of the package or a custom `Status.adapter` no longer degrades every business error to "Unknown error".
- Expected 4xx logs at `warn` and only 5xx at `error`; error bodies log on one line rather than pretty-printed across many, and the axios and unknown branches carry the request id.
