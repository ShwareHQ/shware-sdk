---
'@shware/http': minor
---

`cancel()` is exported from `@shware/http/google-one-tap`: it takes One Tap down once the visitor has signed in another way. Every `prompt()` in flight resolves with `{ authorized: false, dismissed: true, reason: 'cancel_called' }`: a prompt on screen is closed through GSI's `cancel()` (and settled even if FedCM never reports the dismissal), and one still loading the script or awaiting its `nonce` function never shows, without asking for a nonce it has not requested yet. A credential already returned is unaffected, a later `prompt()` runs normally, and with nothing in flight or outside a browser it is a no-op.
