---
'@shware/workflow': patch
---

Web push subscriptions are validated before sending (an https endpoint, a 65-byte uncompressed P-256 key and a 16-byte auth secret); a malformed one is reported unregistered and removed instead of failing the step, and unregistered tokens on any channel are removed through the configured store.
