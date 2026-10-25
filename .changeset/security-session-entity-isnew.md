---
'@shware/security': minor
---

`DBIndexedSessionRepository` passes `isNew` on the entity it hands `DBAdapter.save`: `true` for a session created in this request, `false` for one the adapter loaded. Adapters can insert or update on it (as Spring Session's JDBC repository does) instead of upserting, so a save racing a logout or kick cannot write a deleted session back. Entities the adapter returns need not carry it.
