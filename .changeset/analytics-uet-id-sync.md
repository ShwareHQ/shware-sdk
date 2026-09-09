---
'@shware/analytics': minor
---

The `Analytics` components fire Microsoft's ID Sync pixel themselves: pass `uetCustomerId` and the SDK visitor — the `anonymousId` of the events the server sends to the Conversions API — is synced once per visit, anonymous visitors included, since they are who remarketing audiences are built from. `setUETUser` re-syncs on sign-in with the user id hashed into `UID`, matching the server's `externalId`. `configureUET` and `syncUETVisitor` expose the same outside the components; a host no longer writes its own hook around `sendUETIdSync`.
