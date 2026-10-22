---
'@shware/workflow': minor
---

Add an `authorize(request, env)` option to `journeyWorker` and `journeyLambda`, so the host decides how a caller authenticates: an HMAC over the body, a JWT, or a header a proxy adds. Every API route asks it in place of the `API_TOKEN` bearer; the tracking routes (`/t/...`) and `/health` stay public and never do.

- It receives a copy of the request, so it can read the body, and the env the host validated. True lets the request through, false answers 401, and a throw answers 500 — never letting the request in.
- Production, which refuses to serve without `API_TOKEN`, is satisfied by an `authorize` of its own instead.
- `bearerMatches` and `timingSafeEqual` are exported from `@shware/workflow/cloudflare` and `@shware/workflow/aws` for hosts that build their own check.
- The README gains Cloudflare and AWS deployment notes: why the Function URL uses `AuthType: NONE` with the API protected in the app (`AWS_IAM` and CloudFront OAC break the public tracking and one-click unsubscribe routes), the resource policy, CloudFront and WAF, measured per-request costs, quotas, timeouts, the execution role, versions, and the Cloudflare Workflows limits.
