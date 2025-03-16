# Client Side Error Handling

# Server Side Error Handling

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

## nestjs example
