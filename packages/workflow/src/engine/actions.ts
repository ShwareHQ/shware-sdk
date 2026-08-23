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
  readonly codeHash: string;
  /** Method syntax on purpose: accepts ActionRef handlers with narrower arg types. */
  handler(
    args: Record<string, ScalarIR | undefined>,
    ctx: { userId: string }
  ): Promise<void> | void;
}

/**
 * Version-consistency tiers for the codeHash pinned in IR vs the code actually
 * registered. Deploys are rolling — Worker code and IR never flip in the same
 * instant, and different build pipelines can print the same function
 * differently — so 'warn' is the default: run the current code, log the skew.
 * 'strict' is for actions where running the wrong version is worse than
 * failing the step; 'rolling' silences the log entirely.
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
      invocation.codeHash !== registered.codeHash
    ) {
      const skew = `action '${invocation.action}': deployed code (${registered.codeHash}) differs from the version pinned in this journey's IR (${invocation.codeHash})`;
      if (this.policy === 'strict') throw new Error(skew);
      console.warn(`${skew} — running the deployed version`);
    }
    await registered.handler(invocation.args, { userId: invocation.userId });
  }
}
