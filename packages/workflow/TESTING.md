# Testing conventions

## Layout

All tests live in `tests/` — `src/` ships, `tests/` never does.

| File                 | Scope                                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| `fixtures.ts`        | Shared schema, segments, templates and workflows used across the suite    |
| `dsl.test.ts`        | DSL surface → IR: predicates, combinators, triggers, nodes, bundle rules  |
| `compile.test.ts`    | Whole-workflow compilation: tree shape, node ids, hashes, build guards    |
| `ir.test.ts`         | The zod schemas as the authoritative IR definition                        |
| `hash.test.ts`       | SHA-256 known-answer vectors, canonical JSON, metadata stripping          |
| `plan.test.ts`       | Hash semantics (metadata exclusion) and deploy diffing                    |
| `engine.test.ts`     | Interpreter semantics over in-memory ports                                |
| `fake-cloudflare.ts` | In-memory D1/KV/Workflow-binding fakes (dispatch on exact SQL strings)    |
| `router.test.ts`     | Ingest router: deploy routing, trigger gates, entry-once, wakes, identify |
| `provenance.test.ts` | Callsite recording (meta.loc): capture, hash exclusion, portability       |
| `public-api.test.ts` | Consumer-perspective smoke: public entry points only, end to end          |
| `types.test-d.ts`    | Type-safety regressions (never executed, see below)                       |

## Rules

1. **Fixtures import the public entry only** (`../src/index`). They double as a
   consumer smoke test; if a fixture needs a deep import, the public surface is
   missing something — fix the surface, not the fixture.
2. **Deep imports are allowed only where the test is about internals**
   (`engine.test.ts` white-boxes `src/engine`, `ir.test.ts` the schemas).
3. **The package exports no demo content.** Showcase flows live in
   `examples/playground/src/marketing`; the fixtures mirror their shapes so the
   suite keeps exercising realistic trees, but they are independent copies.
4. **Engine semantics are tested through ports** (`EngineStep`, `FactSource`,
   …), never against a platform. Adapter-specific behaviour belongs to the
   adapter's own future suite; `examples/cloudflare-demo` is a manual
   verification harness, not a test.
5. **Every public API change lands with tests in the same commit** — functional
   coverage here, plus a `types.test-d.ts` entry when the type surface moved.

## Type tests

`types.test-d.ts` is validated by `tsc --noEmit` (`tests/` is in the tsconfig
include), not executed by vitest:

- every `@ts-expect-error` line asserts that the exact misuse below it fails to
  compile — if the error stops firing, the _unused directive_ fails the build;
- `expectTypeOf` assertions check inference results (phantom types on refs,
  props inferred from template registries).

This makes the type system's guarantees regression-tested by the same
`check-types` gate that CI already runs.

## Comment and naming language

Source comments and all test names are English (the package is headed for open
source). Test names state observable behaviour, not implementation.
