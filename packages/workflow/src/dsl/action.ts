import { sha256Hex } from '../hash';

/**
 * Custom actions — the escape hatch for side effects the built-in nodes do not
 * cover (CRM sync, coupon issuing, outbound webhooks with custom auth, …).
 *
 * Dual-plane model: the *code* solidifies into the Worker bundle at deploy
 * time (it ships with the app, like any other module), while the *identity*
 * solidifies into IR as `{ type: 'action', action: name, args, codeHash }`.
 * The runtime resolves the name against a registry (see engine/actions.ts) and
 * compares codeHash to detect version skew between a pinned IR and the
 * currently deployed implementation.
 *
 * Deliberately NOT supported: custom *conditions*. Branching stays declarative
 * so the canvas can always explain why a user took a path — an action that
 * needs to influence routing writes a property or emits an event, and the
 * decision is expressed as a normal predicate on that data.
 */

/** Runtime context handed to the handler; deliberately small — facts and messaging have their own nodes. */
export interface ActionContext {
  userId: string;
}

/**
 * The handler: plain code, executed inside a durable step (`step.do`), so a
 * throw is retried by the runtime and a success is checkpointed — it should be
 * idempotent under retry. Args arrive with user_property references already
 * resolved to values.
 */
export type ActionHandler<A extends object> = (args: A, ctx: ActionContext) => Promise<void> | void;

/**
 * A registered custom action: the named asset `.run()` refers to. Carries the
 * implementation for the runtime registry and the codeHash for the IR pin.
 */
export interface ActionRef<A extends object = Record<never, never>> {
  readonly name: string;
  /** Hash of the handler's source text at definition time — the code-identity pin recorded in IR. */
  readonly codeHash: string;
  /** Method syntax on purpose: bivariant args let refs with different arg shapes share one list (compileBundle, registries). */
  handler(args: A, ctx: ActionContext): Promise<void> | void;
}

/**
 * Define a custom action. The generic `A` types the args `.run()` accepts —
 * the only type injection point, mirroring `template.email<P>()`:
 *
 *   const syncCrm = action<{ plan: string }>('sync_crm', async ({ plan }, { userId }) => {
 *     await fetch('https://crm.example.com/sync', { method: 'POST', body: JSON.stringify({ userId, plan }) });
 *   });
 *
 *   workflow(...).run(syncCrm, { plan: u.subscription_plan })
 *
 * codeHash comes from `handler.toString()`, so it changes when the code
 * changes and stays put when it does not. Different build pipelines can print
 * the same function differently (minification), which is why the default
 * runtime policy on mismatch is warn, not fail.
 */
export function action<A extends object = Record<never, never>>(
  name: string,
  handler: ActionHandler<A>
): ActionRef<A> {
  return { name, codeHash: sha256Hex(handler.toString()).slice(0, 32), handler };
}
