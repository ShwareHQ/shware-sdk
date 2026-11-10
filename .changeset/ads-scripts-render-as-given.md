---
'@shware/analytics': patch
---

Ad platform snippets are rendered as given again: the host check that 16.3.5 wrapped them in is gone (it rewrote the vendors' snippets). The senders still skip development hosts through `isLocalHost()`; a host that wants no pixel page views locally leaves the `ads` integrations out of `integrations` there.
