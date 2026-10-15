---
'@shware/workflow': patch
---

Template props schemas also refuse custom refinements and value-changing checks placed on the `.optional()` wrapper itself (`z.number().optional().overwrite(...)`), not only on the wrapped type.
