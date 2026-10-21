---
'@shware/workflow-ui': minor
---

`postgresStats` reads the data on the production clock by default (`environment: 'production'`, time scale 1): the README example pointed at a production database while the default applied the development time scale, which stretched every timestamp. The full-page template preview is sandboxed like the thumbnails (no scripts run in the studio's origin); the config and stats files cannot be fetched through Vite's `/@fs/`; the metrics view tells loading, failed and empty apart; cohort weights display as percentages; a route parameter such as `constructor` answers not-found instead of crashing the page.
