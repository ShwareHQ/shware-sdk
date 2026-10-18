# @shware/security

Session-based authentication for any server that speaks the Fetch API (`Request` → `Response`):
Hono, Cloudflare Workers, Next.js route handlers and similar. It ships an `Auth` class with
handlers for CSRF, logout, OAuth2 (redirect, native, Google One Tap), email verification-code
sign-in and desktop sign-in, backed by pluggable session stores (Redis or your own database) that
use the Spring Session key layout, so sessions can be shared with a Spring backend.

## Install

```sh
pnpm add @shware/security
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
import { Hono } from 'hono';
import { Redis } from 'ioredis';
import { Auth, PATH, RedisIndexedSessionRepository, RedisKVRepository } from '@shware/security';
import { apple, github } from '@shware/security/oauth2/provider';
import { env } from './env';
import { onAuthorized } from './services/auth';

const redis = new Redis(env.REDIS_URL);

// namespace must end with ':session'
const sessionRepository = new RedisIndexedSessionRepository(redis, 'mywebsite:session');
sessionRepository.setDefaultMaxInactiveInterval(30 * 24 * 60 * 60); // seconds

const auth = new Auth({
  timing: true,
  sessionRepository,
  kvRepository: new RedisKVRepository(redis),
  oauth2: {
    client: {
      baseUri: 'https://api.mywebsite.com', // backend, used to build redirect URIs
      errorUri: 'https://mywebsite.com', // receives ?error=...&error_description=...
      successUri: 'https://mywebsite.com', // receives ?status=success&registrationId=...
      provider: { apple, github },
      registration: async () => ({
        appleApp: {
          provider: 'apple',
          clientId: env.OAUTH2_APPLE_APP_CLIENT_ID,
          clientSecret: env.OAUTH2_APPLE_APP_CLIENT_SECRET,
        },
        appleWeb: {
          provider: 'apple',
          clientId: env.OAUTH2_APPLE_WEB_CLIENT_ID,
          clientSecret: env.OAUTH2_APPLE_WEB_CLIENT_SECRET,
        },
        github: {
          clientId: env.OAUTH2_GITHUB_CLIENT_ID,
          clientSecret: env.OAUTH2_GITHUB_CLIENT_SECRET,
        },
      }),
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

A registration whose key is not a provider name (`appleApp`, `appleWeb`) sets `provider`; otherwise
the key itself is used (`github`). The key is the `:registrationId` in the routes.

### The `onAuthorized` handler

Every login method takes an `AuthorizedHandler`: create or update your user and return the
`Principal` whose `name` is stored in the session.

```ts
import type { OAuth2Token, Principal, Provider, UserInfo } from '@shware/security';

const PROVIDER_BY_REGISTRATION: Record<string, Provider | undefined> = {
  github: 'GITHUB',
  appleApp: 'APPLE',
  appleWeb: 'APPLE',
  EMAIL: 'EMAIL', // registration id used by loginEmail
};

