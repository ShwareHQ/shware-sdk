---
'@shware/security': minor
---

The Facebook provider no longer sets `email_verified`: the Graph API does not state it, so the flag was a hardcoded `true`. Hosts can now trust `email_verified === true` from any provider.
