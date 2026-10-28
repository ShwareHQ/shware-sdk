import type { ChannelIR, ConditionIR, ScalarIR } from '../ir';

/**
 * Engine ports: the only shape of the outside world the interpreter depends on.
 *
 * Design constraints (AWS-proof, see the engine design notes):
 * - A wake-up is only a hint — "**at least one wake-up, re-evaluate after
 *   waking**". No event buffering or de-duplication is promised (Cloudflare
 *   buffers, AWS callback tokens do not — the port takes the intersection).
 *   The truth of a condition is always re-read by the caller once awake.
 * - subscribe / waitForWake / unsubscribe are split so the caller can register
 *   interest *before* its first condition check — an event landing between the
 *   check and the registration would otherwise be missed until the timeout.
 * - Every source of non-determinism (randomness, current time, external IO)
 *   must happen inside step.do, so its result is persisted and replay lines up.
 */

export interface EngineStep {
  /** Durable step: fn's return value is checkpointed; on replay the result is reused without re-running. */
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;

  /**
   * Durable sleep: suspended time is not billed. The only sleep primitive — a wait until an
   * absolute instant is the interpreter checkpointing the remaining time, then sleeping it.
   */
  sleep(name: string, ms: number): Promise<void>;

  /**
   * Durable: register interest in the named events (Cloudflare: write the
   * subscription table; AWS: create a callback and store its id). Must
   * complete before the caller's condition check for that attempt.
   *
   * Contract: one subscribe arms **at least one** wake-up — adapters whose
   * wake handle is one-shot (AWS durable-function callbacks are consumed on
   * delivery) satisfy it with exactly one. Callers therefore re-subscribe on
   * every wait attempt; adapters where registrations persist (Cloudflare rows)
   * make the repeat call idempotent.
   *
   * `deadlineMs` is when the wait this arms gives up: an adapter whose wake handle carries its
   * own timeout (an AWS callback) sets it here, where the handle is created. Others ignore it.
   */
  subscribe(
    name: string,
    events: readonly string[],
    options?: { deadlineMs?: number }
  ): Promise<void>;

  /** Durable: drop every registration this instance holds. */
  unsubscribe(name: string): Promise<void>;

  /**
   * Wait for a wake-up or a timeout. A registration from `subscribe` must
   * already exist — this call only parks the instance.
   *
   * Both numbers are checkpointed by the interpreter, so they are replay-stable: `timeoutMs`
   * is how long this attempt may park (the remaining time when it was computed), `deadlineMs`
   * the absolute instant the whole wait gives up. An adapter that learns of a timeout only by
   * a thrown error (Cloudflare) decides against `deadlineMs` — the clock at the replay that
   * first runs that decision is what matters, not when the park began; one whose wake handle
   * carries its own timeout (AWS) set it from `deadlineMs` at subscribe and ignores both here.
   */
  waitForWake(
    name: string,
    wait: { timeoutMs: number; deadlineMs: number }
  ): Promise<'event' | 'timeout'>;
}

/** One device a push can go to: the provider token (APNs device token, FCM registration token) and the platform that picks the provider. */
export interface PushDevice {
  token: string;
  platform: string;
}

/** Facts from a single user's point of view: the read interface condition evaluation uses (the store-backed and in-memory sources share one evaluator). */
export interface FactSource {
  /**
   * How many times an event occurred. `sinceMs` bounds the window (within /
   * anchoring); `where` is a payload-only condition tree — count only events
   * whose payload matches (evaluate with matchesWhere from engine/condition).
   */
  countEvents(
    event: string,
    opts?: { sinceMs?: number; untilMs?: number; where?: ConditionIR }
  ): Promise<number>;
  getProperty(path: string): Promise<ScalarIR | undefined>;
  /** Resolve a segment definition by id (stored with the bundle at deploy time). */
  getSegmentCondition(name: string): Promise<ConditionIR | undefined>;
  /** The user's push devices, most recently registered first (empty when the user registered none). */
  listDevices(): Promise<PushDevice[]>;
  /**
   * The user opted out of the channel (an email unsubscribe, a push opt-out in the app): nothing
   * is sent there. With a `topic`, an opt-out of that topic on the channel counts too; without
   * one, only the channel-wide opt-out.
   */
  isSuppressed?(channel: ChannelIR, topic?: string): Promise<boolean>;
}

