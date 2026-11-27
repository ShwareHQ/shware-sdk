---
'@shware/workflow': patch
---

A workflow's definition is no longer checkpointed with every instance. Reading it by the hash pinned at entry was a durable step (`$workflow:ir`), so each instance's state held a whole copy of the same definition; the read is now a plain one, and each host keeps the definitions it has read in memory by content hash, asking the store once per version and process. On every runtime an instance runs one step fewer and carries less state; on `@shware/workflow/node`, a million sleeping instances of a three-node workflow went from 3.5 GB to 2.3 GB on disk, and throughput rose 6–16%. The read is retried briefly (as the admission before it is) instead of with a step's backoff; a definition that is missing still fails the instance and its entry. No migration. An instance already in flight when this is deployed replays with one step fewer than it recorded: that was not tested on any runtime, so let journeys in flight end first where that matters.
