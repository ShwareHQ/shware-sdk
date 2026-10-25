# @shware/utils

Small, dependency-free helpers used across Shware apps and SDKs: string and array helpers, base62,
invariant assertions, a promise memoizer, a retrying `fetch`, debounce and throttle, a token
bucket, expiring `localStorage`, Stripe currency units, and a few React hooks. Everything is
exported from the package root.

## Install

```bash
pnpm add @shware/utils
```

`react` is an optional peer dependency, needed only for the React hooks.

## Entry points

| Import          | Contents                                 |
| --------------- | ---------------------------------------- |
| `@shware/utils` | All helpers and React hooks listed below |

## Strings, arrays and encoding

```ts
import { base62, chunk, hasText } from '@shware/utils';

hasText('  '); // false; also a type guard: str is string

chunk([1, 2, 3, 4, 5], 2); // [[1, 2], [3, 4], [5]]

const code = base62.encode(Buffer.from(uuid.replaceAll('-', ''), 'hex'));
const bytes = base62.decode(code, 16); // Buffer, left-padded to 16 bytes
```

`base62` uses Node.js `Buffer` and preserves leading zero bytes.

## Assertions

`invariant(condition, message?)` narrows `condition` and throws `Error('Invariant failed: ...')`
when it is falsy. The message may be a function so it is only built on failure.

```ts
import { invariant } from '@shware/utils';

invariant(transaction.productId, 'Apple receipt productId is missing');
invariant(typeof price === 'number', () => `price is ${typeof price}`);
```

## Promises

`once(fn)` memoizes an async function: concurrent calls share one in-flight promise, the first
successful result is cached, and a rejection is not cached so the next call retries.

```ts
import { once } from '@shware/utils';

export const getCredentials = once(async () => {
  return JSON.parse(Buffer.from(env.CREDENTIALS_BASE64, 'base64').toString('utf-8'));
});
```

## Fetch with retries

`fetch(input, init)` wraps the global `fetch` with exponential backoff (25% jitter) and honors
`Retry-After`. Besides `RequestInit` it accepts `RetryOptions`:

| Option           | Default                                                      | Description                                 |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `retries`        | `3` for GET, HEAD, PUT, DELETE, OPTIONS; `0` for POST, PATCH | Retries after the first attempt             |
| `delayFactor`    | `500`                                                        | Base delay in ms, doubled on every retry    |
| `maxDelay`       | `30_000`                                                     | Upper bound for a single delay in ms        |
| `retryCondition` | 408, 429, 500, 502, 503 or 504 status                        | `(response) => boolean \| Promise<boolean>` |

Network errors are retried too, under the same `retries`; after the last attempt the last response
is returned (or the last error thrown). Only the idempotent methods are retried by default (RFC 9110
§9.2.2): a POST whose answer was lost may already have run on the server. Pass `retries` for a POST
the server deduplicates — one carrying a client-generated id or an `Idempotency-Key` header, which
is the caller's to choose, since it names the business operation being repeated. A request whose
body is a `ReadableStream` is never retried.

```ts
import { fetch } from '@shware/utils';

const response = await fetch(pictureUrl, { retries: 3 });
if (!response.ok) throw new Error(`Picture request failed: ${response.status}`);
```

## Debounce and throttle

```ts
import { debounce, throttle } from '@shware/utils';

const save = debounce((draft: string) => api.saveDraft(draft), 500, { maxWait: 2000 });
save('hello');
save.flush(); // run the pending call now
save.cancel(); // drop it

const onScroll = throttle(() => updateHeader(), 100, { leading: true, trailing: true });
window.addEventListener('scroll', onScroll);
```

`DebounceOptions`: `leading` (default `false`), `trailing` (default `true`), `maxWait`.
`ThrottleOptions`: `leading` and `trailing` (both default `true`). Both return functions with
`cancel()` and `flush()`.

## Token bucket

`TokenBucket` throttles outgoing work in-process. `removeTokens()` waits until `requested` tokens
are available; `rate` tokens are added every `interval` (default `'second'`). Call `destroy()` to
clear its timer.

```ts
import { TokenBucket } from '@shware/utils';

const bucket = new TokenBucket({ rate: 10, capacity: 10, requested: 1 });

for (const user of users) {
  await bucket.removeTokens();
  await sendEmail(user);
}
bucket.destroy();
```

## Browser helpers

`expiringStorage` stores JSON values in `localStorage` with a TTL in milliseconds; expired items
read back as `null` and are removed.

```ts
import { expiringStorage } from '@shware/utils';

expiringStorage.setItem('pending-checkout', { priceId }, 30 * 60 * 1000);
const pending = expiringStorage.getItem<{ priceId: string }>('pending-checkout');
expiringStorage.removeItem('pending-checkout');
```

`waitForRequestIdleCallback({ timeout?, signal? })` resolves when the browser is idle (falling
back to a 1.5 s timer where `requestIdleCallback` is missing) and rejects if `signal` aborts:

```ts
import { waitForRequestIdleCallback } from '@shware/utils';

await waitForRequestIdleCallback({ timeout: 4000 });
loadAnalytics();
```

## Stripe

`stripeMinorUnits(currency)` returns `1` for
[zero-decimal currencies](https://docs.stripe.com/currencies#zero-decimal) (listed in
`ZERO_DECIMAL_CURRENCIES`) and `100` otherwise.

```ts
import { stripeMinorUnits } from '@shware/utils';

const amount = 1999 / stripeMinorUnits('usd'); // 19.99
const yen = 1999 / stripeMinorUnits('jpy'); // 1999
```

## React hooks

| Hook                                       | Description                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `useDebouncedCallback(fn, delay, options)` | Stable debounced callback, cancelled on unmount                                  |
| `usePrevious(value)`                       | Previous committed-render snapshot; initially `undefined`, updated by the effect |
| `useLatestRef(value)`                      | Ref that always holds the latest value                                           |
| `useIMEGuard()`                            | Tracks IME composition so Enter does not submit mid-composition                  |
| `useExponentialHint(key, options)`         | Shows a hint again after exponentially growing dismiss intervals                 |

```tsx
import { useDebouncedCallback, useExponentialHint, useIMEGuard } from '@shware/utils';

function Editor({ onSave }: { onSave: (text: string) => void }) {
  // flushOnExit: also flush when the tab is hidden or the component unmounts
  const save = useDebouncedCallback(onSave, 500, { flushOnExit: true });
  const { composing, onCompositionStart, onCompositionEnd } = useIMEGuard();

  return (
    <input
      onChange={(e) => save(e.target.value)}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !composing.current) save.flush();
      }}
    />
  );
}

function ShortcutHint() {
  // shown again 4 days after the first dismissal, 16 after the second, never after the third
  const { visible, dismiss } = useExponentialHint('shortcut-hint', {
    baseDays: 4,
    maxDismissals: 3,
  });
  return visible ? <Hint onClose={dismiss} /> : null;
}
```
