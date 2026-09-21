---
'@shware/workflow': minor
---

Debug time scale for journeys: `JourneyRunner` resolves typed `JourneyRuntimeOptions` through its `runtime()` hook (`resolveRuntime(config.runtime, mode)` over the project's workflow.config.ts, the mode being the only thing the environment decides) and divides every duration in the loaded WorkflowIR by it via the new `scaleDurations` (`@shware/workflow/engine`) — delays, random delays, wait timeouts, goal and `performed(within)` windows scale together, wall-clock time windows and stored segment definitions do not — so a journey written in days can be exercised in seconds under `wrangler dev`; `logMessages` echoes every outbound message. The studio config type gains a matching `runtime` field.
