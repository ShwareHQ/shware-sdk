---
name: cursor-based-pagination-api
description: Build cursor-paginated list APIs and infinite-scroll clients with @shware/http. Use when a list grows with usage (feeds, histories, records) and must be fetched page by page.
---

# Cursor-based pagination API

## Server side instructions

1. Validate the input parameters.
2. Construct pagination query conditions, if needed, check permissions.
3. Query one extra record to check if there is more data on the next page, and then return the data and the paging information.

### Example

The following implements a paginated API for querying blog records. It uses Hono and Drizzle; `@/db`, `@/db/schema/blog` and `@/env` stand for the project's own modules.

```ts
import { Cursor, type Page, pageParamsSchema } from '@shware/http';
import { zValidator } from '@shware/http/hono';
import { hasText } from '@shware/utils';
import { asc, desc, gt, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { v7 as uuidv7 } from 'uuid';
import { db } from '@/db';
import { type Blog, blog } from '@/db/schema/blog';
import { type Env } from '@/env';

const app = new Hono<Env>();

app.get('/v1/blogs', zValidator('query', pageParamsSchema()), async (c) => {
  const { prev, next, limit } = c.req.valid('query');

  const newer = hasText(prev);
  const predicate = newer
    ? gt(blog.id, Cursor.decode(prev, 'string'))
    : lt(blog.id, hasText(next) ? Cursor.decode(next, 'string') : uuidv7());

  const list = await db
    .select()
    .from(blog)
    .where(predicate)
    .orderBy(newer ? asc(blog.id) : desc(blog.id))
    .limit(limit + 1);

  const hasMore = list.length > limit;
  const data = newer ? list.slice(0, limit).reverse() : list.slice(0, limit);
  const paging = hasMore ? Cursor.of(data.at(0)?.id, data.at(-1)?.id) : Cursor.empty();

  return c.json<Page<Blog>>({ data, paging });
});

export default app;
```

## Client side instructions

1. Use `infiniteQueryOptions` to create a shared query configuration for both server and client, utilizing pagination helpers from `@shware/http` and flattening paged data with `pages.flatten`. When needed, update the cache for individual items using `client.setQueryData`.
2. On the server, call `queryClient.ensureInfiniteQueryData` to prefetch the initial data, enabling SSR and seamless hydration on the client.
3. On the client, use `useInfiniteQuery` with the initial data provided by the Route loader.

### Example

The following code shows how to use a paginated API in a frontend project with SSR support (TanStack Router and Query; `@repo/api` stands for the project's typed API client).

```tsx
import api from '@repo/api';
import { Pages, getNextPageParam, getPreviousPageParam, initialPageParam } from '@shware/http';
import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';

const options = infiniteQueryOptions({
  queryKey: ['blogs'],
  initialPageParam,
  getNextPageParam,
  getPreviousPageParam,
  select: Pages.flatten,
  queryFn: async ({ pageParam, client }) => {
    const res = await api.blog.listBlogs({ limit: 10, ...pageParam });
    res.data.forEach((blog) => client.setQueryData(['blogs', blog.slug], blog));
    return res;
  },
});

export const Route = createFileRoute('/blog/')({
  component: RouteComponent,
  headers: () => ({ 'X-Robots-Tag': 'index, follow' }),
  loader: ({ context: { queryClient } }) => queryClient.ensureInfiniteQueryData(options),
});

function RouteComponent() {
  const { data } = useInfiniteQuery({ ...options, initialData: Route.useLoaderData() });

  return (
    <div>
      {data.map((blog) => (
        <Link key={blog.id} to={'/blog/$slug'} params={{ slug: blog.slug }}>
          <div>{blog.title}</div>
          <div>{blog.content}</div>
        </Link>
      ))}
    </div>
  );
}
```