export interface OutboundMessage {
  /** Where the copy comes from: the workflow, its instance and the message node. */
  workflow: string;
  instanceId: string;
  nodeId: string;
  channel: ChannelIR;
  template: string;
  /** Already resolved: user_property references have been replaced by actual values. */
  props: Record<string, ScalarIR | undefined>;
  userId: string;
  /**
   * The channel's recipient address, resolved by the engine — so senders never
   * read the database: a profile property for most channels, the device token
   * for push (one message per device).
   */
  recipient?: string | undefined;
  /** Push only: the device this copy goes to — its platform picks the provider. */
  device?: PushDevice | undefined;
  /** Email and push: the template's subscription topic, null for a transactional message (absent for other channels). */
  topic?: string | null | undefined;
  /**
   * `${instanceId}:${nodeId}` (plus `:${token}` for a push copy) — one per copy. Senders
   * de-duplicate on it, making replays and retries safe, and it is the copy's identity for
   * tracking: a push carries it in its payload, so the app can report the tap against it.
   */
  idempotencyKey: string;
  /** What the host's observer asked the sender to add for measuring this copy (see `MessageTracking`). */
  tracking?: MessageTracking | undefined;
}

/** What following a tracked email link does: redirect to it, or confirm an unsubscribe. */
export type LinkPurpose = 'link' | 'unsubscribe';

/**
 * Measuring a copy, as the built-in senders apply it: an email's links are routed through
 * `link` and `pixel` is appended as a 1×1 image; a push carries `data` in its payload.
 * Each is optional, and a sender ignores what its channel has no use for.
 */
export interface MessageTracking {
  /**
   * The original `http(s)` URL in, the URL that records the click and redirects out — or, for the
   * email's unsubscribe link, asks the recipient to confirm.
   */
  link?: (url: string, purpose: LinkPurpose) => string;
  /** Loaded when the email is opened. */
  pixel?: string;
  /**
   * This copy's one-click unsubscribe endpoint (RFC 8058): a POST there, with no confirmation
   * and no session, unsubscribes the recipient. The email sender puts it in the
   * `List-Unsubscribe` header, so a mail client's own unsubscribe button works.
   */
  unsubscribe?: string;
  /** Extra string keys in the push payload. */
  data?: Record<string, string>;
  /**
   * Called by the sender once the links are rewritten and before the transport takes the copy:
   * what the tracking URLs resolve to is stored before anyone can click one. A throw stops the
   * send, and the step retries it.
   */
  commit?: () => Promise<void>;
}

/**
 * How a copy ended at the transport. A sender returns nothing when the transport accepted it;
 * `{ delivered: false }` when it settled the copy without delivering — a dead push token, which
 * is not retried. A transient failure throws instead, and the step retries.
 */
export interface SendResult {
  delivered: false;
  reason: string;
}

export interface MessageSender {
  send(message: OutboundMessage): Promise<void | SendResult>;
}

/**
 * What the host learns about each journey as it runs, for reporting: where every instance
 * stands, every copy it sends and how the transport took it, and how it ended. Storage is the
 * host's — the engine only reports. Every method is optional and must be idempotent: a step
 * that fails after its report ran is retried and reports again (keyed by the instance and node,
 * or the copy's idempotency key).
 */
