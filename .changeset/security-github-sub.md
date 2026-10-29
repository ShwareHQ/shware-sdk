---
'@shware/security': patch
---

The GitHub provider sets `sub` to the account id as a string (`String(id)`); GitHub answers it as a number, which reached hosts typed as a string claim.
