---
'@shware/workflow': patch
---

Internal dependencies untangled; nothing a `journeyWorker` or Lambda host does changes.

- `channelsFromConfig` takes `onDeadToken(token)`: what to do with a push token the provider reports as gone. The built-in hosts pass it and behave as before (the device is forgotten and the waits that read devices are woken). A caller that passes only `store` still has the token removed, **but the waits are no longer woken** — pass `onDeadToken` for that.
- The declarations a config and its templates are checked against (`EmailAddress`, `EmailConfig`, `assertEmailConfig`, `assertEmailMetadata`, `assertTemplateTopic`, `assertEmailAddress`, `assertHttpUrl`, `isEmailAddress`, `isUnsubscribeLink`) moved from `email.ts` to `template-rules.ts`. The package root exports them as before.
- `EmailBindingLike` is declared with the Cloudflare email transport; `@shware/workflow/cloudflare` still exports it.
