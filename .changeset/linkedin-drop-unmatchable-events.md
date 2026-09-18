---
'@shware/analytics': patch
---

Drop a LinkedIn conversion event that carries no identifier LinkedIn can match on, instead of sending it. Validation fails such an element, and a failed element fails the entire batch — so one anonymous event used to discard every identifiable conversion travelling with it.
