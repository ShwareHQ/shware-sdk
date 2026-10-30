---
'@shware/security': major
---

Every flow that hands back an id token requires a nonce by default. A provider declares which of its flows echo one (`Provider.nonce`: Apple web and native, Google web and One Tap, Facebook Limited Login). The redirect flow now sends a nonce with the authorization request and refuses a callback whose id token does not carry it back (`NONCE_MISSING` / `NONCE_MISMATCH`); a native login or a One Tap credential must carry one issued by `GET /oauth2/nonce/:provider`, which it consumes. `oauth2.onetap.requireNonce` is gone: list a provider in `oauth2.nonce.optional` instead while a client that does not pass a nonce yet is phased out. Hosts whose Apple app already binds an issued nonce (as the docs ask) and whose web flow uses the SDK's redirect need no change.
