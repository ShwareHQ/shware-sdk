---
'@shware/workflow': patch
---

Fix array parameters in the postgres.js store client: `sql.unsafe` sent a JS array as `String(array)`, so every `= ANY($1::text[])` query (the visitor merge at sign-in, the erasure's cleanup) failed on a real Postgres with "malformed array literal"; arrays now leave as Postgres array literals.
