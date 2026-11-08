---
'@shware/workflow-ui': patch
---

Narrow the studio dev server's `server.fs.allow` from the whole workspace to what the page imports: the studio package, the project directory (and the config's directory), the workspace packages the project links in through `node_modules`, and each workspace root's `node_modules` (pnpm's virtual store). A sibling app's source and files are no longer one `/@fs/` request away; the credential deny list still applies.
