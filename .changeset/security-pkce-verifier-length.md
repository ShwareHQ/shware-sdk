---
'@shware/security': patch
---

The redirect flow's PKCE `code_verifier` is 32 random bytes in base64url (43 characters, the RFC 7636 minimum) instead of a 36-character UUID, which strict providers could refuse.
