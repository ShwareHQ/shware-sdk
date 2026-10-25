---
'@shware/utils': major
---

`fetch` now retries only the idempotent methods by default (GET, HEAD, PUT, DELETE, OPTIONS get `retries: 3`; POST and PATCH get `0`, as RFC 9110 §9.2.2 allows repeating only a request known to be idempotent), never retries a `ReadableStream` body, and no longer retries 501, 505 or 511 (only 408, 429, 500, 502, 503 and 504). Pass `retries` explicitly for a POST the server deduplicates (a client-generated id or an `Idempotency-Key` header, which stays the caller's to choose).
