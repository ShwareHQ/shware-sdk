---
'@shware/security': major
---

`loginOAuth2Onetap` now requires the One Tap `credential` to carry a single-use nonce issued by `GET /oauth2/nonce/google` (`oauth2Nonce`), consuming it on sign-in so a leaked ID token cannot be replayed for new sessions; a missing, unknown or reused nonce is answered `401 invalid_request`. Migration: before calling `prompt`, the web app fetches `GET /oauth2/nonce/google` and passes `nonce` to `prompt({ client_id, nonce })` (`@shware/http/google-one-tap`). Hosts that still serve a front end without it can set `oauth2: { onetap: { requireNonce: false } }` (default `true`) during the rollout; a nonce the credential carries is still checked. The commented-out `g_csrf_token` double-submit check, which FedCM mode cannot use, is removed.
