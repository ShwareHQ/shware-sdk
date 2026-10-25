---
'@shware/security': patch
---

Sign an OAuth2 redirect login in on a new session id instead of the one the authorization started on, and delete the old session, so a planted session id never becomes authenticated (session fixation).
