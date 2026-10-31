---
'@shware/analytics': patch
---

`reset()` only ends the session and replaces the visitor while the device's identity is still the one the calling page identified, so a tab that handles a sign-out late, after another tab has signed the next user in, no longer resets that user's session and visitor.
