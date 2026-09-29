---
'@shware/analytics': minor
---

`createTrackEventSchema` corrects events stamped by a wrong client clock: an event more than a day from the server's time is moved onto it, together with the other wrong events of its batch by their latest one, keeping their order and spacing; the events on the right clock are left alone. A phone set to another year no longer writes its sessions into that year.
