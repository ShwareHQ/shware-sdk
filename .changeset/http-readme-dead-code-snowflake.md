---
'@shware/http': patch
---

The README no longer claims a `react` peer dependency the package does not declare; the empty `cache()`, `getI18nErrorMessage()` and `enUS` stubs, which no entry point exported, are removed; `UidGenerator`'s constructor parameter is spelled `machineId`, and the shared `uid` documents that its machine id is drawn at random per isolate, so a multi-instance deployment should construct its own generator with an assigned id. No behaviour change.
