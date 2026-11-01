---
'@shware/analytics': patch
---

Meta maps `sign_up` to `CompleteRegistration`, as it already did `login` and as Reddit and OpenAI map both, so the Meta Pixel and Facebook App Events still receive sign-ups now that ad integrations only get standard events and their `customEvents`.
