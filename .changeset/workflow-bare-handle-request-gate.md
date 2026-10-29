---
'@shware/workflow': patch
---

The bare `handleRequest` applies the production gate the journey host does: with `ENVIRONMENT` resolving to `production`, no `API_TOKEN` and no authorizer, every route but `GET /health` answers 503 instead of serving open.
