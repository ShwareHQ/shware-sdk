---
'@shware/http': minor
---

Add `zBeaconJson(schema)`, a `json` validator that also accepts a `text/plain` body and parses it as JSON. `navigator.sendBeacon` has to send `text/plain` to stay a CORS simple request: as `application/json` a cross-origin beacon needs a preflight that a closing page often cannot complete, so the beacon is dropped. Hono's `json` target reads any non-JSON content type as `{}`, which `zValidator` then rejects. Malformed text is an `INVALID_ARGUMENT`, and schema violations are reported exactly as `zValidator` reports them. Use it only on routes that receive beacons and take no credentials.
