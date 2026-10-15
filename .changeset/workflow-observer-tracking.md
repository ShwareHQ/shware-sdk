---
'@shware/workflow': minor
---

Reporting hooks for the host's dashboards: `journeyWorker({ observer })` (a `JourneyObserver`) hears every node an instance reaches (`nodeReached`, in a step of its own so replays do not repeat it), every message copy before and after it goes out (`messagePrepared`, `messageSent`), and how each instance ended (`finished`, including `failed`). Storage stays the host's. `messagePrepared` may return `MessageTracking`, which the built-in senders apply: an email's `http(s)` links are routed through `link` and an open `pixel` is appended (`trackEmail`), a push carries `data` in its payload. `OutboundMessage` now names its `workflow`, `instanceId` and `nodeId`, and a sender may return `{ delivered: false, reason }` — APNs and FCM do for a dead token instead of returning as if delivered.
