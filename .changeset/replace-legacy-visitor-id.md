---
'@shware/analytics': patch
---

`visitorId()` replaces a stored id that is not a uuidv7, such as the int64 id older servers issued, with a new one. Since 11.0, which dropped the round trip that used to recreate such a visitor, the id was kept, and the server rejected every batch the device sent.
