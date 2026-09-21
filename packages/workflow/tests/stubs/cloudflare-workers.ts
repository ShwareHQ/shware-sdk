/**
 * Stand-in for the `cloudflare:workers` built-in, so the CF adapter can be
 * imported under node.
 *
 * The module only exists inside workerd, which is why runner.ts had no tests at
 * all: everything it does — pinning a version, finalizing the ledger, telling a
 * wait timeout from a failure — was reachable only by deploying. Types are
 * erased at runtime, so the one thing that has to exist here is the base class.
 *
 * Wired up by the alias in vitest.config.ts.
 */
export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
  constructor(
    protected readonly ctx: unknown,
    protected readonly env: Env
  ) {}

  abstract run(event: { payload: Params }, step: unknown): Promise<unknown>;
}