export async function onAuthorized(
  request: Request,
  registrationId: string,
  { claims }: UserInfo,
  token?: OAuth2Token
): Promise<Principal> {
  const provider = PROVIDER_BY_REGISTRATION[registrationId];
  if (!provider) throw new Error(`Unknown registration: ${registrationId}`);
  const userId = await upsertUser(provider, claims.sub, claims.email);
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
| `oauth2.client`      | `OAuth2ClientConfig`                | `baseUri`, `errorUri`, `successUri`, `provider`, `registration` (object or async function).   |
| `turnstileSecretKey` | `string`                            | Cloudflare Turnstile secret; required by `sendEmailVerificationCode`.                         |
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
  (`setItem(key, value, expiresIn?)`, `getItem`, `removeItem`) to use another store.

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
until shortly before it expires, so you can mint it inside an async `registration` function:

```ts
import { apple, createAppleClientSecret, github, google } from '@shware/security/oauth2/provider';

const appleClientSecret = createAppleClientSecret({
  teamId: env.OAUTH2_APPLE_TEAM_ID,
  keyId: env.OAUTH2_APPLE_KEY_ID,
  privateKey: env.OAUTH2_APPLE_P8, // PKCS#8 PEM contents of the .p8 key
});

const auth = new Auth({
  sessionRepository,
  kvRepository,
  oauth2: {
    client: {
      baseUri: 'https://api.mywebsite.com',
      errorUri: 'https://mywebsite.com?status=error',
      successUri: 'https://mywebsite.com?status=success',
      provider: { apple, github, google },
      registration: async () => ({
        github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
        google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
        // native app: its bundle id
        apple: {
          clientId: env.APPLE_APP_CLIENT_ID,
          clientSecret: await appleClientSecret(env.APPLE_APP_CLIENT_ID),
        },
        // web: its Services ID
        appleWeb: {
          provider: 'apple',
          clientId: env.APPLE_WEB_CLIENT_ID,
          clientSecret: await appleClientSecret(env.APPLE_WEB_CLIENT_ID),
        },
      }),
    },
  },
});
```

The redirect URI defaults to `${baseUri}/login/oauth2/code/<registrationId>`; set
`redirectUri` on a registration to override it, and `scope` to override the provider's defaults.

### Web redirect flow

1. The browser opens `GET /oauth2/authorization/:registrationId`. `oauth2Authorization` stores the
   state and PKCE verifier in the session and redirects to the provider.
2. The provider calls back `GET|POST /login/oauth2/code/:registrationId` (Apple uses `form_post`,
   so register both). `loginOAuth2Code` checks state, exchanges the code, calls `onAuthorized`
   and redirects to `successUri`, or to `errorUri` with `error` and `error_description`.

### Native login

Mobile apps sign in with the platform SDK and post the result to
`POST /login/oauth2/native/:registrationId`. The body is a `NativeCredential`
(`{ id_token?, access_token?, code?, state?, client_id?, redirect_uri? }`). `loginOAuth2Native`
verifies it with the provider, calls `onAuthorized`, creates a session and returns the
`Principal` as JSON with the session cookie.

To bind an Apple `id_token` to this request, fetch a nonce first from
`GET /oauth2/nonce/:registrationId` (`oauth2Nonce`) and pass it to the Apple SDK; when the token
carries a `nonce`, `loginOAuth2Native` requires it to match one issued for the same registration
and consumes it.

```ts
const { nonce } = await fetch(`${api}/oauth2/nonce/apple`).then((r) => r.json());
// ... Sign in with Apple with `nonce`, then:
await fetch(`${api}/login/oauth2/native/apple`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id_token: identityToken }),
});
```

### Google One Tap

`POST /login/oauth2/onetap/google` accepts the One Tap `credential` (an `id_token`) or a `code`,
as form data or JSON. The third argument of `loginOAuth2Onetap` is the registration id (default
`'google'`).

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
  registration id `'EMAIL'` and claims `{ sub: email, email, email_verified: true }`.

`sendPhoneVerificationCode` and `loginPhone` exist but currently answer `501 not_implemented`.

## Routes (`PATH`)

`PATH` holds the route patterns the handlers parse `:registrationId` from, so mount each handler on
its own constant.

| Constant                       | Path                                    | Handler                                           |
| ------------------------------ | --------------------------------------- | ------------------------------------------------- |
| `CSRF`                         | `/csrf`                                 | `csrf` (double-submit `XSRF-TOKEN` cookie)        |
| `LOGOUT`                       | `/logout`                               | `logout`                                          |
| `LOGGED`                       | `/logged`                               | `logged` (`{ data: boolean }`, renews the cookie) |
| `OAUTH2_STATE`                 | `/oauth2/state/:registrationId`         | `oauth2State`                                     |
| `OAUTH2_NONCE`                 | `/oauth2/nonce/:registrationId`         | `oauth2Nonce`                                     |
| `OAUTH2_AUTHORIZATION`         | `/oauth2/authorization/:registrationId` | `oauth2Authorization`                             |
| `LOGIN_OAUTH2_CODE`            | `/login/oauth2/code/:registrationId`    | `loginOAuth2Code` (GET and POST)                  |
| `LOGIN_OAUTH2_NATIVE`          | `/login/oauth2/native/:registrationId`  | `loginOAuth2Native`                               |
| `LOGIN_OAUTH2_ONETAP`          | `/login/oauth2/onetap/google`           | `loginOAuth2Onetap`                               |
| `LOGIN_EMAIL`                  | `/login/email`                          | `loginEmail`                                      |
| `LOGIN_PHONE`                  | `/login/phone`                          | `loginPhone` (not implemented)                    |
| `SEND_EMAIL_VERIFICATION_CODE` | `/auth/sendEmailVerificationCode`       | `sendEmailVerificationCode`                       |
| `SEND_PHONE_VERIFICATION_CODE` | `/auth/sendPhoneVerificationCode`       | `sendPhoneVerificationCode` (not implemented)     |
| `DESKTOP_AUTHORIZE`            | `/auth/desktop/authorize`               | `desktopAuthorize`                                |
| `DESKTOP_EXCHANGE`             | `/auth/desktop/exchange`                | `desktopExchange`                                 |
| `CLEANUP_EXPIRED_SESSIONS`     | `/sessions/expired/cleanup`             | `cleanupExpiredSessions`                          |

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
