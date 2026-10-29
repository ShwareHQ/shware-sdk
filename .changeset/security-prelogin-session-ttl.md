---
'@shware/security': patch
---

`oauth2Authorization` gives the session it creates for a browser without one a 10-minute inactive interval (the life of the OAuth2 state), so abandoned flows no longer keep a row and cookie for the default interval. A session the browser already carries keeps its interval, and sign-in still moves to a new session with the default.
