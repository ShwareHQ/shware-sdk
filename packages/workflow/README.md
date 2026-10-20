# @shware/workflow

Code-first customer journeys. Workflows are written as TypeScript, compiled to a
versioned IR, and executed by a single generic runner: the IR is data, so one
deployed Worker runs every journey. Events and profile fields are typed by a
shared Zod contract, messages are typed templates (React email, push, Slack,
Discord), and the host is a Cloudflare Worker on Cloudflare Workflows, with its
data in D1 or in your own Postgres.

```ts
const welcome = workflow({ id: 'welcome', trigger: trigger.event(e.sign_up) })
  .email(email.getting_started, { name: u.name })
  .delay('3 days')
  .waitUntil(performed(e.activated), {
    timeout: '7 days',
    onTimeout: (w) => w.email(email.nudge, { name: u.name }),
  });
```

## Install

```bash
pnpm add @shware/workflow zod
```

The peer dependencies are optional; install the ones the subpaths you use need:

| Peer                 | Needed by                                                                        |
| -------------------- | -------------------------------------------------------------------------------- |
| `react`, `react-dom` | `@shware/workflow/react-email`, and `@shware/workflow/cloudflare`, which uses it |
| `postgres`           | `@shware/workflow/postgres-js`                                                   |

Email components are usually written with `@react-email/components`, and the
Worker is deployed with `wrangler`.

## Quick start

A project has one contract, a set of templates, the workflows, and one
`workflow.config.ts` that registers all of it. The compiler, the Worker and the
Workflow Studio (`@shware/workflow-ui`) all read that one object.

### 1. The contract

The events journeys react to and the profile fields they read, as Zod schemas.
Put it in a module both the producer (your api) and the Worker can import.

```ts
import { defineContract } from '@shware/workflow';
import { email, looseObject, number, optional, strictObject, string } from 'zod/mini';

export const contract = defineContract({
  events: {
    login: looseObject({ method: string() }),
    purchase: looseObject({ transaction_id: string(), currency: string(), value: number() }),
  },
  profile: strictObject({ email: optional(email()), name: string() }),
});

/** The DSL's reference tables: `e.login`, `u.name`. */
export const e = contract.events;
export const u = contract.user;
```

Event payloads are object schemas (`looseObject` keeps extra analytics fields).
The profile is a flat object of string, number, boolean, enum and literal
fields. Defaults, transforms, coercion and custom refinements are refused when
the contract is defined, because input and output must mean the same JSON.

### 2. Templates

One object per template, identified by its own `id` (unique per channel): the
IR, the manifest, every send and the studio name it by that id, so keep it
stable and rename `title` instead. Its strict Zod `props` schema is the only
source of the props type: the DSL's arguments, the `preview` and the component
are all derived from it, and every send parses the props against it first.

```tsx
// src/email/welcome.tsx
import { Html, Text } from '@react-email/components';
import { emailTemplate } from '@shware/workflow';
import { strictObject, string } from 'zod/mini';

export default emailTemplate({
  id: 'welcome',
  from: { email: 'noreply@acme.test', name: 'Acme' },
  title: 'Welcome',
  props: strictObject({ name: string() }),
  subject: 'Welcome aboard',
  preview: { name: 'John Doe' },
  component: ({ name }) => (
    <Html>
      <Text>Welcome, {name}! Create your first project; it takes a minute.</Text>
    </Html>
  ),
});
```

Gather them per channel; the workflows send the definitions and the config
registers the whole:

```ts
// src/email/index.ts
import tip from './tip';
import welcome from './welcome';

export const email = { welcome, tip };
```

```ts
// src/templates.ts
import { email } from './email';

export const templates = { email };
```

`tip.tsx` is written the same way. The property names are JavaScript names
only. `.email(email.welcome, props)` checks `props` against that template's
schema, and a push template is not accepted where an email is. The compile
refuses an id registered twice in a channel, and a workflow sending a
definition other than the one registered under its id.

### 3. A workflow

```ts
// src/workflows/welcome.ts
import { not, performed, trigger, workflow } from '@shware/workflow';
import { e, u } from '../contract';
import { email } from '../email';

export const welcomeSeries = workflow({
  id: 'welcome_series',
  name: 'Welcome series',
  trigger: trigger.event(e.login),
  goal: { condition: performed(e.purchase), within: '7 days' },
})
  .email(email.welcome, { name: u.name })
  .delay('2 days')
  .branch([not(performed(e.purchase)), (w) => w.email(email.tip, { name: u.name })]);
```

`id` is wire identity (instances, the entry ledger and stats are keyed on it),
so rename `name` instead.

### 4. The config

```ts
// workflow.config.ts
import { defineConfig } from '@shware/workflow';
import { contract } from './src/contract';
import { templates } from './src/templates';
import { welcomeSeries } from './src/workflows/welcome';

export default defineConfig({
  title: 'Workflow Studio · Acme',
  contract,
  workflows: [welcomeSeries],
  templates,
  email: { unsubscribeUrl: 'https://acme.test/unsubscribe' },
  runtime: {
    development: { timeScale: 600, logMessages: true },
    production: { timeScale: 1, logMessages: false },
  },
});
```

### 5. The Worker

