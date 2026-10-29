---
'@shware/workflow': patch
---

Production ignores `APNS_RELAY_ORIGIN`: with `ENVIRONMENT` unset or `production`, iOS pushes (and the APNs provider JWT) go straight to APNs, and one `console.error` says the variable was ignored. The relay stays available in every other mode for `wrangler dev`.
