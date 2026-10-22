---
'@shware/workflow': patch
---

Use the platform's primitives where the package had its own: Web Push's HKDF is WebCrypto's `deriveBits`, base64 / base64url / hex conversions go through `Buffer`, and the host's constant-time compare is `node:crypto`'s `timingSafeEqual`. A Worker needs `nodejs_compat`, which the README already asks for. The root entry keeps its pure SHA-256 (the compile is synchronous and runs in the studio's browser).