export interface JourneyObserver {
  /** The instance entered, before its entry guards: `at` is the trigger's time, the entry anchor. */
  started?(event: {
    workflow: string;
    instanceId: string;
    userId: string;
    at: number;
  }): Promise<void>;
  /** The instance reached a node: it sits there until the next one (a delay, a wait), or passes through. */
  nodeReached?(event: {
    workflow: string;
    instanceId: string;
    userId: string;
    nodeId: string;
    at: number;
  }): Promise<void>;
  /** A copy is about to go out; the tracking returned travels with it to the sender. */
  messagePrepared?(message: OutboundMessage): Promise<MessageTracking | undefined>;
  /** The transport took the copy (`delivered: true`), or settled it undelivered; a thrown send is not reported. */
  messageSent?(message: OutboundMessage, result: { delivered: true } | SendResult): Promise<void>;
  /** The instance ended: its outcome (`goal` is a conversion), or `failed` when an error ended it. */
  finished?(event: {
    workflow: string;
    instanceId: string;
    userId: string;
    status: JourneyOutcome['status'] | 'failed';
    at: number;
    /** When it converted, if it did — set whatever the status (see JourneyOutcome). */
    convertedAt?: number;
  }): Promise<void>;
}

/**
 * Message preparation: checks a message's resolved props against its template
 * before any sender sees it (and, for a push, before the first device), and
 * returns the props to send — the parsed value. Throwing stops the send; the
 * interpreter adds the instance and node to the error. The Cloudflare host
 * assembles one from the template registries (`registryValidator`).
 */
export interface MessageValidator {
  validate(message: {
    channel: ChannelIR;
    template: string;
    props: Record<string, ScalarIR | undefined>;
  }): Record<string, ScalarIR | undefined>;
}

/** send_event's outlet: feeds back into ingest (the event edge between workflows). */
export interface EventSink {
  /**
   * `id` identifies the occurrence, and sending the same one twice must record
   * it once. The interpreter passes `${instanceId}:${nodeId}` — the same
   * identity senders and actions de-duplicate on — because the emit is wrapped
   * in a step, and a step body is retried after a failure that may have
   * happened *after* the event was already written.
   */
  emit(event: string, payload: Record<string, ScalarIR | undefined>, id: string): Promise<void>;
}

/** One action node's resolved call, ready for the registry. */
export interface ActionInvocation {
  /** Registry name; the code itself lives in the deployed bundle (dual-plane model, see dsl/action.ts). */
  action: string;
  /** Already resolved: user_property references have been replaced by actual values (same contract as message props). */
  args: Record<string, ScalarIR | undefined>;
  userId: string;
  /** `${instanceId}:${nodeId}` — handlers with external side effects de-duplicate on it, like senders do. */
  idempotencyKey: string;
}

/**
 * Custom-action outlet. The interpreter already wraps the call in step.do, so
 * an implementation may just look up and run the handler — a throw is retried
 * by the runtime, a success is checkpointed.
 */
export interface ActionInvoker {
  invoke(invocation: ActionInvocation): Promise<void>;
}

export interface JourneyContext {
  userId: string;
  /** Instance identity: feeds the idempotency key and the logs. */
  instanceId: string;
  /**
   * When the user entered the workflow (ms epoch) — the baseline for the
   * goal's attribution window (`goal.within`). Must be replay-stable: the
   * adapter derives it from the trigger event's timestamp, never from
   * Date.now() at run time.
   */
  enteredAtMs: number;
  step: EngineStep;
  facts: FactSource;
  messages: MessageSender;
  events: EventSink;
  /** Optional: only journeys whose IR contains action nodes need one; running such a node without it is a runtime error. */
  actions?: ActionInvoker | undefined;
  /** Template props validation before every send; without one, props go out as resolved. */
  validator?: MessageValidator | undefined;
  /** Reporting hooks (positions and copies); without one, nothing is reported. */
  observer?: JourneyObserver | undefined;
}

/**
 * How an instance ended, and — apart from that — whether and when it converted: `goal` ends it
 * at the conversion, while with `exitOnMatch: false` a converted instance ends like any other
 * and only `convertedAt` tells.
 */
export type JourneyOutcome = (
  | { status: 'completed' }
  | { status: 'exited'; reason?: string }
  | { status: 'goal' }
  | { status: 'exit_when' }
) & { convertedAt?: number };
