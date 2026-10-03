---
'@shware/analytics': minor
---

Drop visitor `properties` entirely: `updateVisitorSchema` no longer takes them, `setVisitor` no longer accepts them, and the GA user setter no longer forwards them as `user_properties`. No server has stored them since visitors keep tags only, and no host passes them. A body that still carries `properties` validates as before, the field left out. The `VisitorProperties` type stays: it types a visitor's tags.
