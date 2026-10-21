/**
 * Read one entry out of a discovered registry (workflows, emails).
 *
 * TypeScript types `record[key]` as always present, but every key the studio
 * looks up comes from outside the type system — a route param, a template ref
 * in the IR — so a miss is ordinary. This states the `| undefined` once, which
 * is what makes the callers' guards real instead of dead code.
 *
 * Own properties only: the registries are plain objects, so a route param of
 * `constructor` or `toString` used to find Object.prototype's and hand the
 * page a function where it expected an IR — a crash instead of a not-found.
 */
export function lookup<T>(registry: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(registry, key) ? registry[key] : undefined;
}
