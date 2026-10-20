---
'@shware/security': major
---

`AuthorizedHandler` now takes the request and one `Authorization` object instead of positional arguments: `(request, { registrationId, userInfo, token?, attributes })`. Migrate `onAuthorized(request, registrationId, userInfo, token)` to `onAuthorized(request, { registrationId, userInfo, token })`. `Authorization`, `AuthorizedHandler` and `OAuth2AuthorizationOptions` are exported.

New authorization attributes for the OAuth2 redirect flow: `oauth2Authorization(request, { attributes })` stores string values with the authorization request in the session (never sent to the provider), and `loginOAuth2Code` hands them to the handler as `authorization.attributes` once session, state and registration check out; they are removed with the request after a successful login and capped at 2 KB. Other login methods get `attributes: {}`.

Also fixes the `form_post` callback detection to accept a `charset` parameter on `application/x-www-form-urlencoded`.
