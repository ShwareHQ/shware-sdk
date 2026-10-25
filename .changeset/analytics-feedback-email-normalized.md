---
'@shware/analytics': patch
---

`createFeedbackSchema` trims and lower-cases `email` before validating it (max 320), the same normalization the user-provided-data schema applies, so hosts no longer need to extend the schema to store a normalized address.
