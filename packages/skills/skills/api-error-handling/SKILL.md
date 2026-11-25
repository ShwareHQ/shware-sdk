---
name: api-error-handling
description: Raise, validate and handle API errors with the @shware/http error model (Status, Details, ErrorReason, zValidator, getErrorInfo, isErrorReason, getFieldViolations). Use when writing a server route that can fail, or client code that reacts to a failed request.
---

# API error handling

Every API error is one envelope, the [Google API error model](https://cloud.google.com/apis/design/errors): a canonical status, an English message for developers, and typed details. The server never hand-writes an error response, and the client never parses one by hand.

```json
{
  "error": {
    "code": 400,
    "status": "INVALID_ARGUMENT",
    "message": "Verification code is invalid",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "INVALID_VERIFICATION_CODE"
      },
      { "@type": "type.googleapis.com/google.rpc.RequestInfo", "requestId": "…" }
    ]
  }
}
```

Users never read `message`. The client shows the translation of `ErrorInfo.reason`, so **a failure the user should understand needs a reason**.

## Server

### Raising an error

Throw `Status.<code>(message).error(details?)`; `errorHandler` from `@shware/http/hono` (registered with `app.onError`) turns it into the envelope. Use `.response()` instead when returning rather than throwing (e.g. `app.notFound`).

```ts
import { Details, Status } from '@shware/http';

// A failure the client reacts to: name it with a reason.
if (subscription.canceledAt) {
  const details = Details.new().errorInfo({ reason: 'SUBSCRIPTION_ALREADY_CANCELED' });
  throw Status.failedPrecondition('Subscription is already canceled').error(details);
}

// A failure no client distinguishes: the status alone is enough.
if (!team) throw Status.notFound('Team not found').error();

app.notFound(() => Status.notFound('Not found').response());
```

Never `return c.json({ error: '…' }, 400)` or `throw new Error('…')` for an expected failure: the first skips the envelope, the second becomes a bare `INTERNAL` (500, logged as a server error, shown as "unexpected error").

Pick the status by meaning, not by habit:

| Situation                                                  | Factory                     | HTTP |
| ---------------------------------------------------------- | --------------------------- | ---- |
| Malformed or invalid input                                 | `Status.invalidArgument`    | 400  |
| Valid input, but the resource's state forbids it now       | `Status.failedPrecondition` | 400  |
| Not signed in, or the session expired                      | `Status.unauthorized`       | 401  |
| Signed in, but not allowed                                 | `Status.permissionDenied`   | 403  |
| Missing (or hidden from this user)                         | `Status.notFound`           | 404  |
| Creating something that already exists                     | `Status.alreadyExists`      | 409  |
| Lost a race with a concurrent change; retrying may succeed | `Status.aborted`            | 409  |
| Rate limit or quota                                        | `Status.resourceExhausted`  | 429  |
| A dependency is down; retry later                          | `Status.unavailable`        | 503  |

`Details` chains the other `google.rpc` details when the client needs more than a reason: `.retryInfo({ retryDelay })` with `resourceExhausted` (in seconds, as `rateLimit` from `@shware/http/hono` sends it, the same value as its `Retry-After` header), `.errorInfo({ reason, metadata })` to pass values the translation interpolates (`metadata` is `Record<string, string>`).

### Reasons are declared

`ErrorReason` is narrowed by declaration merging, usually to the keys of the i18n `error` namespace, so every reason has a translation and a typo does not compile. Find the project's `declare module '@shware/http'` block (e.g. `src/http.d.ts`) before adding a reason:

```ts
import '@shware/http';
import type { ErrorReason as I18nErrorReason } from '@repo/i18n';

declare module '@shware/http' {
  interface ErrorReason extends I18nErrorReason {
    // Machine-facing reasons with no translation go here directly.
    APPLE_NOTIFICATION_INVALID: string;
  }
}
```

A new user-facing reason is therefore two edits: the translation in the i18n `error` namespace (every locale), then the `errorInfo({ reason })` call. Reasons are `SCREAMING_SNAKE_CASE` and name what went wrong, not where (`INVALID_VERIFICATION_CODE`, not `LOGIN_ERROR_1`).

### Validation

Validate every input with `zValidator` from `@shware/http/hono`, never by hand. A failure throws `INVALID_ARGUMENT` with a `BadRequest` detail listing **every** violated field (`field` is the dotted path), which the client maps onto its form.

```ts
import { zValidator, bigintId } from '@shware/http/hono';
import { object, string, email } from 'zod/mini';

app.post(
  '/v1/teams/:id/invites',
  zValidator('param', object({ id: bigintId })),
  zValidator('json', object({ email: email() })),
  async (c) => {
    const { id } = c.req.valid('param'); // bigint
    const { email } = c.req.valid('json');
    // …
  }
);
```

`bigintId` parses a decimal path segment into a `bigint` (snowflake ids), rejecting anything else as a field violation.

### Mapping third-party errors

Translate errors from libraries into a `Status` in the app's `onError`, then delegate to `errorHandler`, so they reach the client as a status with a reason instead of a 500:

```ts
import { Details, Status } from '@shware/http';
import { errorHandler } from '@shware/http/hono';

app.onError((error, c) => {
  if (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.code === 'idempotency_key_in_use'
  ) {
    const details = Details.new().errorInfo({ reason: 'PLAN_CHANGE_IN_PROGRESS' });
    return errorHandler(Status.aborted('Another change is in progress').error(details), c);
  }
  return errorHandler(error, c);
});
```

`errorHandler` adds a `RequestInfo` detail with the request id (register Hono's `requestId()` middleware, and type the app with its variables, e.g. `new Hono<{ Variables: RequestIdVariables }>()` or the project's `Env` that includes them), logs 5xx with `console.error` and 4xx with `console.warn`, maps Hono's `HTTPException` by its HTTP status, and turns anything unknown into `INTERNAL`.

## Client

The parsers take the decoded body (`unknown`) and never throw, so call them on whatever the HTTP client decoded (with ky, `HTTPError.data`; it already consumed the body, so `e.response.json()` would throw).

| Function                          | Returns                                           |
| --------------------------------- | ------------------------------------------------- |
| `isErrorReason(data, ...reasons)` | whether the body carries one of these reasons     |
| `getErrorInfo(data)`              | the `ErrorInfo` (`reason`, `metadata`) or `null`  |
| `getFieldViolations(data)`        | `BadRequest` field violations, `[]` when none     |
| `getErrorMessage(data, t)`        | `{ reason, message }`, translated, with fallbacks |

Branch on the **reason**, never on the HTTP status or the message text: several reasons share a status, and messages change.

### One global toast, opted out per mutation

The query client's `MutationCache.onError` shows a toast for every failed mutation from its reason. A mutation that handles some reasons inline (an error under a field, a dialog) lists them in `meta.handledReasons`, and the global handler skips exactly those, so nothing is shown twice and nothing is swallowed:

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

// The global handler, set up once with the QueryClient.
new MutationCache({
  onError: (e, _variables, _context, mutation) => {
    if (!(e instanceof HTTPError)) return;
    if (isErrorReason(e.data, ...(mutation.meta?.handledReasons ?? []))) return;
    const info = getErrorInfo(e.data);
    toast.error(
      info
        ? t(info.reason, { ns: 'error', ...info.metadata })
        : t('UNEXPECTED_ERROR', { ns: 'error' })
    );
  },
});
```

Before adding error UI to a mutation, look for the project's global handler and its `handledReasons` typing (`Register['mutationMeta']` in TanStack Query) and reuse them. An error with no `ErrorInfo` (a bare `INTERNAL`) still gets a generic message: silence looks like a broken button.
