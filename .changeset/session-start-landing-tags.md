---
'@shware/analytics': patch
---

`session_start` carries the tags of the event that opened the session, captured when that event happened, instead of capturing its own at flush time. A batch is flushed up to two seconds after the landing, and a landing page that redirects inside that window — an ad landing page that sends the visitor on to sign-in, a router that strips the query string — stamped the session's one attribution record with the URL the utm parameters and click ids had already been stripped from, so the session looked like direct traffic.
