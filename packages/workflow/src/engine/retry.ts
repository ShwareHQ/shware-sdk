/**
 * Which step failures a retry would only repeat. A durable step retries what it throws; an
 * error that is the same on every attempt — a template refusing its props, the contract
 * refusing an emitted event, a provider rejecting the request itself — ends the step at once
 * instead of burning the retry budget and delaying the journey. Every runtime adapter asks this
 * one rule.
 */

/**
 * A failure a retry would only repeat: a missing or malformed configuration, a provider refusing
 * the request itself, an input the runtime cannot act on. Thrown inside a durable step, it ends
 * the step at once (`isRetryable` is false) instead of burning the retry budget.
 *
 * Thrown by a message sender, it is a refusal of that one copy: `deliver` settles the copy as
 * undelivered under `reason` — the provider's own code where it gave one (`BadTopic`,
 * `THIRD_PARTY_AUTH_ERROR`, `PayloadTooLarge`) — and the journey goes on.
 */
export class PermanentError extends Error {
  override readonly name: string = 'PermanentError';
  readonly retryable = false;
  /** Short and stable, for the delivery report: a code, not a sentence. */
  readonly reason?: string;
  constructor(message: string, options?: { cause?: unknown; reason?: string }) {
    super(message, options);
    if (options?.reason !== undefined && options.reason !== '') this.reason = options.reason;
  }
}

/**
 * The reason a refused copy settles under: the error's own `reason` when it carries one (told by
 * the property, so a transport of the host's own can name it without importing a class), else
 * `refused`.
 */
export function refusalReason(error: unknown): string {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' && reason !== '' ? reason : 'refused';
}

/**
 * A send the provider never answered: the request went out (or may have) and no response came
 * back — the connection dropped, the fetch timed out. Whether the provider took the message is
 * not known, and a provider that cannot de-duplicate (SES, Cloudflare Email, FCM, a Slack or
 * Discord webhook) would deliver a second attempt as a second message. So this is not the
 * "refused for sure" a thrown send otherwise means: `deliver` keeps the copy's claim and, unless
 * its template is `redelivery: 'resend'`, settles it as undelivered (`no_answer`) rather than
 * sending again.
 *
 * Told by the `unanswered` property, not `instanceof`, so a transport of the host's own can
 * raise one without importing this class.
 */
export class UnansweredSendError extends Error {
  override readonly name: string = 'UnansweredSendError';
  readonly unanswered = true;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export function isUnanswered(error: unknown): boolean {
  return error instanceof Error && (error as { unanswered?: unknown }).unanswered === true;
}

/**
 * The one request of a send that hands the message to the provider, and nothing else: whatever
 * it throws becomes an `UnansweredSendError`. Everything a sender does before it (rendering,
 * signing, fetching a token) stays outside, where a throw still means the message did not go.
 */
export async function awaitAnswer<T>(what: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (cause) {
    const said = cause instanceof Error ? cause.message : String(cause);
    throw new UnansweredSendError(`${what}: no answer (${said})`, { cause });
  }
}

/** Errors the engine raises that are deterministic by construction. */
const DETERMINISTIC = new Set(['TemplateValidationError', 'ContractValidationError']);

/**
 * False for an error a retry cannot fix: one of the engine's deterministic refusals, or any
 * error that says so with `retryable: false` (the transports' 4xx answers).
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (DETERMINISTIC.has(error.name)) return false;
  return (error as { retryable?: unknown }).retryable !== false;
}

/**
 * A send refused for good, the copy `deliver` settles instead of failing the step: an error that
 * says `retryable: false` — a provider's answer, a channel that is not configured. Not the
 * engine's own refusals, which are told by name: a template refusing its props or its content is
 * the workflow, not the recipient, and an erased user ends the journey; both still fail the step.
 */
export function isRefusedSend(error: unknown): boolean {
  if (!(error instanceof Error) || isRetryable(error)) return false;
  return !DETERMINISTIC.has(error.name) && error.name !== 'UserErasedError';
}

/** An HTTP answer a retry can change: a timeout, throttling, or the provider's own fault. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
