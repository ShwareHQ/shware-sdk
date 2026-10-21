import type { ScalarIR } from '../ir';
import type { ActionInvocation, ActionInvoker } from './ports';

/**
 * The default ActionInvoker: a name → handler registry (the runtime half of
 * the dual-plane model — IR carries identity, the deployed bundle carries
 * code). Adapter-agnostic: the Cloudflare runner uses it and an AWS adapter
 * would too.
 */

/**
 * What the registry stores — structurally satisfied by the DSL's ActionRef,
 * so the same `action(...)` objects the workflows reference are registered
 * directly, exactly like createMessageSender overrides plug in senders.
 */
export interface RegisteredAction {
  readonly name: string;
  /** Pre-4.0 code pin; compared only against an IR that still carries one. */
  readonly codeHash?: string | undefined;
  /** Method syntax on purpose: accepts ActionRef handlers with narrower arg types. */
  handler(
    args: Record<string, ScalarIR | undefined>,
    ctx: { userId: string; idempotencyKey: string }
  ): Promise<void> | void;
}

/**
 * Version-consistency tiers for the codeHash pinned in IR vs the code actually
 * registered. Kept for compatibility: bundles compiled since 4.0 carry no
 * codeHash and `action()` no longer computes one, so the comparison only runs
 * when both an old IR and a registration that still sets `codeHash` have one.
 * 'warn' logs the skew and runs the deployed code; 'strict' fails the step;
 * 'rolling' silences the log entirely.
 */
export type ActionVersionPolicy = 'rolling' | 'warn' | 'strict';

export class RegistryActionInvoker implements ActionInvoker {
  private readonly registry: ReadonlyMap<string, RegisteredAction>;

  constructor(
    actions: readonly RegisteredAction[],
    private readonly policy: ActionVersionPolicy = 'warn'
  ) {
    this.registry = new Map(actions.map((a) => [a.name, a]));
  }

  async invoke(invocation: ActionInvocation): Promise<void> {
    const registered = this.registry.get(invocation.action);
    if (registered === undefined) {
      throw new Error(
        `action '${invocation.action}' is not registered in this runtime — was it removed from the deployed bundle while workflows still reference it?`
      );
    }
    if (
      this.policy !== 'rolling' &&
      invocation.codeHash !== undefined &&
      registered.codeHash !== undefined &&
      invocation.codeHash !== registered.codeHash
    ) {
      const skew = `action '${invocation.action}': deployed code (${registered.codeHash}) differs from the version pinned in this journey's IR (${invocation.codeHash})`;
      if (this.policy === 'strict') throw new Error(skew);
      console.warn(`${skew} — running the deployed version`);
    }
    // The key is forwarded, not consumed here: this invoker has no state to
    // de-duplicate against, and the step body it runs inside is replayed — the
    // handler is the only place that can collapse the duplicate side effect.
    await registered.handler(invocation.args, {
      userId: invocation.userId,
      idempotencyKey: invocation.idempotencyKey,
    });
  }
}
