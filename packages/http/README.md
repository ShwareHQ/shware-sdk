# Error Handling

## hono example

### With Adapter

```typescript
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Status } from '@repo/error';

Status.adapter = (status, response) => {
  const headers = { 'Content-Type': 'application/json' };
  const res = new Response(JSON.stringify(response), { status, headers });
  return new HTTPException(status, { res });
};

const app = new Hono();

app.get('/', () => {
  throw Status.invalidArgument('Hello World!').error();
});

serve({ fetch: app.fetch, port: 3000 });
```

### With Global Error Handler

```typescript
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Status, StatusError } from '@repo/error';

const app = new Hono();

app.onError((error, c) => {
  if (error instanceof StatusError) {
    return c.json(error.response, error.status);
  }
  return c.json({ error: 'Internal Server Error' }, 500);
});

app.get('/', () => {
  throw Status.invalidArgument('Hello World!').error();
});

serve({ fetch: app.fetch, port: 3000 });
```

## Custom ErrorReason

By default, `ErrorInfo.reason` accepts any `string`. You can use TypeScript [declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html) to constrain it to a set of known keys:

```typescript
// e.g. shware-http.d.ts
declare module '@shware/http' {
  interface ErrorReason {
    ACCOUNT_BLOCKED: string;
    ACCOUNT_LOCKED: string;
    SUBSCRIPTION_EXPIRED: string;
  }
}
```

Once declared, `Details.errorInfo({ reason })` will only accept the keys you defined, with full autocomplete support:

```typescript
import { Details } from '@shware/http';

// OK
Details.new().errorInfo({ reason: 'ACCOUNT_BLOCKED' });

// Type error: Type '"INVALID"' is not assignable to type 'keyof ErrorReason'
Details.new().errorInfo({ reason: 'INVALID' });
```

## nestjs example
