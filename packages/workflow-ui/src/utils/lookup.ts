/**
 * Read one entry out of a discovered registry (workflows, emails).
 *
 * TypeScript types `record[key]` as always present, but every key the studio
 * looks up comes from outside the type system — a route param, a template ref
 * in the IR — so a miss is ordinary. This states the `| undefined` once, which
 * is what makes the callers' guards real instead of dead code.
 */
export function lookup<T>(registry: Record<string, T>, key: string): T | undefined {
  return registry[key];
}
