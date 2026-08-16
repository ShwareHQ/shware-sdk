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

  /** Durable sleep: suspended time is not billed. */
  sleep(name: string, ms: number): Promise<void>;

  /** Sleep until an absolute instant (used by time_window). */
  sleepUntil(name: string, timestampMs: number): Promise<void>;

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
   */
  subscribe(name: string, events: readonly string[]): Promise<void>;

  /** Durable: drop every registration this instance holds. */
  unsubscribe(name: string): Promise<void>;

  /**
   * Wait for a wake-up or a timeout. A registration from `subscribe` must
   * already exist — this call only parks the instance.
   */
  waitForWake(name: string, timeoutMs: number): Promise<'event' | 'timeout'>;
}

/** Facts from a single user's point of view: the read interface condition evaluation uses (D1 and in-memory share one evaluator). */
export interface FactSource {
  /**
   * How many times an event occurred. `sinceMs` bounds the window (within /
   * anchoring); `where` is a payload-only condition tree — count only events
   * whose payload matches (evaluate with matchesWhere from engine/condition).
   */
  countEvents(event: string, opts?: { sinceMs?: number; where?: ConditionIR }): Promise<number>;
  getProperty(path: string): Promise<ScalarIR | undefined>;
  /** Resolve a segment definition by name (stored with the bundle at deploy time). */
  getSegmentCondition(name: string): Promise<ConditionIR | undefined>;
}

export interface OutboundMessage {
  channel: ChannelIR;
  template: string;
  /** Already resolved: user_property references have been replaced by actual values. */
  props: Record<string, ScalarIR | undefined>;
  userId: string;
  /** The channel's recipient address, resolved from the profile by the engine — so senders never read the database. */
  recipient?: string | undefined;
  /** `${instanceId}:${nodeId}` — senders de-duplicate on it, making replays and retries safe. */
  idempotencyKey: string;
}

export interface MessageSender {
  send(message: OutboundMessage): Promise<void>;
}

/** send_event's outlet: feeds back into ingest (the event edge between workflows). */
export interface EventSink {
  emit(event: string, payload: Record<string, ScalarIR | undefined>): Promise<void>;
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
}

export type JourneyOutcome =
  | { status: 'completed' }
  | { status: 'exited'; reason?: string }
  | { status: 'goal' }
  | { status: 'exit_when' };
