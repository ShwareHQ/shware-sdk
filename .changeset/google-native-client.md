---
'@shware/security': minor
---

Google `loginOAuth2Native` exchanges the code for the client the app names (`client_id` / `redirect_uri` in the credentials, i.e. the iOS or Android client and its custom-scheme redirect) instead of the registration's web client, which Google refused because the code was issued to another client. No secret is sent for those installed-app clients, and a client from another Google Cloud project (different project-number prefix) is rejected with `invalid_client`. Without a `client_id` in the credentials the registration's client and secret are used as before. `exchangeAuthorizationCode` omits `client_secret` when it is empty.
