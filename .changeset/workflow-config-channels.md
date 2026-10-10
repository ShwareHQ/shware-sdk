---
'@shware/workflow': minor
'@shware/workflow-ui': minor
---

One flat `workflow.config.ts` for the whole host: `JourneyConfig` (`runtime` per mode, `emails` with `from` / `replyTo`, `apns`, `fcm`) is exported from `@shware/workflow`, and `journeyWorker({ config, store, emails, pushes, bundle })` assembles the email sender, the per-platform push senders (`ApnsPushSender` for `ios`, `FcmPushSender` for `android`), the renderers, the preview and the runtime from it — secrets come from the environment under fixed names (`APNS_PRIVATE_KEY_BASE64`, `GOOGLE_APPLICATION_CREDENTIALS_BASE64`, `API_TOKEN`, dev-only `APNS_RELAY_ORIGIN`), and `ENVIRONMENT` picks the mode. `EmailAddress` / `EmailBindingLike` moved next to the config and bindings (still re-exported from `./cloudflare`). The studio's `WorkflowUIConfig` extends `JourneyConfig`; its address book is derived from `emails.from` / `replyTo` unless `addresses` is listed.
