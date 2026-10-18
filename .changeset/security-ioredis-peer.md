---
'@shware/security': patch
---

Make `ioredis` an optional peer instead of a dependency: the Redis session store only takes the `Redis` client you pass in as a type, so apps that do not use it no longer install ioredis. Drop the unused `uuid` dependency.
