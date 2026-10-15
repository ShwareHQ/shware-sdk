---
'@shware/workflow': minor
---

Shared Zod contracts: `defineContract({ events, profile })` turns event payload schemas and a flat profile schema into the DSL's reference tables (`contract.events`, `contract.user` — declared fields only, so a loose object's extra keys are not spellable) plus `eventNames`, `parseEvent` and `parseProfilePatch` (merge-patch semantics: omitted keeps, `null` removes, provided values checked, undeclared refused). `new JourneyClient({ contract })` types `track` / `identify` by event name and refuses bad input before sending (`JourneyValidationError` with field paths); `journeyWorker({ contract })` re-validates every `/events` and `/identify` and answers 400 before anything is stored, woken or started (`contractMode: 'report'` logs instead, for checking producers first). Unsupported schemas (defaults, transforms, coercion, custom or async checks, nested profile fields) are refused when the contract is defined. `UserPropertyBase.email` is now optional.