```ts
// src/index.ts
import { type JourneyEnv, journeyWorker } from '@shware/workflow/cloudflare';
import { postgresJsStore } from '@shware/workflow/postgres-js';
import { cloudflareEmailTransport } from '@shware/workflow/transports/cloudflare-email';
import config from '../workflow.config';

interface Env extends JourneyEnv {
  HYPERDRIVE: { connectionString: string };
  EMAIL: NonNullable<JourneyEnv['EMAIL']>;
}

const journeys = journeyWorker<Env>({
  config,
  store: (env, database) => postgresJsStore(env.HYPERDRIVE.connectionString, database),
  email: (env) => cloudflareEmailTransport({ binding: env.EMAIL }),
});

/** The wrangler `workflows` binding's class_name. */
export const AcmeJourneyRunner = journeys.Runner;

export default { fetch: journeys.fetch, scheduled: journeys.scheduled };
```

Leave `store` out to use the default D1 + KV store from the env's bindings (see
[Cloudflare setup](#cloudflare-setup)). On Postgres, create the engine's tables
first (see [Postgres](#postgres)).

```jsonc
// wrangler.jsonc
{
  "name": "acme-workflow",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-12",
  "compatibility_flags": ["nodejs_compat"],
  "workflows": [
    { "name": "acme-journey", "binding": "JOURNEY", "class_name": "AcmeJourneyRunner" },
  ],
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<hyperdrive id>" }],
  "send_email": [{ "name": "EMAIL" }],
  "vars": { "ENVIRONMENT": "production", "WORKFLOW_ORIGIN": "https://workflow.acme.test" },
  "triggers": { "crons": ["*/15 * * * *"] },
}
```

### 6. Deploy

```bash
wrangler secret put API_TOKEN
wrangler deploy
curl -X POST https://workflow.acme.test/bundle/deploy -H "authorization: Bearer $API_TOKEN"
```

`POST /bundle/deploy` compiles the config the Worker was built with and swaps
the routing table. Run it after every deploy that changes a journey.

### 7. Send events

From the service that knows what users do:

```ts
import { contract } from '@acme/workflow-contract';
import { JourneyClient } from '@shware/workflow/client';

export const journeys = new JourneyClient({
  contract,
  origin: 'https://workflow.acme.test',
  token: process.env.WORKFLOW_API_TOKEN,
});

await journeys.identify(user.id, { email: user.email, name: user.name });
await journeys.track(user.id, 'login', { method: 'google' }, { id: `login-${session.id}` });
```

Identify the properties a journey reads before the event that starts it.

## The three planes

| Plane     | What it is                                 | Where it lives                |
| --------- | ------------------------------------------ | ----------------------------- |
| Authoring | The DSL, compiled to IR by `compileBundle` | `@shware/workflow`            |
| Execution | The interpreter, over abstract ports       | `@shware/workflow/engine`     |
| Adapter   | Cloudflare bindings, ingest, runner        | `@shware/workflow/cloudflare` |

The interpreter never touches a database or a network. Everything it needs
arrives through the ports in `engine/ports.ts`, which is what makes a journey
testable without deploying one.

## Authoring

Chained calls and condition expressions build a serializable graph, never
runtime code. Sub-flow callbacks run exactly once, while the workflow is
defined, and runtime values are always references (`u.xxx`), not closures.

### Reference tables

`contract.events` and `contract.user` are the typed reference tables: `e.purchase`
is an event reference, `u.name` a profile reference (`u.userId` is always
there). Without a contract, build them from TypeScript types:

```ts
import { event, user } from '@shware/workflow';

const e = event<{ demo_signup: Record<never, never>; demo_purchase: { value: number } }>();
const u = user<{ userId: string; email: string; plan: string }>();
```

### `workflow(definition)`

| Option        | Meaning                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| `id`          | Wire identity; never rename it for readability                                    |
| `trigger`     | A `trigger.xxx()` asset                                                           |
| `goal`        | A condition, or `{ condition, within?, exitOnMatch? }`; exits on match by default |
| `exitWhen`    | Leave without counting as a conversion (unsubscribed, no longer eligible)         |
| `name`        | Studio label; metadata, outside the hash                                          |
| `description` | One line on what the flow does; metadata, outside the hash                        |

The goal is checked before each node runs. A `performed()` inside a goal counts
from workflow entry, so earlier history cannot satisfy it.

### Triggers

```ts
trigger.event(e.login);
trigger.event(e.purchase_failed, (p) => notInArray(p.code, ['CHECKOUT_CANCELED']));
trigger.event(e.sign_up, { filter: exists(u.email) });
trigger.segment(dormant7d);
trigger.date('2026-12-25 09:00:00');
trigger.webhook();
```

- `event` takes an optional payload `where` (typed by the event) and a profile
  `filter`; the user enters only when the event fired and both hold.
- `segment` starts the journey when a user goes from not matching a named
  segment to matching it. Membership is re-evaluated on the user's events and
  identifies, and by the segment sweep (the cron trigger), which catches
  segments entered by the clock alone.
- `date` (one-shot, UTC) and `webhook` compile and deploy, but are not routed
  by the runtime yet: deploy lists them in `unrouted`.

### Steps

| Step                                          | What it does                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `.email(email.k, props)`                      | Send an email                                                             |
| `.push(push.k, props, { devices? })`          | Push to every device of the user, or only the `'latest'`; skipped if none |
| `.slack(slack.k, props)`                      | Post to a Slack incoming webhook                                          |
| `.discord(discord.k, props)`                  | Post to a Discord webhook                                                 |
| `.sms()`, `.inApp()`, `.survey()`             | Message nodes with no built-in sender (see [Channels](#channels))         |
| `.prefer([first, second], props, { label? })` | One push and one email: the first the user is reachable on                |
| `.delay('1 day')`                             | Sleep; `{ min, max }` sleeps a random time in between                     |
| `.timeWindow({ days?, between, tz? })`        | Hold until inside a weekly window                                         |
| `.waitUntil(condition, opts)`                 | Wait for a condition, or time out                                         |
| `.branch(label?, ...arms)`                    | First-match branch; rejoins the main line afterwards                      |
| `.filter(condition, { reason? })`             | Exit unless the condition holds                                           |
| `.cohort(arms, { key? })`                     | Random A/B split; weights sum to 100                                      |
| `.exit(reason?)`                              | End the journey; inside an arm, do not rejoin                             |
| `.sendEvent(e.x, payload?)`                   | Emit an event, which may trigger another workflow                         |
| `.run(action, args)`                          | Run a custom action inside a durable step                                 |
| `.use(fragment)`                              | Splice a `flow(...)` fragment in place                                    |

Props may reference the profile (`{ name: u.name }`); references resolve at send
time and are parsed by the template then. Durations are typed literals such as
`'30 minutes'`, `'1 day'` or `'2 weeks'`, so a typo does not compile.

**prefer** is sugar for the branch it compiles to: the choice is made once when
the step is reached, and a first choice that fails to send retries as itself.
Both templates must declare the same props type.

```ts
workflow({ id: 'welcome_series', trigger: trigger.event(e.login) })
  .email(email.welcome, { name: u.name })
  .delay('1 day')
  .prefer([push.tip_push, email.tip], { name: u.name }, { label: 'tip by channel' });
```

**timeWindow** takes `between: ['09:00', '17:00']` (24-hour, leading zeros, not
overnight), `days` (all week by default) and `tz`: `'user'` (the default) reads
the profile's `timezone` property, an IANA id, falling back to UTC when it is
invalid; any other string is a fixed IANA zone.

**waitUntil** continues on the main line once the condition holds. On timeout it
does `onTimeout`: `'continue'` (the default), `'exit'`, or a sub-flow. A
`performed()` inside it counts from the moment the wait began.

```ts
workflow({ id: 'notification_optin', trigger: trigger.event(e.login) }).waitUntil(
  or(
    reachable('push'),
    performed(e.notification_permission, (p) => eq(p.status, 'granted'))
  ),
  {
    timeout: '1 day',
    onTimeout: (w) => w.email(email.enable_notifications, { name: u.name }),
  }
);
```

**branch** arms are `[condition, sub-flow]` tuples; a bare sub-flow in last
position is the default arm. With no match and no default, execution
continues.

```ts
workflow({ id: 'nps_followup', trigger: trigger.event(e.nps_sent) }).branch(
  'by score',
  [
    performed(e.nps_sent, (p) => gte(p.score, 9)),
    (w) => w.delay('1 day').email(email.review_ask, { name: u.name }),
  ],
  [
    performed(e.nps_sent, (p) => lte(p.score, 6)),
    (w) => w.slack(slack.nps_detractor, { name: u.name }).exit('handed to support'),
  ]
);
```

**cohort** arm names are letters, digits, `_` and `-`, not starting with a
digit, and weights have at most two decimals. Set `key` for any experiment you
intend to read: bucketing then hashes `userId:key`, so assignments survive
edits to the workflow.

```ts
workflow({ id: 'checkout_recovery', trigger: trigger.event(e.begin_checkout) })
  .delay('1 day')
  .cohort(
    {
      discount: { weight: 50, flow: (w) => w.email(email.offer_discount, { name: u.name }) },
      social_proof: { weight: 50, flow: (w) => w.email(email.offer_reviews, { name: u.name }) },
    },
    { key: 'checkout_offer_v1' }
  );
```

**sendEvent** carries scalar fields only (literals or `u.xxx`), and the event is
checked against the contract like any ingested one. Because the entry policy is
once per user, a self-triggering `sendEvent` does not loop yet.

**run** executes a custom action. The IR records only its name, args and a hash
of its code; the implementation ships in the Worker and is registered through
the config's `actions`. It is retried on throw, so pass `ctx.idempotencyKey` to
any external side effect.

```ts
import { action } from '@shware/workflow';

export const issueCoupon = action<{ code: string }>('issue_coupon', async ({ code }, ctx) => {
  await billing.issueCoupon({ code, userId: ctx.userId, idempotencyKey: ctx.idempotencyKey });
});

workflow({ id: 'winback', trigger: trigger.segment(dormant7d) }).run(issueCoupon, {
  code: '15OFF',
});
```

**flow** names a reusable fragment, for `.use()` or as a branch arm. Each use
gets its own copy:

```ts
const officeHours = flow((w) =>
  w.timeWindow({ days: ['mon', 'tue', 'wed', 'thu', 'fri'], between: ['09:00', '17:00'] })
);
```

### Conditions

| Function                                          | Meaning                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `eq`, `ne`                                        | Equal / not equal                                                 |
| `gt`, `gte`, `lt`, `lte`                          | Ordered comparison (string or number)                             |
| `between`, `notBetween`                           | Inclusive range                                                   |
| `inArray`, `notInArray`                           | Membership in a list                                              |
| `exists`, `notExists`                             | Property present / absent                                         |
| `contains`, `notContains`                         | Substring (string)                                                |
| `performed(e.x, where?, { within?, count? })`     | Did the event, optionally matching, in a window, at least N times |
| `reachable(channel)`                              | Push: has a registered device; other channels: has the address    |
| `and`, `or`, `not`                                | Combinators; nest freely                                          |
| `segment({ id, condition, name?, description? })` | A named condition: reusable, swept, usable as a trigger           |

Predicates take a profile reference (`eq(u.platform, 'ios')`), or, inside a
`where`, a payload reference (`(p) => gt(p.value, 100)`). Values are typed by
the reference, so `eq(u.platform, 'ios ')` against an enum does not compile.
"Did not do" is `not(performed(...))`.

```ts
export const dormant7d = segment({
  id: 'dormant_7d',
  name: 'Dormant (7d)',
  condition: and(performed(e.login), not(performed(e.login, { within: '7 days' }))),
});
```

Segments a workflow references must be passed in the config's `segments`, or
the compile fails.

## Channels

### Email

`emailTemplate({ id, from, replyTo?, unsubscribeUrl?, title, description?, props, subject, preview, component })`
declares one. The Worker renders it with `@shware/workflow/react-email` (React's
streaming renderer, which waits for react-email's `<Tailwind>`) and sends it
through the host's email transport, from the template's own `from`:

```ts
// src/email/welcome.tsx
export default emailTemplate({
  id: 'welcome',
  from: { email: 'noreply@acme.test', name: 'Acme' },
  replyTo: { email: 'support@acme.test', name: 'Acme Support' }, // left out: no Reply-To
  title: 'Welcome',
  props: strictObject({ name: string() }),
  subject: 'Welcome to Acme',
  preview: { name: 'John Doe' },
  component: ({ name }) => <Layout name={name}>…</Layout>,
});
```

There is no global sender: share addresses through a module of your own. The
unsubscribe link is the template's `unsubscribeUrl`, else the config's
`email.unsubscribeUrl`, else none (`resolveEmail` is the rule). A layout reads
it from the render, never from a constant, so a template's own URL reaches
its HTML:

```tsx
import { useEmailContext } from '@shware/workflow/email-context';

const { unsubscribeUrl } = useEmailContext();
{
  unsubscribeUrl !== undefined && <Link href={unsubscribeUrl}>Unsubscribe</Link>;
}
```

```ts
// workflow.config.ts
email: {
  unsubscribeUrl: 'https://acme.test/unsubscribe', // templates without their own
  tracking: { quickClickMs: 1_000 }, // the default
},
```

The transport is the host's `email` option, chosen independently of where the
workflow runs. Rendering, tracking and the tracked-link commit happen before it,
the same for every provider (`EmailSender`):

| Transport                                                                  | Import                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------- |
| `cloudflareEmailTransport({ binding })` — a Worker's `send_email`          | `@shware/workflow/transports/cloudflare-email` |
| `cloudflareEmailTransport({ accountId, apiToken })` — REST, anywhere       | `@shware/workflow/transports/cloudflare-email` |
| `sesEmailTransport({ region, credentials? })` — SES v2, SigV4 over `fetch` | `@shware/workflow/transports/ses`              |

`sesEmailTransport` runs in a Worker and in Node alike. Without `credentials` it
reads `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` at send
time (a Lambda's execution role); a Worker passes them, or a provider, from its
env. Delivery is at least once: SES has no de-duplication key, so an email the
provider accepted just before the step's checkpoint failed can go out twice.
A host whose workflows send email but that has no `email` option (nor a
`messages` override) fails when it is created, naming those workflows.

An email with an unsubscribe link also carries `List-Unsubscribe` (RFC 2369), so
a mail client's own unsubscribe button works. With reporting on (a Postgres store and
`WORKFLOW_ORIGIN`), it names the copy's one-click endpoint `/t/u/<message>`, together with
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Gmail and Yahoo require
one-click unsubscribe for bulk senders. The provider's POST there unsubscribes at once, and the
same URL opened in a browser asks first. Without reporting, the header names the template's own
unsubscribe link, with no one-click claim. Only https URLs are named, so a local `http://`
origin sends no header.

An email step refuses to send when the profile has no `email`.
`GET /preview/<id>?props=<JSON>` renders a template, with the subject in the
`x-subject` header.

### Push

`pushTemplate({ id, title, description?, props, preview, content })`, where
`content(props)` returns `{ title, body, image?, url? }`: final text, never
placeholder-expanded. `url` is the page a browser push opens.

```ts
export default pushTemplate({
  id: 'onboarding_tip_push',
  title: 'Onboarding tip (push)',
  props: strictObject({ name: string() }),
  preview: { name: 'John Doe' },
  content: ({ name }) => ({ title: 'A tip for today', body: `Face a window, ${name}.` }),
});
```

Pushes go to the devices the engine keeps. The app registers each token with
`JourneyClient.registerDevice(userId, { token, platform })`, and a token moves
to the latest user that registers it. Each platform is turned on by the config,
with its secret in the environment:

| Platform  | Config                                         | Secret                                  | Transport                  |
| --------- | ---------------------------------------------- | --------------------------------------- | -------------------------- |
| `ios`     | `apns: { topic, keyId, teamId, environment? }` | `APNS_PRIVATE_KEY_BASE64` (the `.p8`)   | `@shware/workflow/apns`    |
| `android` | `fcm: { androidChannelId? }`                   | `GOOGLE_APPLICATION_CREDENTIALS_BASE64` | `@shware/workflow/fcm`     |
| `web`     | `webPush: { subject, openedEvent? }`           | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `@shware/workflow/webpush` |

A secret is only read when something is sent on that platform. Tokens APNs,
FCM or a push service report as gone are removed, and waits on
`reachable('push')` wake on every device change.

`apns.environment` maps a mode to `sandbox` or `production`; unlisted modes use
`production` in production and `sandbox` otherwise. Generate a VAPID pair once
per environment with `generateVapidKeys()` from `@shware/workflow/webpush`.
`webPush.openedEvent` names the contract event a browser's notification tap is
also recorded as (`{ message_id }`), so conditions see web opens too.

APNs speaks HTTP/2 only, which `wrangler dev` cannot. Locally, run the relay
next to it and point the Worker at it with `APNS_RELAY_ORIGIN`:

```js
import { startApnsRelay } from '@shware/workflow/apns-relay';

const relay = await startApnsRelay({ port: 8280 });
// wrangler dev --var APNS_RELAY_ORIGIN:http://localhost:8280
```

### Slack and Discord

Team-channel messages go through incoming webhooks. The URL is a secret, so the
template reads it from the Worker's environment when it sends. Pass the
environment's Zod schema to `journeyWorker({ env })`: it is checked on the
first request, every problem listed, and the parsed values are what templates
see.

```ts
import { slackTemplate } from '@shware/workflow';
import { optional, strictObject, string } from 'zod/mini';
import type { Env } from '../env';

export default slackTemplate({
  id: 'nps_detractor',
  title: 'NPS detractor (support)',
  props: strictObject({ name: string(), email: optional(string()) }),
  preview: { name: 'John Doe', email: 'john@example.com' },
  webhook: (env: Env) => env.WEBHOOK_SLACK_SUPPORT,
  content: ({ name }) => ({ text: `${name} gave us a low NPS score` }),
});
```

`discordTemplate` takes the same fields; its `content` returns a Discord webhook
body (`content`, `embeds`, `allowed_mentions`, …). Register both under
`templates: { email, push, slack, discord }`. A request the channel refuses for
good settles the copy as undelivered rather than retrying, so a team-channel
post never holds up the messages after it.

### Other channels

`.sms()`, `.inApp()` and `.survey()` compile, and take a hand-typed reference
by key: `template.sms<P>(key)` (also `inApp`, `survey`). The config's channels deliver only email, push, Slack and
Discord; supply anything else with `journeyWorker({ messages })`.

## Configuration

`defineConfig` takes:

| Field       | Holds                                                                          |
| ----------- | ------------------------------------------------------------------------------ |
| `title`     | The Studio title                                                               |
| `contract`  | The `defineContract(...)` every `/events` and `/identify` is validated against |
| `workflows` | The workflows to deploy                                                        |
| `segments`  | Named segments                                                                 |
| `actions`   | Custom actions `.run()` uses                                                   |
| `templates` | The registries: `{ email?, push?, discord?, slack? }`                          |
| `email`     | `{ unsubscribeUrl?, tracking? }`: what every email template shares             |
| `runtime`   | Per mode (`development`, `production`, …): `{ timeScale?, logMessages? }`      |
| `apns`      | `{ topic, keyId, teamId, environment? }`                                       |
| `fcm`       | `{ androidChannelId? }`                                                        |
| `webPush`   | `{ subject, openedEvent? }`                                                    |
| `database`  | `{ schema? }`: the Postgres schema, `workflow` by default                      |

The `ENVIRONMENT` var picks the `runtime` entry (production when unset).
`timeScale` fast-forwards every duration: 600 turns "1 day" into 2.4 minutes.
Secrets never go in the config; the Worker reads them from its environment:

| Variable                                | Purpose                                                    |
| --------------------------------------- | ---------------------------------------------------------- |
| `API_TOKEN`                             | Bearer for every endpoint but `/health` and `/t/...`       |
| `WORKFLOW_ORIGIN`                       | Public origin for email tracking and push delivery reports |
| `ENVIRONMENT`                           | Which `runtime` entry and APNs environment apply           |
| `APNS_PRIVATE_KEY_BASE64`               | The APNs `.p8` key, base64                                 |
| `GOOGLE_APPLICATION_CREDENTIALS_BASE64` | The Firebase service account JSON, base64                  |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | The Web Push key pair                                      |
| `APNS_RELAY_ORIGIN`                     | Development only: the local APNs relay                     |

`journeyWorker` also takes `observer`, `messages` and `runtime` overrides, and
`contractMode: 'report'` to log contract refusals instead of answering 400.

## `JourneyClient`

`@shware/workflow/client` is the producer side: plain fetch, no dependencies.
With a `contract`, event names and payloads are typed and checked before
anything is sent (a refusal throws `JourneyValidationError`); a failed request
throws `JourneyClientError` with its status and body.

```ts
const journeys = new JourneyClient({ contract, origin, token });
```

| Method                                        | Endpoint                | Does                                                     |
| --------------------------------------------- | ----------------------- | -------------------------------------------------------- |
| `identify(userId, props)`                     | `POST /identify`        | Merge profile properties; `null` removes one             |
| `track(userId, event, payload, { id?, ts? })` | `POST /events`          | Record an event; starts and wakes journeys               |
| `registerDevice(userId, { token, platform })` | `POST /devices`         | Register a push token (`ios`, `android` or `web`)        |
| `unbindDevice(token)`                         | `POST /devices/unbind`  | Signed out: the token stays, bound to nobody             |
| `removeDevice(token)`                         | `POST /devices/remove`  | Forget a token for good                                  |
| `messageOpened(userId, messageId)`            | `POST /messages/opened` | A journey push tapped open (the `message_id` it carried) |
| `forgetUser(userId)`                          | `POST /users/forget`    | Stop the user's journeys and erase their data            |
| `deploy(bundle)`                              | `POST /deploy`          | Deploy a compiled bundle                                 |

Pass an `id` to `track` whenever a caller may retry; see
[Give each event an `id`](#give-each-event-an-id).

## Compiling and planning

`compileConfig(config)` returns the `BundleIR` the Worker deploys. It is
`compileBundle` plus a template manifest generated from the registries, and it
checks every message node: an unregistered or cross-channel template, a missing
or undeclared prop, a literal the schema refuses, or a `u.xxx` the contract's
profile does not declare fails with the workflow and node named
(`ConfigCompileError`).

`compileBundle({ workflows, segments?, templates?, actions? })` is the lower
level: it compiles each workflow, rejects duplicate ids, segment references
missing from the bundle, payload predicates outside a `where`, and actions that
are not passed in.

```ts
import { compileConfig, plan } from '@shware/workflow';
import config from './workflow.config';

const bundle = compileConfig(config);
const changes = plan(bundle, deployedBundle); // deployed: `GET /bundle` of the running Worker
if (changes.hasChanges) console.log(changes.workflows.filter((w) => w.status !== 'unchanged'));
```

`plan(local, deployed?)` diffs workflows, segments, templates and actions.
Each change is `added`, `removed`, `changed`, `metadata_only` or `unchanged`,
and a workflow change lists the fields (`trigger`, `goal`, `exitWhen`) and
nodes that moved. Omitting `deployed` plans a first deploy.

## Versioning

Every workflow carries a `contentHash` over its own IR, with metadata excluded,
so a reworded description is not a new version but a changed delay is. The hash
is the address the IR is stored under, and a journey is pinned to the hash it
entered on. An in-flight journey therefore finishes on the version it started,
however many times you deploy underneath it.

`plan()` diffs a compiled bundle against what is deployed and reports which
workflows actually changed. Deploy recomputes every declared hash and refuses a
bundle whose hashes do not describe its contents.

Node ids are structural paths, so inserting a node shifts the ids of the nodes
after it. Template ids are stable identities too: an id in flight takes only
backward-compatible changes, so a new required prop means a new id.

## Cloudflare setup

The default store needs three bindings, named as in `JourneyEnv`:

| Binding       | Type         | Holds                                     |
| ------------- | ------------ | ----------------------------------------- |
| `WORKFLOW_KV` | KV namespace | Compiled IR, content-addressed by hash    |
| `DB`          | D1 database  | Events, profiles, routing, entries, wakes |
| `JOURNEY`     | Workflow     | The `JourneyRunner` entrypoint            |

A Worker on Postgres needs only `JOURNEY`. Add the `EMAIL` send_email binding
when it sends through Cloudflare Email (`cloudflareEmailTransport({ binding: env.EMAIL })`), and a `triggers.crons` entry with `scheduled`
exported to run the segment sweep.

Set `API_TOKEN` in production. Without it every mutating endpoint is open, and
`/deploy` rewrites the whole routing table.

The D1 schema ships with the package. Apply it before the first deploy:

```bash
wrangler d1 execute <database> --file node_modules/@shware/workflow/dist/cloudflare/schema.sql
```

Nothing in the adapter creates these tables at runtime, so this step is not
optional. The same file lives at `src/cloudflare/schema.sql` in this repo and is
the single source for both.

There are no migrations, and re-applying the file is not one: every statement is
`CREATE TABLE IF NOT EXISTS`, so an existing database keeps its old tables and
the first insert needing a new column fails. Recreate it instead. The demo has
`pnpm db:reset`.

## AWS Lambda

The same config runs as one Lambda durable function behind a Function URL, on
Postgres. `@aws/durable-execution-sdk-js` and `@aws-sdk/client-lambda` are optional
peer dependencies, needed only by `@shware/workflow/aws`. The durable SDK's own type
declarations reference `aws-lambda`, so a TypeScript project that type-checks
dependencies (no `skipLibCheck`) also needs `@types/aws-lambda`.

```ts
// src/aws.ts
import { journeyLambda } from '@shware/workflow/aws';
import { postgresJsStore } from '@shware/workflow/postgres-js';
import { sesEmailTransport } from '@shware/workflow/transports/ses';
import config from '../workflow.config';
import { env } from './env.aws'; // process.env, parsed with zod

const journeys = journeyLambda({
  config,
  env,
  store: (env, database) => postgresJsStore(env.DATABASE_URL, database),
  email: (env) => sesEmailTransport({ region: env.AWS_REGION }),
});

export const handler = journeys.handler;
```

One handler serves three inputs, told apart by the event's top-level shape, so
no HTTP body can pass for the others:

- **A Function URL request**: the HTTP API, as on Cloudflare. A journey it
  starts is its own durable execution, submitted with an asynchronous `Invoke`
  of this function's numbered version under a stable execution name, and the
  request returns.
- **A run** (`$workflow.run`): one instance. Steps, delays and waits map onto
  the durable SDK's `step`, `wait` and callbacks; a wait parks on a fresh
  callback, recorded in Postgres, which the next relevant event completes.
- **A sweep** (`{ "type": "$workflow.sweep" }`, from EventBridge Scheduler, or
  `POST /segments/sweep` from an existing cron): the segment sweep, plus
  retrying starts whose submit was never confirmed and reconciling executions
  the platform ended (timeout, stop) into the ledger. Without one, clock-only
  segments and this upkeep do not happen.

A start is recorded with its entry in one transaction (the `execution` table),
so a lost `Invoke` response is retried with the same name and payload and never
re-entered as a second execution. Retries stop after 12 hours (`startRetryMs`,
keep it under the execution retention) and the start is left unresolved. A
failed entry that is entered again gets a new execution, never the closed one.

Erasing a user (`POST /users/forget`) stops their executions, then waits
`stopDrainMs` (15 minutes by default; at least the function's timeout) before
erasing: a stop does not interrupt an invocation already running, which goes on
to its next checkpoint. Until then the erasure answers `erased: false` and the
sweep finishes it.

Deploy one artifact per version: publish a numbered version and point the
`live` alias, which the Function URL is bound to, at it. Each version carries its
compiled bundle and makes it live by itself, only over an older one. Each route
records the version that applied it, and an instance it starts runs on that
version, so its IR and its code always match, even while an older version is
still serving; executions stay on the version that started them. `POST /deploy` of an arbitrary bundle is
refused.

```yaml
Workflow:
  Type: AWS::Serverless::Function
  Properties:
    Runtime: nodejs24.x
    Handler: aws.handler
    Timeout: 60
    AutoPublishAlias: live
    # ExecutionTimeout: the longest journey (waits, delays and the goal window), up to 366 days;
    # pass the same value to journeyLambda({ executionTimeoutMs }) to check it at startup
    DurableConfig: { ExecutionTimeout: 2592000, RetentionPeriodInDays: 30 }
    FunctionUrlConfig: { AuthType: NONE, InvokeMode: BUFFERED }
```

The execution role needs the durable checkpoint permissions,
`lambda:InvokeFunction` on its own versions, `lambda:SendDurableExecutionCallbackSuccess`,
`lambda:GetDurableExecution`, `lambda:ListDurableExecutionsByFunction` and
`lambda:StopDurableExecution`, plus `ses:SendEmail` when it sends through SES.
With `AuthType: NONE`, scope the public `lambda:InvokeFunction` grant to
`lambda:InvokedViaFunctionUrl = true` so the URL cannot be used to invoke the
function directly. APNs goes over Node's HTTP/2 client; a custom domain needs
CloudFront (or another HTTPS proxy) in front of the Function URL.

## Postgres

A host on Postgres (through Hyperdrive, say) keeps Cloudflare Workflows for
execution and the data in its own database:

```ts
const journeys = journeyWorker<Env>({
  config,
  store: (env, database) => postgresJsStore(env.HYPERDRIVE.connectionString, database),
});
export default { fetch: journeys.fetch, scheduled: journeys.scheduled };
```

The engine's tables live in one Postgres schema, `workflow` unless the config
says `database: { schema }`, so their short names never meet the app's. The
host owns the migrations. `npx workflow-ui generate --out <file>` (from
`@shware/workflow-ui`) writes the tables as one drizzle file on that schema;
re-export it from your drizzle schema and let drizzle-kit write the migration.
Run `--check` in CI to catch an SDK upgrade that changed them. Without drizzle,
`renderPostgresDdl()` returns the same tables as plain DDL. Nothing creates or
alters them at runtime: `POST /bundle/deploy` checks the live database first
and answers 503 with every missing table or column.

### Deploying is `wrangler deploy`

The journeys are compiled into the Worker, so a new version carries its own
bundle. Add Cloudflare's version metadata binding and each new version makes
that bundle live by itself, with nothing to call after `wrangler deploy`:

```jsonc
// wrangler.jsonc
"version_metadata": { "binding": "CF_VERSION_METADATA" }
```

The first request or cron run an isolate serves reads which version's bundle
is live (one row, `workflow.deployment`) and applies its own only over an older
version, in the same transaction that records it. Isolates of the old version
keep serving for a few seconds after a deploy; they can never put their routes
back. Until the new version first runs, events still follow the old routes.
The check runs once per isolate, in the background; a failure (migrations not
applied, say) is logged and retried a minute later.

With a gradual deployment the newest version's bundle goes live as soon as
that version serves its first request, whatever share of traffic it has.

`wrangler rollback` restores an older version, which does not apply itself over
the newer one. Call `POST /bundle/deploy` after a rollback: it applies the
running version's bundle whatever is live. The D1 store keeps no version, so
on D1 every deploy is that call.

On Postgres the engine also keeps:

- **Reporting.** Instances, every message copy, opens and clicks, recorded
  by the default observer. With `WORKFLOW_ORIGIN` set, email links and an open
  pixel are tracked through the Worker's `/t/...` routes. Each open and click
  is classified as a person's or a machine's (Apple Mail Privacy Protection,
  link scanners, prefetches). An email's unsubscribe link gets a confirmation
  page; which link that is was fixed when the email was sent.
  A push carries `message_id`; report the tap with `messageOpened`.
- **Segments.** The cron trigger runs `sweepSegments`, which keeps every
  segment's membership and size and starts the journeys of segments entered by
  the clock alone. `POST /segments/sweep` runs it on demand.

`@shware/workflow-ui/postgres` reads all of it for the studio.

## HTTP surface

`handleRequest` serves the ingest API:

- `GET /health` is the only unauthenticated one.
- `POST /events` takes `{ userId, event, payload?, ts?, id? }` and answers with
  the id the occurrence was recorded under. Event names beginning with `$` are
  reserved for internal use.
- `POST /identify` takes `{ userId, props }` and merges the properties into the
  profile. A property set to `null` is removed, which is the only way to unset
  one.
- `POST /devices` takes `{ userId, token, platform, ts? }`;
  `POST /devices/unbind` and `POST /devices/remove` take `{ token }`.
- `POST /messages/opened` takes `{ userId, messageId }`.
- `POST /users/forget` takes `{ userId }`.
- `POST /deploy` takes a compiled bundle and swaps the routing table atomically.

`journeyWorker` adds `GET /bundle` (the compiled config), `POST /bundle/deploy`
(deploy it), `GET /preview/<key>`, `POST /segments/sweep`, and the `/t/...`
tracking routes recipients open, which need no bearer. With a contract, an
event or identify it refuses is answered with a 400 and the field paths, before
anything is stored, woken or started.

### Give each event an `id`

`id` is the occurrence's identity, and sending the same one twice records it
once. This matters because every count- and window-based condition reads the
event log, so a second copy of one event silently changes what a journey
decides.

Only the sender knows whether two deliveries describe one occurrence or two, so
the engine never guesses. An event that arrives without an id is given a fresh
one, which records it as its own occurrence. If you retry a request, send an id
you can reproduce and the retry costs nothing.

```json
{ "id": "order-8841-confirmed", "userId": "u_123", "event": "purchase" }
```

Use something that identifies the occurrence, not the event name: a row id from
your own system, an upstream webhook's delivery id, or a message id from your
queue. Workflows emitting events through `.sendEvent()` already do this, passing
the node's identity within the running instance.

## Entry policy

A user enters a workflow at most once. The entry ledger's primary key enforces
it, which also makes the check atomic under concurrent ingests. The one
exception is an entry whose instance died: that row records a failure, not a
journey the user received, so the next trigger reclaims it. Re-entry beyond that
is a design question this package does not yet answer.

## Exports

| Subpath                        | Contents                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `@shware/workflow`             | The DSL, `defineContract`, `defineConfig`, `compileConfig`, `compileBundle`, `plan`, templates, IR |
| `@shware/workflow/engine`      | The interpreter (`runJourney`) and its ports, condition evaluation, bucketing                      |
| `@shware/workflow/cloudflare`  | `journeyWorker`, `JourneyRunner`, `handleRequest`, the router functions, senders, stores           |
| `@shware/workflow/store`       | The `JourneyStore` port, D1 and Postgres stores, `renderPostgresDdl`, `renderDrizzleSchema`        |
| `@shware/workflow/client`      | `JourneyClient`, the producer side of the HTTP API                                                 |
| `@shware/workflow/postgres-js` | `postgresJsStore`, the Postgres store over postgres.js (peer `postgres`)                           |
| `@shware/workflow/react-email` | `registryRenderer`, the email renderer over the registry (peers `react`, `react-dom`)              |
| `@shware/workflow/push`        | `registryPushRenderer`, push content from the registry                                             |
| `@shware/workflow/apns`        | `ApnsPushSender`, token-based APNs over HTTP/2                                                     |
| `@shware/workflow/apns-relay`  | `startApnsRelay`, the Node HTTP/1.1 to HTTP/2 relay for `wrangler dev`                             |
| `@shware/workflow/fcm`         | `FcmPushSender`, FCM HTTP v1 for Android                                                           |
| `@shware/workflow/webpush`     | `WebPushSender` and `generateVapidKeys`, standard Web Push with VAPID                              |
| `@shware/workflow/webhooks`    | `SlackWebhookSender` and `DiscordWebhookSender`                                                    |
| `@shware/workflow/schema.sql`  | The D1 schema file                                                                                 |

## Testing

See [TESTING.md](./TESTING.md). The interpreter runs against in-memory ports and
the Cloudflare adapter against fakes that dispatch on the exact SQL strings the
real code sends, so changing a query means updating the fake, deliberately.

In an app, `compileConfig(config)` makes the compiled IR snapshot-testable, and
`runJourney` from `@shware/workflow/engine` runs a journey against an in-memory
host, with `registryRenderer` and `registryPushRenderer` rendering what it
sends.
