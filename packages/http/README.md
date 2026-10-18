# @shware/http

HTTP building blocks shared by Shware servers and clients: a Google-style error model (`Status`,
`StatusError`, `Details`) with client-side parsers, cursor pagination types and helpers, a
Snowflake ID generator, Hono middlewares (error handler, zod validation, CSRF, authorization, rate
limiting), Google One Tap sign-in, Standard Webhooks verification and a few small server utilities.

## Install

```bash
pnpm add @shware/http
```

Optional peer dependencies, needed only for the parts that use them:

```bash
pnpm add hono     # @shware/http/hono
pnpm add i18next  # types for getErrorMessage()
```

`react` is also declared as an optional peer; no entry point currently requires it.

## Entry points

| Import                        | Contents                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| `@shware/http`                | Error model and parsers, pagination, ids, constants, utilities |
| `@shware/http/hono`           | Hono error handler, zod validators and security middlewares    |
| `@shware/http/google-one-tap` | Browser Google One Tap (FedCM) with an OAuth code fallback     |
| `@shware/http/webhook`        | `verifyStandardWebhook()` for Standard Webhooks                |
| `@shware/http/polyfills`      | Side-effect import making `BigInt` JSON-serializable           |

## Error model

Errors follow the [Google API error model](https://cloud.google.com/apis/design/errors): a
canonical status code mapped to an HTTP status, a message, and a list of typed details.

```json
{
  "error": {
    "code": 400,
    "status": "INVALID_ARGUMENT",
    "message": "The client specified an invalid argument",
    "details": [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "INVALID_CODE" }]
  }
}
```

### Status

Each `Status.*` factory takes an optional message (a default English message is used otherwise)
and returns a `StatusCode` with three ways to emit it:

```ts
import { Details, Status } from '@shware/http';

// throw it: a StatusError (or whatever Status.adapter returns)
throw Status.notFound('Team not found').error();

// return it: a JSON Response with the matching HTTP status
return Status.invalidArgument("a batch is one visitor's events").response();

// just the body: ErrorBody
const body = Status.internal().body();
```

| Factory                     | Status                | HTTP |
| --------------------------- | --------------------- | ---- |
| `Status.invalidArgument`    | `INVALID_ARGUMENT`    | 400  |
| `Status.failedPrecondition` | `FAILED_PRECONDITION` | 400  |
| `Status.outOfRange`         | `OUT_OF_RANGE`        | 400  |
| `Status.unauthorized`       | `UNAUTHENTICATED`     | 401  |
| `Status.permissionDenied`   | `PERMISSION_DENIED`   | 403  |
| `Status.notFound`           | `NOT_FOUND`           | 404  |
| `Status.methodNotAllowed`   | `METHOD_NOT_ALLOWED`  | 405  |
| `Status.alreadyExists`      | `ALREADY_EXISTS`      | 409  |
| `Status.aborted`            | `ABORTED`             | 409  |
| `Status.resourceExhausted`  | `RESOURCE_EXHAUSTED`  | 429  |
| `Status.cancelled`          | `CANCELLED`           | 499  |
| `Status.unknown`            | `UNKNOWN`             | 500  |
| `Status.internal`           | `INTERNAL`            | 500  |
| `Status.dataLoss`           | `DATA_LOSS`           | 500  |
| `Status.unimplemented`      | `UNIMPLEMENTED`       | 501  |
| `Status.unavailable`        | `UNAVAILABLE`         | 503  |
| `Status.deadlineExceeded`   | `DEADLINE_EXCEEDED`   | 504  |
| `Status.ok`                 | `OK`                  | 200  |

### Details

`Details.new()` builds the `details` array with chainable methods mirroring
[`google.rpc` error details](https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto):
`errorInfo`, `retryInfo`, `debugInfo`, `quotaFailure`, `preconditionFailure`, `badRequest`,
`requestInfo`, `resourceInfo`, `help` and `localizedMessage`.

```ts
import { Details, Status } from '@shware/http';

const details = Details.new()
  .errorInfo({ reason: 'RATE_LIMIT_EXCEEDED' })
  .retryInfo({ retryDelay: 60_000 });

throw Status.resourceExhausted('Too many requests, please try again later').error(details);
```

### StatusError and Status.adapter

By default `.error()` returns a `StatusError` carrying `status` (the HTTP status) and `body` (the
`ErrorBody`). With Hono, the `errorHandler` from `@shware/http/hono` turns it into a response (see
below). Without it, handle it yourself:

```ts
import { Status, StatusError } from '@shware/http';
import { Hono } from 'hono';

const app = new Hono();

app.onError((error, c) => {
  if (error instanceof StatusError) return c.json(error.body, error.status as 400);
  return c.json(Status.internal().body(), 500);
});

app.get('/', () => {
  throw Status.invalidArgument('Hello World!').error();
});
```

To have `.error()` produce a framework-native error instead, set `Status.adapter` once at startup:

```ts
import { Status } from '@shware/http';
import { HTTPException } from 'hono/http-exception';

Status.adapter = (status, body) => {
  const res = Response.json(body, { status });
  return new HTTPException(status as 400, { res });
};
```

### Custom ErrorReason

By default, `ErrorInfo.reason` accepts any `string`. You can use TypeScript
[declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html) to
constrain it to a set of known keys:

```ts
// e.g. src/http.d.ts
import '@shware/http'; // Required: makes this file a module so `declare module` augments it

declare module '@shware/http' {
  interface ErrorReason {
    ACCOUNT_BLOCKED: string;
    RATE_LIMIT_EXCEEDED: string;
    SUBSCRIPTION_EXPIRED: string;
  }
}
```

Once declared, `errorInfo({ reason })`, `isErrorReason()` and `getErrorMessage()` only accept or
return the keys you defined, with autocomplete:

```ts
import { Details } from '@shware/http';

// OK
Details.new().errorInfo({ reason: 'ACCOUNT_BLOCKED' });

// Type error: Type '"INVALID"' is not assignable to type 'keyof ErrorReason'
Details.new().errorInfo({ reason: 'INVALID' });
```

A convenient pattern is to reuse the keys of your i18n error namespace, so every reason has a
translation:

```ts
import '@shware/http';
import type { ErrorReason as I18nErrorReason } from '@repo/i18n';

declare module '@shware/http' {
  interface ErrorReason extends I18nErrorReason {}
}
```

`rateLimit` from `@shware/http/hono` emits `RATE_LIMIT_EXCEEDED`; include it if you use it.

### Reading errors on the client

The parsers take the decoded response body (`unknown`) and never throw:

- `getErrorInfo(data)` returns the `ErrorInfo` detail or `null`.
- `isErrorReason(data, ...reasons)` checks whether the body carries one of the given reasons.
- `getFieldViolations(data)` returns the `BadRequest` field violations (`[]` if none).
- `getErrorMessage(data, t)` returns `{ reason, message }`, preferring a `LocalizedMessage`, then
  `t(reason, metadata)`, then the English message, then `t(status)`, then `t('UNKNOWN')`.

```ts
import { getErrorInfo, getFieldViolations, isErrorReason } from '@shware/http';
import { HTTPError } from 'ky';

const login = useMutation({
  mutationFn: api.auth.loginEmail,
  meta: { handledReasons: ['INVALID_VERIFICATION_CODE'] },
  onError: (e) => {
    if (!(e instanceof HTTPError)) return;
    if (isErrorReason(e.data, 'INVALID_VERIFICATION_CODE')) {
      setError('verificationCode', { message: t('INVALID_VERIFICATION_CODE', { ns: 'error' }) });
      return;
    }
    getFieldViolations(e.data).forEach(({ field, description }) => {
      setError(field as Path<LoginEmailDTO>, { message: description });
    });
  },
});

// a global handler that skips the reasons a mutation handles itself
new MutationCache({
  onError: (e, _variables, _context, mutation) => {
    if (!(e instanceof HTTPError)) return;
    if (isErrorReason(e.data, ...(mutation.meta?.handledReasons ?? []))) return;
    const info = getErrorInfo(e.data);
    toast.error(info ? i18n.t(info.reason, { ns: 'error', ...info.metadata }) : 'Unknown error');
  },
});
```

### Client-side error classes

`LoginTimeoutError`, `LoginCanceledError` and `CheckoutCreateError` are plain `Error` subclasses
for sign-in and checkout flows; `PurchaseError` is a const enum of purchase failure codes
(`LOGIN_TIMEOUT`, `LOGIN_CANCELED`, `CHECKOUT_CANCELED`, `CHECKOUT_CREATE_FAILED`,
`CHECKOUT_SESSION_ID_NOT_FOUND`, `UNKNOWN`).

## Hono (`@shware/http/hono`)

| Export         | Description                                                          |
| -------------- | -------------------------------------------------------------------- |
| `errorHandler` | `app.onError` handler turning any error into an `ErrorBody` response |
| `zValidator`   | zod / zod mini validator; failures become `INVALID_ARGUMENT`         |
| `zBeaconJson`  | `json` validator that also accepts `text/plain` beacon bodies        |
| `bigintId`     | zod mini schema parsing a decimal string into a `bigint`             |
| `csrf`         | Double-submit cookie CSRF check (`XSRF-TOKEN` / `X-XSRF-TOKEN`)      |
| `authorizer`   | Requires authentication on the paths matching `rules`                |
| `rateLimit`    | Token-bucket rate limiter backed by any async key-value store        |
| `geolocation`  | Visitor geolocation from Cloudflare, Vercel or CloudFront headers    |

### Wiring an app

`errorHandler` reads `c.get('requestId')`, so register Hono's `requestId()` middleware. Every
error response gets a `RequestInfo` detail; 5xx are logged with `console.error`, 4xx with
`console.warn`.

```ts
import '@shware/http/polyfills';
import { Status } from '@shware/http';
import { type CSRFConfig, authorizer, csrf, errorHandler } from '@shware/http/hono';
import { OAuth2Error } from '@shware/security';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';

const csrfConfig: CSRFConfig = {
  origin: ['https://app.example.com'],
  secFetchSite: ['same-origin', 'same-site', 'none'],
  ignores: [
    '/login/oauth2/code/*',
    '/v1/webhooks/*',
    { path: '/v1/analytics/*', methods: ['POST'] },
  ],
};

const app = new Hono();

app.onError((error, c) => {
  // map third-party errors to a Status before delegating
  if (error instanceof OAuth2Error) return errorHandler(Status.unauthorized().error(), c);
  return errorHandler(error, c);
});

app.use(requestId());
app.use(csrf(csrfConfig));
app.use(
  authorizer({
    auth, // { isAuthenticated: (request: Request) => Promise<boolean> }
    rules: ['/v1/user/*', '/v1/credits/*', { path: '/v1/analytics/links', methods: ['POST'] }],
  })
);
```

`csrf` lets safe methods (`GET`, `HEAD`, `OPTIONS` by default), allowed `origin`s, allowed
`Sec-Fetch-Site` values and `ignores` through; otherwise it compares the cookie and header tokens
and throws `PERMISSION_DENIED`. `authorizer` skips `OPTIONS` and throws `UNAUTHENTICATED` for
matching paths when `auth.isAuthenticated()` is false.

### Validation

```ts
import { pageParamsSchema } from '@shware/http';
import { bigintId, geolocation, zBeaconJson, zValidator } from '@shware/http/hono';
import { object } from 'zod/mini';

app.get('/v1/credits/usages', zValidator('query', pageParamsSchema()), async (c) => {
  const { limit, prev, next } = c.req.valid('query');
  // ...
});

app.get('/v1/teams/:id', zValidator('param', object({ id: bigintId })), async (c) => {
  const { id } = c.req.valid('param'); // bigint
  // ...
});

app.post('/v1/analytics/events', zBeaconJson(createTrackEventSchema), async (c) => {
  const events = c.req.valid('json');
  const geo = geolocation(c); // { ip_address, country, city, region, time_zone, ... }
  // ...
});
```

### Rate limiting

```ts
import { rateLimit } from '@shware/http/hono';

app.use(
  '/v1/auth/*',
  rateLimit({
    kv, // { getItem, setItem(key, value, expiresIn?), removeItem }
    rate: 1, // tokens refilled per second
    capacity: 10,
    // optional: getIdentifier (defaults to client IP), skip, onRateLimited, keyPrefix, expiresIn
  })
);
```

It sets `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; when exhausted it
adds `Retry-After` and answers `RESOURCE_EXHAUSTED` with `RATE_LIMIT_EXCEEDED` and `RetryInfo`.

## Pagination

Cursor pagination types (`Page<T>`, `PageParams`, `Response<T>`, `Empty`, ...) and helpers shared
by the API and its clients.

Server side, `pageParamsSchema(max = 100, defaultLimit = 20)` validates `limit`, `prev` and
`next`, and `Cursor` encodes ids into opaque base64 tokens:

```ts
import { Cursor, type Page, pageParamsSchema } from '@shware/http';
import { zValidator } from '@shware/http/hono';
import { hasText } from '@shware/utils';

app.get('/v1/credits/usages', zValidator('query', pageParamsSchema()), async (c) => {
  const { prev, next, limit } = c.req.valid('query');
  const before = hasText(next) ? Cursor.decode(next, 'string') : undefined;
  const list = await findUsages({ before, limit: limit + 1 });

  const hasMore = list.length > limit;
  const data = hasMore ? list.slice(0, limit) : list;
  const paging = hasMore ? Cursor.of(data.at(0)?.id, data.at(-1)?.id) : Cursor.empty();
  return c.json<Page<CreditUsage>>({ data, paging });
});
```

Client side, the page param helpers plug straight into TanStack Query:

```ts
import { getNextPageParam, getPreviousPageParam, initialPageParam } from '@shware/http';

const query = useInfiniteQuery({
  queryKey: ['charges'],
  initialPageParam,
  getNextPageParam: getNextPageParam<Charge>,
  getPreviousPageParam: getPreviousPageParam<Charge>,
  queryFn: ({ pageParam }) => api.purchase.listCharges({ limit: 20, ...pageParam }),
});
```

`Pages` (`flatten`, `dedupe`, `prepend`, `append`, `update`, `updateById`, `remove`,
`removeById`) and `Items` (`push`, `unshift`, `pushAndDedupe`, `unshiftAndDedupe`, `update`,
`updateById`, `remove`, `removeById`) return updater functions for `setQueryData` on infinite and
plain list queries:

```ts
import { Pages } from '@shware/http';

queryClient.setQueryData(['charges'], Pages.removeById<Charge>(id));
```

## Google One Tap (`@shware/http/google-one-tap`)

Browser-only. `prompt()` loads the Google Identity Services script and shows One Tap via FedCM. It
never rejects; when One Tap cannot run (`fedcm_unsupported`, `script_load_failed`,
`prompt_error`) fall back to `requestCode()`, an OAuth 2.0 authorization-code popup that must be
called from a user gesture.

```ts
import { prompt, requestCode } from '@shware/http/google-one-tap';

const result = await prompt({ client_id: GOOGLE_CLIENT_ID });

if (result.authorized) {
  await api.auth.loginOAuth2Onetap(result.credential); // { credential: ID token, select_by }
} else if ('unsupported' in result) {
  // later, on a button click:
  const code = await requestCode({ client_id: GOOGLE_CLIENT_ID });
  if (code.ok) await exchangeCodeOnBackend(code.response.code);
}
```

## Webhooks (`@shware/http/webhook`)

`verifyStandardWebhook<T>(headers, payload, secret)` verifies the `webhook-id`,
`webhook-timestamp` (5 minute tolerance) and `webhook-signature` headers against a base64 secret
and returns the parsed payload, or throws `INVALID_ARGUMENT`. Node.js `crypto` is required.

```ts
import { verifyStandardWebhook } from '@shware/http/webhook';

app.post('/v1/webhooks/acme', async (c) => {
  const event = verifyStandardWebhook<AcmeEvent>(c.req.header(), await c.req.text(), secret);
  // ...
  return c.body(null, 204);
});
```

## Polyfills (`@shware/http/polyfills`)

Import once at the entry point so `bigint` values (e.g. Snowflake ids) serialize as strings in
`JSON.stringify` and `c.json()` instead of throwing:

```ts
import '@shware/http/polyfills';
```

## Other utilities

### Snowflake ids

`uid` is a ready-made `UidGenerator` with a random machine id; create your own with
`new UidGenerator(machineId)` (10-bit machine id, 12-bit sequence, epoch 2020-01-01).

```ts
import { uid } from '@shware/http';

const id: bigint = uid.next();
```

### Column lengths

`MAX_LENGTH` holds maximum lengths for common identifiers, handy for database columns and
validators: `UUID`, `DEVICE_ID`, `ADVERTISING_ID`, `IP`, `TIMEZONE`, `COUNTRY_CODE`,
`LANGUAGE_CODE`, `EMAIL`, `PHONE_NUMBER` and more.

```ts
import { MAX_LENGTH } from '@shware/http';

const email = varchar('email', { length: MAX_LENGTH.EMAIL }); // 320
```

### Countries

`ISO_3601_1` is the list of ISO 3166-1 countries (`{ numeric, name, alpha2, alpha3 }`, typed as
`ISO3166CountryCode`).

```ts
import { ISO_3601_1 } from '@shware/http';

app.get('/v1/iso/countries', (c) => c.json({ data: ISO_3601_1 }));
```

### Geolocation and Google Tag Gateway

`getGeolocation(request)` reads visitor location headers from Vercel, Cloudflare or CloudFront.
`forwardToGoogleTagGateway(request, gaId)` proxies a first-party measurement path to Google Tag
Gateway, forwarding cookies, client hints and geolocation:

```ts
import { forwardToGoogleTagGateway } from '@shware/http';

// e.g. a catch-all route at /metrics/*
const proxy = ({ request }: { request: Request }) => forwardToGoogleTagGateway(request, GA_ID);
```

### Server-Timing

`timing()` collects metrics and writes `Server-Timing` (and `Timing-Allow-Origin`) headers:

```ts
import { timing } from '@shware/http';

const t = timing();
t.startTime('db', 'Database');
const rows = await query();
t.endTime('db');

const response = Response.json(rows);
t.setTiming(response);
```
