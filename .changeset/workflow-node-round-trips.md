---
'@shware/workflow': patch
---

`@shware/workflow/node`: fewer round trips a run. The engine marks its own bookkeeping steps (`StepOptions.idempotent` on `EngineStep.do`), and the Node runtime writes their checkpoints together with the next action's in one statement, ends a turn in the statement that carries its last checkpoints, and reads a run's checkpoints in the claim. A run of three actions goes from 47 statements and 21 transactions to 38 and 14; measured on a 2 vCPU Postgres, about 340 runs a second became about 430. Journeys that wait for an event are unchanged. No migration; the other runtimes ignore the mark.
