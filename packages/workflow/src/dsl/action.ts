/**
 * Custom actions — the escape hatch for side effects the built-in nodes do not
 * cover (CRM sync, coupon issuing, outbound webhooks with custom auth, …).
 *
 * Dual-plane model: the *code* solidifies into the Worker bundle at deploy
 * time (it ships with the app, like any other module), while the *identity*
 * solidifies into IR as `{ type: 'action', action: name, args }`. The runtime
 * resolves the name against a registry (see engine/actions.ts).
 *
 * The IR used to carry a hash of `handler.toString()` as a code-identity pin.
 * It is gone: the printed source depends on the bundler (minification, helper
 * injection, source maps), so every toolchain produced a different "version"
 * of unchanged code, and `plan` reported changes nobody made. Code identity is
 * the deployed bundle's, not the IR's.
 *
 * Deliberately NOT supported: custom *conditions*. Branching stays declarative
 * so the canvas can always explain why a user took a path — an action that
 * needs to influence routing writes a property or emits an event, and the
 * decision is expressed as a normal predicate on that data.
 */

/** Runtime context handed to the handler; deliberately small — facts and messaging have their own nodes. */
export interface ActionContext {
  userId: string;
  /**
   * `${instanceId}:${nodeId}` — stable across replays and retries of this one
   * action node. A handler with an external side effect (charging, issuing,
   * POSTing) must pass it along so the far side collapses the duplicate: the
   * step body can re-run after the handler already resolved.
   */
  idempotencyKey: string;
}

/**
 * The handler: plain code, executed inside a durable step (`step.do`), so a
 * throw is retried by the runtime and a success is checkpointed — it should be
 * idempotent under retry, which is what `ctx.idempotencyKey` is for. Args
 * arrive with user_property references already resolved to values.
 */
export type ActionHandler<A extends object> = (args: A, ctx: ActionContext) => Promise<void> | void;

/**
 * A registered custom action: the named asset `.run()` refers to. Carries the
 * name the IR records and the implementation for the runtime registry.
 */
export interface ActionRef<A extends object = object> {
  readonly name: string;
  /** Method syntax on purpose: bivariant args let refs with different arg shapes share one list (compileBundle, registries). */
  handler(args: A, ctx: ActionContext): Promise<void> | void;
}

/**
 * Define a custom action. The generic `A` types the args `.run()` accepts —
 * the only type injection point, mirroring `template.sms<P>()`:
 *
 *   const syncCrm = action<{ plan: string }>('sync_crm', async ({ plan }, { userId }) => {
 *     await fetch('https://crm.example.com/sync', { method: 'POST', body: JSON.stringify({ userId, plan }) });
 *   });
 *
 *   workflow(...).run(syncCrm, { plan: u.subscription_plan })
 *
 * The returned object is the action's identity at compile time: compileBundle
 * checks that the one a workflow runs is the very one listed in `actions`, so
 * two definitions cannot share a name by accident.
 */
export function action<A extends object = Record<string, never>>(
  name: string,
  handler: ActionHandler<A>
): ActionRef<A> {
  return { name, handler };
}
