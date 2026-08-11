import type { ChannelIR, ConditionIR, ScalarIR } from '../ir';

/**
 * Engine ports: the only shape of the outside world the interpreter depends on.
 *
 * Design constraints (AWS-proof, see the engine design notes):
 * - waitForEvent means "**at least one wake-up, re-evaluate after waking**".
 *   A wake-up is only a hint; no event buffering or de-duplication is promised
 *   (Cloudflare buffers, AWS callback tokens do not — the port takes the
 *   intersection). The truth of a condition is always re-read by the caller
 *   once awake.
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
   * Wait for an external wake-up or a timeout. `events` lists the event names
   * of interest, which the adapter uses to register a subscription (Cloudflare:
   * write the subscription table + waitForEvent; AWS: issue a callback token).
   */
  waitForEvent(
    name: string,
    opts: { events: readonly string[]; timeoutMs: number }
  ): Promise<'event' | 'timeout'>;
}

/** Facts from a single user's point of view: the read interface condition evaluation uses (D1 and in-memory share one evaluator). */
export interface FactSource {
  /** How many times an event occurred; with `sinceMs`, only within that window. */
  countEvents(event: string, sinceMs?: number): Promise<number>;
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
