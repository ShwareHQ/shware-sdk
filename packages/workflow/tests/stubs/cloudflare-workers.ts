/**
 * Test stand-in for the `cloudflare:workers` module: only the base class the
 * runner extends. Wired through vitest's resolve.alias so modules that import
 * the runner (journeyWorker) load outside workerd.
 */
export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
  constructor(
    protected readonly ctx: unknown,
    protected readonly env: Env
  ) {}
  abstract run(event: { payload: Params }, step: unknown): Promise<unknown>;
}
