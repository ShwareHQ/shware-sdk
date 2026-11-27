---
'@shware/analytics': minor
---

`classifyTouch` reads the landing page's `?via=` as it reads `?ref=`, when there is no `ref`: the referral programs' convention (Rewardful, Dub). Same rule — only when the session has no referrer, a site name or code as the channel with medium `referral`, a host as the referrer's — and `ref` wins when both are present.
