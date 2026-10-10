import type { EmailAddress } from '../config';

/**
 * A minimal structural interface over the Cloudflare bindings.
 *
 * @cloudflare/workers-types is deliberately not used: the global types it
 * injects clash with the DOM lib this package's react side needs. A structural
 * subset plus the ambient cloudflare:workers declaration is enough to compile,
 * and the real bindings satisfy it structurally at runtime.
 */

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/** Structural subset of D1Result: `meta.changes` is how INSERT OR IGNORE reports whether it inserted. */
export interface D1RunResultLike {
  meta?: { changes?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<D1RunResultLike>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  /** Statements run in order inside one transaction (real D1 semantics) — deploy relies on the atomicity. */
  batch(statements: D1PreparedStatementLike[]): Promise<unknown>;
}

export interface WorkflowInstanceLike {
  id: string;
  sendEvent(event: { type: string; payload?: unknown }): Promise<void>;
}

export interface WorkflowBindingLike {
  create(options: { id: string; params: unknown }): Promise<WorkflowInstanceLike>;
  get(id: string): Promise<WorkflowInstanceLike>;
}

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
    /** `${instanceId}:${nodeId}`: stable across replays and retries — drop a send whose key was already delivered. */
    idempotencyKey: string;
  }): Promise<unknown>;
}

/** Every binding the journey engine needs (names match the wrangler config). */
export interface JourneyEnv {
  /**
   * BundleIR storage for the default D1 store (`wf:${contentHash}` → WorkflowIR JSON). Optional:
   * a Worker on another JourneyStore (Postgres, say) does not declare it.
   */
  WORKFLOW_KV?: KVNamespaceLike;
  /** Tables of the default D1 store (events / profiles / segments / triggers / entries / subscriptions). Optional, as above. */
  DB?: D1DatabaseLike;
  /** JourneyRunner's workflow binding (creating instances and waking them). */
  JOURNEY: WorkflowBindingLike;
  /** Optional message-delivery webhook (defaults to the console logging sender). */
  MESSAGE_WEBHOOK_URL?: string;
  /**
   * Bearer token required on every mutating HTTP endpoint (`Authorization:
   * Bearer <token>`). Unset = open — acceptable only for local dev; /deploy in
   * particular rewrites the whole routing table, so production must set this.
   */
  API_TOKEN?: string;
  /** Which `workflow.config.ts` entry applies (`development`, `production`, …); production when unset. */
  ENVIRONMENT?: string;
  /** Cloudflare Email Sending, when the config has `emails`. */
  EMAIL?: EmailBindingLike;
  /** The APNs auth key (`.p8`, base64) named by the config's `apns.keyId`. */
  APNS_PRIVATE_KEY_BASE64?: string;
  /** The Firebase service account (base64 JSON) the config's `fcm` sends with. */
  GOOGLE_APPLICATION_CREDENTIALS_BASE64?: string;
  /** Development only: the HTTP/2 relay `wrangler dev` sends APNs requests through (see `@shware/workflow/apns-relay`). */
  APNS_RELAY_ORIGIN?: string;
}

/** The event type the router uses to wake waiting instances (sendEvent's `type`). */
export const WAKE_EVENT_TYPE = 'wake';

/** Journey instance parameters, passed by the ingest router when it creates one. */
export interface JourneyParams {
  workflowName: string;
  /** The IR version pinned at entry. */
  contentHash: string;
  userId: string;
  trigger: { event: string; payload: Record<string, unknown> };
  [key: string]: unknown;
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
 * there — a broken binding, an evicted instance, a malformed timeout. The
 * adapter used to read them all as timeouts, which made an infrastructure
 * fault indistinguishable from "the user never did it": the journey took its
 * onTimeout branch, early and silently. Only the clock can tell them apart.
 */
export function wakeExpired(startedAt: number, timeoutMs: number, now: number): boolean {
  return now - startedAt >= Math.max(0, timeoutMs - WAKE_TIMEOUT_TOLERANCE_MS);
}
