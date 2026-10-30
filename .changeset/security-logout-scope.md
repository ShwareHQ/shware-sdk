---
'@shware/security': minor
---

`logout(request, { scope })`: `local` (default) ends the request's session as before, `global` every session of its principal and the cookie ("sign out everywhere", e.g. before deleting the account), `others` every session but this one, keeping the caller signed in ("sign out other devices").
