---
'@shware/analytics': minor
---

Send `hashedFirstName` / `hashedLastName` in a LinkedIn conversion's `userInfo` instead of the plaintext `firstName` / `lastName` they replace, which version `202609` makes possible. The name no longer leaves the server in the clear, and the two plaintext fields are gone from `CreateLinkedinEventDTO`.
