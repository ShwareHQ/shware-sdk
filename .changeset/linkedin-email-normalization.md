---
'@shware/analytics': patch
---

Normalize LinkedIn conversion identifiers before hashing them, as the Conversions API schema requires: an email is lower-cased with whitespace stripped, and a name additionally has its punctuation removed. An unnormalized hash is accepted by the API and then matches no member, so any value carrying capitals, padding or an apostrophe was being sent as an identifier that could never attribute.
