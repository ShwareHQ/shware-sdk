---
'@shware/security': patch
---

`logout` now clears the session cookie with the same `domain`, `path`, `sameSite` and `secure` attributes it was set with, so cookies set with a `Domain` are actually removed.
