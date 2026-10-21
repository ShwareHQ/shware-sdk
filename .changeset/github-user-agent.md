---
'@shware/security': patch
---

Send a `User-Agent` on every GitHub request (Cloudflare Workers' fetch sends none, so GitHub's API answered 403), reject the HTTP 200 error bodies GitHub's token endpoint returns for failed exchanges, and include GitHub's status and response body in user-info errors.
