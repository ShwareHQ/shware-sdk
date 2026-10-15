---
'@shware/workflow-ui': minor
---

Workflow Studio is now read-only: it shows the workflow graph, node details, email and push previews, the email envelope and stats, and never changes the project. The source write-back is gone — the `/__studio/envelope` and `/__studio/addresses` routes and POST `/__studio/node` answer 404 / 405 (`GET /__studio/node` remains, only to map a node to its line on disk), along with the inspector and envelope editors, the edit dialogs and row menus (`WorkflowList` / `EmailList` lose `onEdit`, `TemplatesPage` loses `addresses`, `onSaveEnvelope` and `onManageAddresses`), the address-book editor, the test-send dialog and the no-op Publish button. There is no test send either, since a test send has effects outside the project. Edit workflows, templates and the config in your editor; Vite picks the change up and the studio refreshes.
