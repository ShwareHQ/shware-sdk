---
'@shware/workflow': minor
---

Add an `authorize(request, env)` option to `journeyWorker` and `journeyLambda`, so the host decides how a caller authenticates: an HMAC over the body, a JWT, or a header a proxy adds. It replaces the bearer check on every protected route: the ingest API, `/bundle`, `/bundle/deploy`, `/preview/*` and `/segments/sweep`.

- It receives a copy of the request, so it can read the body. True lets the request through, false answers 401, and a throw answers 500, never letting the request in.
- The tracking routes (`/t/...`) and `/health` stay public and never ask it.
- The default is still the env's `API_TOKEN` as a bearer, now compared in constant time.
- `bearerToken` and `timingSafeEqual` are exported for hosts that build their own check.
- The README gains AWS and Cloudflare deployment notes: why the Function URL uses `AuthType: NONE` with the API protected in the app (`AWS_IAM` and CloudFront OAC break the public tracking and one-click unsubscribe routes), plus the resource policy, CloudFront and WAF, measured costs, quotas, timeouts, IAM, versioning, and the Cloudflare Workflows limits.
