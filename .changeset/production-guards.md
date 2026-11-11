---
'@shware/workflow': minor
---

Two guards against a production that runs the wrong way. `JourneyRuntimeConfig`'s `production` entry now types `timeScale` as `1` (`ProductionRuntimeOptions`): a development factor pasted under the production key is a compile error rather than every user's journey fast-forwarded. A deploy meant to run fast is not production: give it a mode of its own (`ENVIRONMENT=rehearsal`), which is as free as `development`. Other modes are unchanged. And a host that carries its own bundle (`journeyWorker`; the AWS host already did) refuses `POST /deploy` in production with a 409: it deploys by publishing a version, so a routing table posted by hand there could only come from a leaked bearer. Development and the bare `handleRequest` API still take one.
