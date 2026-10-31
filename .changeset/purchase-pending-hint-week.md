---
'@shware/purchase': patch
---

Pending checkout hints are kept for 7 days instead of 1 hour, so a paid checkout whose confirmation failed is still confirmed, and its conversion reported, when the user comes back days later.
