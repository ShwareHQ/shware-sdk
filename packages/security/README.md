# @shware/security

Session-based authentication for any server that speaks the Fetch API (`Request` → `Response`):
Hono, Cloudflare Workers, Next.js route handlers and similar. It ships an `Auth` class with
handlers for CSRF, logout, OAuth2 (redirect, native, Google One Tap), email verification-code
sign-in and desktop sign-in, backed by pluggable session stores (Redis or your own database) that
use the Spring Session key layout, so sessions can be shared with a Spring backend.

## Install

```sh
pnpm add @shware/security zod
```

No peer dependencies. `ioredis` is a regular dependency; you only need a client instance if you
use the Redis repositories.

## Entry points

| Import path                        | Contents                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@shware/security`                 | `Auth`, `PATH`, session/KV repositories, `OAuth2Client`, `OAuth2Error`, `PROVIDERS` and types                    |
| `@shware/security/oauth2/provider` | Built-in OAuth2 providers (`apple`, `facebook`, `github`, `google`, `wechat`, `x`) and `createAppleClientSecret` |

## Quick start (Hono)

```ts
import { Auth, PATH, RedisIndexedSessionRepository, RedisKVRepository } from '@shware/security';
import { apple, createAppleClientSecret, github, google } from '@shware/security/oauth2/provider';
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { env } from './env';
import { onAuthorized } from './services/auth';

const redis = new Redis(env.REDIS_URL);

// namespace must end with ':session'
const sessionRepository = new RedisIndexedSessionRepository(redis, 'mywebsite:session');
sessionRepository.setDefaultMaxInactiveInterval(30 * 24 * 60 * 60); // seconds

const appleClientSecret = createAppleClientSecret({
  teamId: env.OAUTH2_APPLE_TEAM_ID,
  keyId: env.OAUTH2_APPLE_KEY_ID,
  privateKey: env.OAUTH2_APPLE_P8, // PKCS#8 PEM contents of the .p8 key
});

const auth = new Auth({
  timing: true,
  sessionRepository,
  kvRepository: new RedisKVRepository(redis),
  oauth2: {
    client: {
      baseUri: 'https://api.mywebsite.com', // backend, used to build redirect URIs
      errorUri: 'https://mywebsite.com', // receives ?error=...&error_description=...
      successUri: 'https://mywebsite.com', // receives ?status=success&provider=...
      providers: {
        apple: {
          provider: apple,
          web: { clientId: env.OAUTH2_APPLE_SERVICES_ID, clientSecret: appleClientSecret },
          native: [{ clientId: env.OAUTH2_APPLE_BUNDLE_ID, clientSecret: appleClientSecret }],
        },
        google: {
          provider: google,
          web: {
            clientId: env.OAUTH2_GOOGLE_WEB_CLIENT_ID,
            clientSecret: env.OAUTH2_GOOGLE_SECRET,
          },
          // installed-app clients are public: no secret
          native: [
            { clientId: env.OAUTH2_GOOGLE_IOS_CLIENT_ID },
            { clientId: env.OAUTH2_GOOGLE_ANDROID_CLIENT_ID },
          ],
        },
        github: {
          provider: github,
          web: { clientId: env.OAUTH2_GITHUB_CLIENT_ID, clientSecret: env.OAUTH2_GITHUB_SECRET },
        },
      },
    },
  },
});

const app = new Hono();

app.get(PATH.CSRF, (c) => auth.csrf(c.req.raw));
app.get(PATH.LOGGED, (c) => auth.logged(c.req.raw));
app.post(PATH.LOGOUT, (c) => auth.logout(c.req.raw));

app.get(PATH.OAUTH2_STATE, (c) => auth.oauth2State(c.req.raw));
app.get(PATH.OAUTH2_NONCE, (c) => auth.oauth2Nonce(c.req.raw));
app.get(PATH.OAUTH2_AUTHORIZATION, (c) => auth.oauth2Authorization(c.req.raw));
app.get(PATH.LOGIN_OAUTH2_CODE, (c) => auth.loginOAuth2Code(c.req.raw, onAuthorized));
app.post(PATH.LOGIN_OAUTH2_CODE, (c) => auth.loginOAuth2Code(c.req.raw, onAuthorized));
app.post(PATH.LOGIN_OAUTH2_NATIVE, (c) => auth.loginOAuth2Native(c.req.raw, onAuthorized));
app.post(PATH.LOGIN_OAUTH2_ONETAP, (c) => auth.loginOAuth2Onetap(c.req.raw, onAuthorized));

