---
'@shware/analytics': patch
---

An event is never timed ahead of the server. `createTrackEventSchema` now moves a batch stamped by a clock that is ahead by any amount, not only one that is more than a day off, back by its lead, keeping its spacing. The Microsoft, Reddit and Meta conversions senders also cap the event time at the moment they send. A browser clock a few minutes fast had those APIs reject whole requests ("event_at must be no more than 5m0s into the future").
