---
'@shware/workflow': patch
---

Reclaim entries whose instance ended on the platform without finalizing them. Once a runner admitted itself, an instance terminated from outside, errored for good or evicted left its entry `running` forever, so the once-policy barred the user from the workflow and every later event of theirs woke a dead instance. The sweep's maintenance now samples the entries admitted more than 15 minutes ago (a bounded random sample per sweep) and marks the ones whose instance the runtime reports `complete`, `errored` or `terminated`, or no longer knows, as `failed`, drops their wake subscriptions and reports the ending; the pair's next trigger re-enters. `JourneyStore` gains `admittedEntries` and `failAdmittedEntry`.