export default app;
```

### Providers and clients

`providers` is keyed by **identity source**: one key per namespace of `sub`. Its key is the
`:provider` in the routes and `authorization.provider` in `onAuthorized`. Each entry names the
implementation (`provider`) and the clients users sign in through:

- `web`: the client of the redirect flow and of Google One Tap (a Google web client, an Apple
  Services ID, a GitHub OAuth app). `redirectUri` defaults to
  `${baseUri}/login/oauth2/code/<provider key>`; `scope` overrides the implementation's defaults.
- `native`: the clients apps sign in as on the device (an iOS bundle id, Google's iOS / Android
  clients). The app sends its `client_id` with the native login, which must be one of the
  provider's clients (`web` included); without one, the only `native` client is used, or `web`
  when there is no `native` one. Several `native` clients and no `client_id` is refused.

`clientSecret` is a string, a function `clientId => secret` called on each use with that client's
id (`createAppleClientSecret` returns one), or absent for a public client. `providers` may also be
an async function, called per request.

Two keys may share an implementation when their users are separate namespaces, e.g. two Google
Cloud projects: `{ google: { provider: google, ... }, googleWorkspace: { provider: google, ... } }`.

### The `onAuthorized` handler

Every login method takes an `AuthorizedHandler`: create or update your user and return the
`Principal` whose `name` is stored in the session. It gets the request and an `Authorization`
object — `{ provider, clientId?, userInfo, token?, attributes }` — so fields are named, not
positional. `provider` plus `userInfo.claims.sub` identify the user, whichever client they came
through; `clientId` tells the surfaces apart (absent for email sign-in, whose `provider` is
`EMAIL`).

```ts
import type { Authorization, Principal, Provider } from '@shware/security';

const PROVIDERS: Record<string, Provider | undefined> = {
  apple: 'APPLE',
  google: 'GOOGLE',
  github: 'GITHUB',
  EMAIL: 'EMAIL', // provider used by loginEmail
};

export async function onAuthorized(
  request: Request,
  { provider, userInfo: { claims } }: Authorization
): Promise<Principal> {
  const method = PROVIDERS[provider];
  if (!method) throw new Error(`Unknown provider: ${provider}`);
  const userId = await upsertUser(method, claims.sub, claims.email);
  return { name: userId };
}
```

`PROVIDERS` is the list of `Provider` values (`APPLE`, `GITHUB`, `GOOGLE`, ..., `EMAIL`, `PHONE`),
handy for a database enum.

## `Auth` options

| Option               | Type                                | Notes                                                                                         |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `sessionRepository`  | `SessionRepository`                 | Required. Where sessions live (see below).                                                    |
| `kvRepository`       | `KVRepository`                      | Required. Short-lived values: OAuth2 state/nonce, verification and desktop codes.             |
| `cookie`             | `CookieOptions & { name?: string }` | Session cookie. Defaults: name `SESSION`, `path: '/'`, `SameSite=None`, `Secure`, `HttpOnly`. |
| `oauth2.client`      | `OAuth2ClientConfig`                | `baseUri`, `errorUri`, `successUri`, `providers` (object or async function).                  |
| `turnstileSecretKey` | `string`                            | Cloudflare Turnstile secret; required by `sendEmailVerificationCode`.                         |
| `verificationCode`   | `{ maxAttempts?, resendCooldown? }` | Email code limits: guesses per code (default 5), seconds between sends (default 60).          |
| `timing`             | `boolean`                           | Adds a `Server-Timing` header to OAuth2 responses.                                            |

The session id is read from the cookie or from an `Authorization: Bearer <session id>` header.

Besides the route handlers, `Auth` exposes session helpers: `getPrincipal(request)`,
`isAuthenticated(request)`, `getSession(request, create)`, `listSessions(principal)`,
`deleteSession(sessionId)`, `kick(principal)` (deletes all of a user's sessions) and
`cleanupExpiredSessions(cleanupCount?)`.

```ts
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

export async function getUserId(c: Context) {
  const principal = await auth.getPrincipal(c.req.raw);
  if (!principal) throw new HTTPException(401);
  return principal.name;
}
```

Errors thrown by providers during the token exchange are `OAuth2Error` (`status`, `error`), which
you can map to a 401 in your error handler:

```ts
import { OAuth2Error } from '@shware/security';

