---
'@shware/workflow': patch
---

A message refused for a missing reference says which one.

When a template refuses its props and one of them was written as a reference the user has no value for (`{ name: u.name }` for a user without a name), the error now names it: `props.name reads profile field 'name', which this user has no value for`. Nothing else changes: the message is not sent and the journey fails there without a retry, as before. The README now says what a profile field's schema promises — it checks what is written, not that it was written, so a field your app does not write for every user should be declared `optional(...)`, which makes `u.name` a `string | undefined` the compiler holds a required template prop against.
