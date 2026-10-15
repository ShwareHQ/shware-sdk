---
'@shware/workflow': patch
---

`postgresJsStore` closes its connection after 2 seconds idle (`idle_timeout`, overridable through `connection`). A journey run lasts as long as its sleeps and waits, and holding the connection through them held one per sleeping instance — a few hundred in-flight journeys exhausted the database's connection slots.
