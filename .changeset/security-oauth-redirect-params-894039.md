---
'@shware/security': minor
---

`oauth2Authorization` takes `redirectParams`: query parameters stored with the authorization request and added to the flow's redirect back to the app, on `successUri` and on `errorUri` alike, so a page can match a sign-in result to the attempt it started (for example a popup that reports back without `window.opener`). They never replace a parameter of the redirect itself.
