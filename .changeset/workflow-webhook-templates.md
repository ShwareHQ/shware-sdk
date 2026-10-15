---
'@shware/workflow': minor
---

`discordTemplate` and `slackTemplate`: messages posted to a team channel through an incoming webhook, declared like email and push templates (a zod `props` schema, a `preview`, a pure `content`) and referenced as `t.discord.<key>` / `t.slack.<key>`. Discord content is typed by `discord-api-types` (content, embeds, …), Slack's by `@slack/types` (Block Kit). The webhook URL stays in the environment: `webhook: (env: Env) => env.WEBHOOK_DISCORD_SALES`, read at send time from the values `journeyWorker({ env: schema })` validated with zod when the Worker first ran — an invalid environment answers 500 listing every variable at fault (never its value). Delivery is plain fetch (`@shware/workflow/webhooks`); a deleted webhook or archived channel settles the message undelivered, a rate limit throws to retry. Slack and Discord messages no longer read a per-user `slack_user_id` / `discord_user_id`.
