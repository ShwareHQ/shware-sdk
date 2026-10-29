---
'@shware/http': patch
---

`authorizer` matches a `HEAD` request against the `GET` rules: Hono serves `HEAD` with the `GET` handler, so a rule like `{ path, methods: ['GET'] }` let `HEAD` through unauthenticated.
