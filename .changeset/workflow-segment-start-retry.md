---
'@shware/workflow': minor
---

Segment-entry starts are tracked per workflow (`segment_start` table, written with the membership): a start that fails is retried by the next evaluation instead of being hidden behind the membership, and one failing workflow no longer blocks the others on the same segment. One user's failure no longer stops the sweep. Store API: `addSegmentMember` takes the workflows, plus `pendingSegmentStarts` and `completeSegmentStart`.
