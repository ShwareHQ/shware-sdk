---
'@shware/workflow': major
---

The segment sweep narrows its work down in SQL. `JourneyStore.listSegmentCandidates` compiles every deployed segment into one statement and names only the users whose membership may have to change or whose entry still owes a start, so a sweep with nothing to change costs a few queries however many users there are; `evaluateCondition` still decides each remaining case. It replaces `JourneyStore.listUserIds`, and `SweepResult.users` / `SweepPage.users` become `evaluated`, the users actually looked at, which `POST /segments/sweep` returns too.
