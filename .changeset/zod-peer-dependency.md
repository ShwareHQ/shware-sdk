---
'@shware/analytics': minor
'@shware/http': minor
'@shware/purchase': minor
'@shware/security': minor
'@shware/workflow': minor
---

Move `zod` from `dependencies` to `peerDependencies` (`^4.6.5`). These packages export zod schemas and accept your own schemas (`zValidator`, `valid`, workflow props), so they must share the app's zod instance instead of bundling a second copy. Install `zod` alongside the package if your app does not already depend on it; pnpm and npm install it automatically as a peer.
