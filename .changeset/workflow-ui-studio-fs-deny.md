---
'@shware/workflow-ui': patch
---

The Studio dev server sends no CORS headers (`server.cors: false`) and refuses to serve credential files through `/@fs/`: `.dev.vars*`, `*.p8`, `*.plist`, `google-services.json`, `*.pfx`, `*.pem` and `*.key`, on top of Vite's default deny list.
