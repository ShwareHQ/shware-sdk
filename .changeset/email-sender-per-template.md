---
'@shware/workflow': major
---

Email templates name their own sender, and the config's `emails` is gone.

- `emailTemplate` takes a required `from` and an optional `replyTo` (left out, the email has no Reply-To; nothing is inherited) and `unsubscribeUrl`. Both addresses and the URL are checked when the template is declared and again by `compileConfig` for every registered template.
- The config's `emails` is replaced by `email: { unsubscribeUrl?, tracking? }`. A template's unsubscribe link is its own `unsubscribeUrl`, else `email.unsubscribeUrl`, else none (`resolveEmail`). A config still carrying `emails` fails `compileConfig` and `journeyWorker` with how to migrate.
- The renderer provides the resolved metadata to the component: a layout reads its unsubscribe link with `useEmailContext()` from the new browser-safe `@shware/workflow/email-context` entry instead of a constant. `registryRenderer(emails, config.email)` returns `{ from, replyTo?, unsubscribeUrl?, subject, html }`, and `CfEmailSender` takes only `{ binding, render }`: it sends from what the render returns.
- What a tracked link does is fixed when the email is sent: links go out as `/t/l/<message>/<position>` and the unsubscribe link as `/t/u/<message>/<position>` (confirmation page; only the POST unsubscribes). `MessageTracking.link` receives the link's purpose. Links of emails sent before (`/t/c/...`) keep working, recognised against `email.unsubscribeUrl` as before; no database change.
- The Worker's `/preview/<id>` finds a template by its id rather than by the property the registry holds it under.

Migrate: move `emails.from` / `emails.replyTo` onto each `emailTemplate`, rename `emails.unsubscribe` to `email.unsubscribeUrl`, move `emails.tracking` to `email.tracking`, and render the layout's unsubscribe link from `useEmailContext()`.
