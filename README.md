# Shware JS SDK

The TypeScript packages behind Shware's apps: analytics and attribution, authentication, HTTP
error handling, in-app purchases, and code-first customer journeys. Each package is published to
npm on its own and can be adopted independently.

## Packages

| Package                                         | What it does                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`@shware/analytics`](./packages/analytics)     | Event tracking for web and React Native, browser pixels, attribution, and server-side conversions APIs for the ad platforms       |
| [`@shware/http`](./packages/http)               | A gRPC-style `Status` error model, Hono middlewares and helpers, webhooks, Google One Tap, and small HTTP utilities               |
| [`@shware/security`](./packages/security)       | Session-based auth: OAuth2 sign-in with the major providers, Redis session repositories, native and desktop sign-in               |
| [`@shware/purchase`](./packages/purchase)       | One subscription model over Stripe, the App Store and Google Play, and handlers that map their webhooks and notifications onto it |
| [`@shware/workflow`](./packages/workflow)       | Customer journeys (email, push, webhooks) written as TypeScript, compiled to versioned IR, run on Cloudflare Workers              |
| [`@shware/workflow-ui`](./packages/workflow-ui) | A local studio for reviewing a `@shware/workflow` project's journeys, message templates and reports                               |
| [`@shware/utils`](./packages/utils)             | Dependency-free helpers shared by the other packages: arrays, strings, promises, rate limiting, storage, React hooks              |

Each package's README covers installation, its entry points and usage:

- [analytics](./packages/analytics/README.md), with [GA4.md](./packages/analytics/GA4.md) and
  [UTM.md](./packages/analytics/UTM.md)
- [http](./packages/http/README.md)
- [security](./packages/security/README.md), with
  [desktop sign-in](./packages/security/docs/desktop-sign-in.md)
- [purchase](./packages/purchase/README.md)
- [workflow](./packages/workflow/README.md), with [TESTING.md](./packages/workflow/TESTING.md)
- [workflow-ui](./packages/workflow-ui/README.md)
- [utils](./packages/utils/README.md)

## Install

Install only the packages you use:

```bash
pnpm add @shware/analytics @shware/http zod
```

Framework and platform integrations (Next.js, TanStack Start, Hono, Expo, Stripe, Postgres, …)
are optional peer dependencies, so a package never pulls in a framework you do not import. Each
README lists the peers its entry points need. The packages ship ESM and CommonJS builds with
TypeScript types.

## Examples

- [`examples/cloudflare-demo`](./examples/cloudflare-demo): a `@shware/workflow` Worker on
  Cloudflare with KV, D1 and Workflows (`pnpm dev`, `pnpm db:reset`).
- [`examples/playground`](./examples/playground): a `@shware/workflow` project opened in
  `@shware/workflow-ui` (`pnpm dev`).

## Development

This is a pnpm + Turborepo monorepo on Node 24.

```bash
pnpm install
pnpm build        # build every package with tsdown
pnpm test         # vitest in every package
pnpm check-types
pnpm lint         # oxlint
pnpm format       # oxfmt
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org) (checked by
commitlint). A change to a published package needs a changeset (`pnpm changeset`); once it lands on
`main`, the release workflow opens a "Version Packages" PR that merges itself when CI passes and
publishes the new versions to npm.

## Used by

- [proface.ai](https://proface.ai)
- [hackertalk.net](https://hackertalk.net)
- [apiping.io](https://apiping.io?s=QLysFE)

## License

[MIT](./LICENSE)
