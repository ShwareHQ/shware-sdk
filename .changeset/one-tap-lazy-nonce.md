---
'@shware/http': minor
---

`prompt()` in `@shware/http/google-one-tap` accepts `nonce` as a function. It is called only once One Tap can run (FedCM is supported and the GSI script loaded), so a nonce fetched from a server is no longer spent on browsers that will never show the prompt.
