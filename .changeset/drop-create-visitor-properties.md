---
'@shware/analytics': patch
---

`createVisitorSchema` drops `properties`: clients before 11 sent a copy of their tags under it, which servers have ignored since they keep tags only. A body that still carries it validates as before, the field left out.
