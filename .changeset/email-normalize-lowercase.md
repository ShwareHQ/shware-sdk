---
'@shware/security': major
---

Email sign-in now trims and lowercases the email address before validating it, so every casing of an address shares one verification code, attempt budget and resend cooldown, and `loginEmail` presents the lowercased address as `claims.sub` and `claims.email`.

**Migration**

Existing `EMAIL` identities stored with a mixed-case subject must be lowercased before deploying (merging any accounts whose subjects differ only in case), otherwise those users get a new account on their next sign-in because `sub` now arrives in lowercase.
