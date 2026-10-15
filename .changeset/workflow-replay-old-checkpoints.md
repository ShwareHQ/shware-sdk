---
'@shware/workflow': patch
---

Instances checkpointed before conversions were recorded apart replay safely (an old guard result is not taken for a conversion, an old wait check's `false` does not end the wait), and one erasure failing no longer stops the scheduled sweep.