app.onError((error, c) => {
  if (error instanceof OAuth2Error) return c.json({ error: error.error }, 401);
  throw error;
});
```

## Session repositories

All repositories implement `SessionRepository` and index sessions by principal name
(`PRINCIPAL_NAME_INDEX_NAME`), so `kick` and `listSessions` work.

- `RedisIndexedSessionRepository(redis, namespace = 'spring:session')`: Spring Session's Redis
  indexed layout (`<namespace>:sessions:<id>` hashes, a principal index set, and an expirations
  sorted set). Takes an `ioredis` client.
- `DBIndexedSessionRepository(adapter)`: for any database; you implement `DBAdapter`
  (`save`, `deleteById`, `findById`, `findByPrincipalName`, `cleanupExpiredSessions`).
- `RedisKVRepository(redis)`: `KVRepository` on Redis. Implement `KVRepository`
  (`setItem(key, value, expiresIn?)`, `getItem`, `removeItem`, `increment(key, expiresIn)`) to use
  another store. `increment` must be atomic: it creates an absent or expired key at 1 expiring in
  `expiresIn` seconds, otherwise adds 1 and keeps the expiry, and returns the new count.

Both session repositories have `setDefaultMaxInactiveInterval(seconds)` (default 1800).

A database-backed setup with Drizzle:

```ts
import {
  Auth,
  DBIndexedSessionRepository,
  type DBAdapter,
  type KVRepository,
} from '@shware/security';

type SessionEntity = Parameters<DBAdapter['save']>[0];

class SessionAdapter implements DBAdapter {
  async save(entity: SessionEntity) {
    await db
      .insert(session)
      .values(toRow(entity))
      .onConflictDoUpdate({ target: session.sessionId, set: toRow(entity) });
  }
  async deleteById(sessionId: string) {
    await db.delete(session).where(eq(session.sessionId, sessionId));
  }
  async findById(sessionId: string) {
    const [row] = await db.select().from(session).where(eq(session.sessionId, sessionId));
    return row ? toEntity(row) : null;
  }
  async findByPrincipalName(principalName: string) {
    const rows = await db.select().from(session).where(eq(session.principalName, principalName));
    return rows.map(toEntity);
  }
  async cleanupExpiredSessions(cleanupCount = 1000) {
    // delete up to cleanupCount rows whose expiryTime has passed
  }
}

class DBKVRepository implements KVRepository {
  async setItem(key: string, value: string, expiresIn?: number) {
    /* upsert with expiresAt = now + expiresIn seconds */
  }
  async getItem(key: string) {
    /* return the value if not expired, else null */
    return null;
  }
  async removeItem(key: string) {
    /* delete by key */
  }
  async increment(key: string, expiresIn: number) {
    // one atomic upsert, e.g. on Postgres with kv(key text primary key, value text, expires_at timestamptz):
    // insert into kv (key, value, expires_at) values ($1, '1', now() + make_interval(secs => $2))
    // on conflict (key) do update set
    //   value = case when kv.expires_at <= now() then '1' else (kv.value::int + 1)::text end,
    //   expires_at = case when kv.expires_at <= now() then excluded.expires_at else kv.expires_at end
    // returning value::int
    return 1;
  }
}

const sessionRepository = new DBIndexedSessionRepository(new SessionAdapter());
sessionRepository.setDefaultMaxInactiveInterval(30 * 24 * 60 * 60);

export const auth = new Auth({ sessionRepository, kvRepository: new DBKVRepository() });
```

## OAuth2 providers

`@shware/security/oauth2/provider` exports ready-made providers to put in `oauth2.client.provider`:

| Export     | Notes                                                               |
| ---------- | ------------------------------------------------------------------- |
| `apple`    | Sign in with Apple (web `form_post` callback and native `id_token`) |
| `facebook` | Facebook Login                                                      |
| `github`   | GitHub OAuth app                                                    |
| `google`   | Google, including One Tap / FedCM (`loginOAuth2Onetap`)             |
| `wechat`   | WeChat                                                              |
| `x`        | X (Twitter) OAuth 2.0                                               |

Apple has no static client secret; `createAppleClientSecret` signs one per client id and caches it
until shortly before it expires. Pass the function itself as the `clientSecret` of every Apple
client, as in the quick start: the app's bundle id and the web's Services ID share the key and get
a secret each.

### Id token verification

Every id token (Apple, Google, Facebook Limited Login) is checked for its signature, expiry,
issuer and audience. The audience must be the client the token was meant for: the client the
code was exchanged as, the client the native login resolved, or the web client for One Tap. A
token issued to any other app on the same identity provider is refused.

| Implementation | Accepted `iss`                                       |
| -------------- | ---------------------------------------------------- |
| `apple`        | `https://appleid.apple.com`                          |
| `google`       | `https://accounts.google.com`, `accounts.google.com` |
| `facebook`     | `https://www.facebook.com`                           |

