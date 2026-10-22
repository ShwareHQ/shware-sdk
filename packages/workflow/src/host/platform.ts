import type { EmailBindingLike } from '../cloudflare/bindings';
import type { ExecutionStart } from '../store/index';

/**
 * The runtime port: what the host needs from the platform it runs on, whichever one that is.
 * Cloudflare's Workflow binding satisfies it (`cloudflareJourneyBinding`), the AWS adapter's
 * `AwsInstances` implements it over durable executions.
 */

export interface WorkflowInstanceLike {
  id: string;
  sendEvent(event: { type: string; payload?: unknown }): Promise<void>;
  /** Stop the instance for good (Cloudflare Workflows' `terminate`). */
  terminate?(): Promise<void>;
  /** Where it stands (`complete`, `errored`, `terminated`, `running`, …). */
  status?(): Promise<{ status: string }>;
}

/** How the host starts, wakes and stops instances. */
export interface WorkflowBindingLike {
  create(options: { id: string; params: unknown }): Promise<WorkflowInstanceLike>;
  /** The instance, or an `InstanceNotFoundError` when the runtime does not know the id. */
  get(id: string): Promise<WorkflowInstanceLike>;
  /**
   * For a runtime whose start is a submit that can be lost in flight (AWS): the start to record
   * with the entry, in one transaction. A failed `create` then keeps the entry — its recorded
   * start is retried by the next ingest for the pair (`resume`) or by maintenance, never rolled
   * back and re-entered as a second execution.
   */
  plan?(options: {
    id: string;
    params: JourneyParams;
    ts: number;
    /** The code version whose routes named `params.contentHash` (absent after a forced deploy). */
    version?: string | undefined;
  }): Promise<ExecutionStart>;
  /** Retry the recorded, unconfirmed start of the (workflow, user) entry still running, if any. */
  resume?(entry: { workflow: string; userId: string }): Promise<void>;
  /**
   * Maintenance the sweep runs first: old unconfirmed starts retried (or given up on), and
   * executions the platform ended on its own (timeout, stop, crash) reconciled into the ledger.
   */
  maintain?(): Promise<void>;
}

/**
 * The runtime does not know the instance: the only lookup failure that lets the host drop the
 * instance's wakes, or count it as stopped. Every `WorkflowBindingLike.get` answers it this way.
 */
export class InstanceNotFoundError extends Error {
  override readonly name = 'InstanceNotFoundError';
  constructor(
    readonly instanceId: string,
    options?: ErrorOptions
  ) {
    super(`no such instance: ${instanceId}`, options);
  }
}

/** The event type the host uses to wake waiting instances (sendEvent's `type`). */
export const WAKE_EVENT_TYPE = 'wake';

/** Journey instance parameters, passed by the host when it creates one. */
export interface JourneyParams {
  workflowId: string;
  /** The IR version pinned at entry. */
  contentHash: string;
  userId: string;
  trigger: { event: string; payload: Record<string, unknown> };
  [key: string]: unknown;
}

/** Every binding, variable and secret the journey host reads (names match the wrangler config). */
export interface JourneyEnv {
  /** The runtime port: creating instances, waking and stopping them. */
  JOURNEY: WorkflowBindingLike;
  /** Optional message-delivery webhook (defaults to the console logging sender). */
  MESSAGE_WEBHOOK_URL?: string;
  /**
   * Bearer token required on every mutating HTTP endpoint (`Authorization:
   * Bearer <token>`). Unset = open — acceptable only for local dev; /deploy in
   * particular rewrites the whole routing table, so production must set this.
   */
  API_TOKEN?: string;
  /**
   * The host's public origin. With a store that keeps reporting (Postgres), journey emails'
   * links and open pixel point at its `/t/...` routes; without it emails go out untracked.
   */
  WORKFLOW_ORIGIN?: string;
  /** Which `workflow.config.ts` entry applies (`development`, `production`, …); production when unset. */
  ENVIRONMENT?: string;
  /** Cloudflare Email Sending, when the config has `emails`. */
  EMAIL?: EmailBindingLike;
  /** The APNs auth key (`.p8`, base64) named by the config's `apns.keyId`. */
  APNS_PRIVATE_KEY_BASE64?: string;
  /** The Firebase service account (base64 JSON) the config's `fcm` sends with. */
  GOOGLE_APPLICATION_CREDENTIALS_BASE64?: string;
  /** The VAPID key pair web pushes are signed with (`generateVapidKeys`); the config's `webPush` turns the channel on. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /**
   * Cloudflare's version metadata binding (wrangler `"version_metadata": { "binding":
   * "CF_VERSION_METADATA" }`). With it, and a store that records the live version (Postgres),
   * journeyWorker makes the bundle compiled into each new version live by itself: `wrangler
   * deploy` is the whole deploy.
   */
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp: string };
  /** Development only: the HTTP/2 relay `wrangler dev` sends APNs requests through (see `@shware/workflow/apns-relay`). */
  APNS_RELAY_ORIGIN?: string;
}
