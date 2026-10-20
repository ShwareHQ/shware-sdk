/**
 * Which step failures a retry would only repeat. A durable step retries what it throws; an
 * error that is the same on every attempt — a template refusing its props, the contract
 * refusing an emitted event, a provider rejecting the request itself — ends the step at once
 * instead of burning the retry budget and delaying the journey. Every runtime adapter asks this
 * one rule.
 */

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

/** An HTTP answer a retry can change: a timeout, throttling, or the provider's own fault. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
