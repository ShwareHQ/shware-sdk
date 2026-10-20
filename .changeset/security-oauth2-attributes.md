---
'@shware/security': minor
---

Add authorization attributes to the OAuth2 redirect flow: `oauth2Authorization(request, { attributes })` stores string values with the authorization request in the session (never sent to the provider), and `loginOAuth2Code` hands them to the `AuthorizedHandler` as a new optional fifth argument `context.attributes` once session, state and registration check out; they are removed with the request after a successful login and capped at 2 KB. Other login methods pass `{ attributes: {} }`. `AuthorizedHandler`, `AuthorizedContext` and `OAuth2AuthorizationOptions` are now exported. Also fixes the `form_post` callback detection to accept a `charset` parameter on `application/x-www-form-urlencoded`.