Facebook's native login also takes a classic `access_token`, which the Graph API would serve to
any app; it is sent with an `appsecret_proof`, so the client needs its `clientSecret`.

### Web redirect flow

1. The browser opens `GET /oauth2/authorization/:provider`. `oauth2Authorization` stores the
   state and PKCE verifier in the session and redirects to the provider.
2. The provider calls back `GET|POST /login/oauth2/code/:provider` (Apple uses `form_post`,
   so register both). `loginOAuth2Code` checks state, exchanges the code as the `web` client,
   calls `onAuthorized` and redirects to `successUri` with `status=success&provider=<key>`, or to
   `errorUri` with `error` and `error_description`.

#### Carrying data to `onAuthorized` (`attributes`)

Something known when the flow starts may be needed when the user comes back — a referral code in
a cookie, a `?ref=` parameter, where to go after sign-in. The callback is the wrong place to look
for it: Apple's `form_post` is a cross-site POST that drops `SameSite=Lax` cookies, and query
parameters do not survive the provider round trip. Attach it to the authorization request instead
(like Spring Security's `OAuth2AuthorizationRequest` attributes):

```ts
app.get(PATH.OAUTH2_AUTHORIZATION, (c) =>
  auth.oauth2Authorization(c.req.raw, {
    attributes: { referralCode: getCookie(c, 'REFERRAL_CODE') },
  })
);

export async function onAuthorized(request: Request, { attributes }: Authorization) {
  const referralCode = attributes.referralCode;
  // ...
}
```

- Stored with the authorization request in the session (the same JSON as `state` and the PKCE
  verifier), never sent to the provider, so no extra storage, expiry or cleanup.
- Handed to `onAuthorized` as `authorization.attributes` only after the session, `state` and
  provider check out, and removed with the authorization request after a successful login,
  so they are used once.
- String values only; `undefined` values are dropped; at most 2 KB serialized (they are written
  with the session).
- Logins that post a body — native, One Tap (JSON) and email — take an optional `attributes`
  field in that body instead, since the SDK consumes the body before `onAuthorized` runs:
  `{ "id_token": "…", "attributes": { "referralCode": "abc123" } }`. Same rules (string values,
  at most 2 KB); an invalid one is a `400`. Without it the handler gets `attributes: {}`.
- They come from the browser that started the flow: trust them like a cookie — fine for
  attribution or a post-login destination, not for authorization decisions.

### Native login

Mobile apps sign in with the platform SDK and post the result to
`POST /login/oauth2/native/:provider`. The body is a `NativeCredential`
(`{ id_token?, access_token?, code?, state?, client_id?, redirect_uri?, fullName? }`); `client_id`
picks the client (see [Providers and clients](#providers-and-clients)). `loginOAuth2Native`
verifies it with the provider, calls `onAuthorized`, creates a session and returns the
`Principal` as JSON with the session cookie.

To bind an id token to this request, fetch a nonce first from `GET /oauth2/nonce/:provider`
(`oauth2Nonce`) and pass it to the platform SDK; when the token carries a `nonce`,
`loginOAuth2Native` requires it to match one issued for the same provider and consumes it.

```ts
const { nonce } = await fetch(`${api}/oauth2/nonce/apple`).then((r) => r.json());
// ... Sign in with Apple with `nonce`, then:
await fetch(`${api}/login/oauth2/native/apple`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: authorizationCode, fullName: credential.fullName }),
});
```

### Google One Tap

`POST /login/oauth2/onetap/google` accepts the One Tap `credential` (an `id_token`) or a `code`,
as form data or JSON, both issued to the `web` client of the provider. The third argument of
`loginOAuth2Onetap` is the provider key (default `'google'`).

## Email sign-in

A six-digit code, valid for 10 minutes, protected by Cloudflare Turnstile. Set
`turnstileSecretKey` and wire both routes; you supply the function that delivers the email.

```ts
const auth = new Auth({
  sessionRepository,
  kvRepository,
  turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
});

app.post(PATH.SEND_EMAIL_VERIFICATION_CODE, (c) =>
  auth.sendEmailVerificationCode(c.req.raw, async ({ email, verificationCode }) => {
    await sendMail({ to: email, subject: 'Your sign-in code', text: verificationCode });
  })
);
app.post(PATH.LOGIN_EMAIL, (c) => auth.loginEmail(c.req.raw, onAuthorized));
```

- `POST /auth/sendEmailVerificationCode` with `{ email, turnstileToken }`.
- `POST /login/email` with `{ email, verificationCode }`. On success `onAuthorized` is called with
  `provider: 'EMAIL'`, claims `{ sub: email, email, email_verified: true }` and no `token`.

Both routes trim the email and lowercase it before validating, so `" Jane@Example.com "` is
`"jane@example.com"` everywhere: the address the sender receives, the code, its attempt counter and
resend cooldown, and the claims' `sub` and `email`. The local part is lowercased too: case-sensitive
mailboxes are allowed by RFC 5321 but practically unused, and honouring them would let one mailbox
hold several accounts.

Error reasons (`google.rpc.ErrorInfo`), all `400 INVALID_ARGUMENT` unless noted:

| Reason                                | When                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `TURNSTILE_VERIFICATION_FAILED`       | The Turnstile token was rejected.                                                 |
| `VERIFICATION_CODE_RESEND_TOO_SOON`   | `429 RESOURCE_EXHAUSTED`: a code was sent to this email within `resendCooldown`.  |
| `EMAIL_DELIVERY_FAILED`               | The sender threw; the cooldown is released, so the user can retry at once.        |
| `INVALID_VERIFICATION_CODE`           | Wrong code, or no code is pending for this email.                                 |
| `VERIFICATION_CODE_ATTEMPTS_EXCEEDED` | More than `maxAttempts` guesses at this code; it is discarded, ask for a new one. |

Every login attempt against a pending code is counted before the code is compared, so parallel
requests cannot exceed `maxAttempts` guesses either. A new code starts with a fresh budget.

`sendPhoneVerificationCode` and `loginPhone` exist but currently answer `501 not_implemented`.

## Routes (`PATH`)

`PATH` holds the route patterns the handlers parse `:provider` from, so mount each handler on
its own constant.

| Constant                       | Path                              | Handler                                           |
| ------------------------------ | --------------------------------- | ------------------------------------------------- |
| `CSRF`                         | `/csrf`                           | `csrf` (double-submit `XSRF-TOKEN` cookie)        |
| `LOGOUT`                       | `/logout`                         | `logout`                                          |
| `LOGGED`                       | `/logged`                         | `logged` (`{ data: boolean }`, renews the cookie) |
| `OAUTH2_STATE`                 | `/oauth2/state/:provider`         | `oauth2State`                                     |
| `OAUTH2_NONCE`                 | `/oauth2/nonce/:provider`         | `oauth2Nonce`                                     |
| `OAUTH2_AUTHORIZATION`         | `/oauth2/authorization/:provider` | `oauth2Authorization`                             |
| `LOGIN_OAUTH2_CODE`            | `/login/oauth2/code/:provider`    | `loginOAuth2Code` (GET and POST)                  |
| `LOGIN_OAUTH2_NATIVE`          | `/login/oauth2/native/:provider`  | `loginOAuth2Native`                               |
| `LOGIN_OAUTH2_ONETAP`          | `/login/oauth2/onetap/google`     | `loginOAuth2Onetap`                               |
| `LOGIN_EMAIL`                  | `/login/email`                    | `loginEmail`                                      |
| `LOGIN_PHONE`                  | `/login/phone`                    | `loginPhone` (not implemented)                    |
| `SEND_EMAIL_VERIFICATION_CODE` | `/auth/sendEmailVerificationCode` | `sendEmailVerificationCode`                       |
| `SEND_PHONE_VERIFICATION_CODE` | `/auth/sendPhoneVerificationCode` | `sendPhoneVerificationCode` (not implemented)     |
| `DESKTOP_AUTHORIZE`            | `/auth/desktop/authorize`         | `desktopAuthorize`                                |
| `DESKTOP_EXCHANGE`             | `/auth/desktop/exchange`          | `desktopExchange`                                 |
| `CLEANUP_EXPIRED_SESSIONS`     | `/sessions/expired/cleanup`       | `cleanupExpiredSessions`                          |

`cleanupExpiredSessions` has no authentication of its own; prefer calling it from a scheduled job
over exposing the route.

## Desktop sign-in

Desktop apps (Electron, Tauri) sign in through the system browser and receive a session over a
loopback redirect, using a PKCE-protected single-use code:

```ts
app.post(PATH.DESKTOP_AUTHORIZE, (c) => auth.desktopAuthorize(c.req.raw));
app.post(PATH.DESKTOP_EXCHANGE, (c) => auth.desktopExchange(c.req.raw));
```

See [docs/desktop-sign-in.md](./docs/desktop-sign-in.md) for the full flow, web and desktop
client code, and security notes.
