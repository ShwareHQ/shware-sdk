import type { EmailAddress } from '../email';
import { InstanceNotFoundError, type WorkflowBindingLike } from '../host/platform';

/**
 * A minimal structural interface over the Cloudflare bindings.
 *
 * @cloudflare/workers-types is deliberately not used: the global types it
 * injects clash with the DOM lib this package's react side needs. A structural
 * subset plus the ambient cloudflare:workers declaration is enough to compile,
 * and the real bindings satisfy it structurally at runtime.
 */

/**
 * Cloudflare Email Service's send_email binding (structural subset).
 *
 * `idempotencyKey` is part of the call because the send happens inside a
 * `step.do`: a step body re-runs after its fn resolved but before the
 * checkpoint committed, so a binding that drops the key mails the user twice.
 * The binding is app-supplied glue (nothing here can de-duplicate — there is
 * no state between two runs of the same step), which is why the port makes the
 * key impossible to miss rather than merely available.
 */
export interface EmailBindingLike {
  send(message: {
    from: EmailAddress;
    to: EmailAddress;
    replyTo?: EmailAddress;
    subject: string;
    html: string;
    /** List-Unsubscribe and List-Unsubscribe-Post, when the email has an unsubscribe link. */
    headers?: Readonly<Record<string, string>>;
    /** `${instanceId}:${nodeId}`: stable across replays and retries — drop a send whose key was already delivered. */
    idempotencyKey: string;
  }): Promise<unknown>;
}

/** Cloudflare's Workflow binding, as far as the host uses it. */
export type CfWorkflowBinding = Pick<WorkflowBindingLike, 'create' | 'get'>;

/** How Cloudflare's `get` reports an unknown instance id. */
const CF_NOT_FOUND = 'instance.not_found';

/**
 * The Workflow binding as the host's runtime port: `get` answers an unknown id with
 * `InstanceNotFoundError`, as the port promises, instead of Cloudflare's own error. Everything
 * else is forwarded as is.
 */
export function cloudflareJourneyBinding(binding: CfWorkflowBinding): WorkflowBindingLike {
  return {
    create: (options) => binding.create(options),
    async get(id) {
      try {
        return await binding.get(id);
      } catch (error) {
        if (String(error).includes(CF_NOT_FOUND)) {
          throw new InstanceNotFoundError(id, { cause: error });
        }
        throw error;
      }
    },
  };
}

/**
 * Slack on the deadline when deciding whether a thrown wait was a timeout: the
 * platform may surface the expiry a moment early, and a wait shorter than this
 * has no room to tell the two apart anyway.
 */
export const WAKE_TIMEOUT_TOLERANCE_MS = 5_000;

/**
 * Did a wait that threw actually reach its deadline?
 *
 * CF signals a wait timeout by throwing, and so does every other failure in
 * there — a broken binding, an evicted instance, a malformed timeout. Reading
 * them all as timeouts would make an infrastructure fault indistinguishable
 * from "the user never did it" (the journey would take its onTimeout branch,
 * early and silently). Only the clock can tell them apart, and only against
 * the absolute deadline: measured from when the wait was parked, a replay
 * after an eviction would start the measure over and read a
 * genuine expiry as a failure.
 */
export function wakeExpired(deadlineMs: number, now: number): boolean {
  return now >= deadlineMs - WAKE_TIMEOUT_TOLERANCE_MS;
}
