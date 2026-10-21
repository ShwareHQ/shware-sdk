import { isRetryable } from '../engine/retry';

/**
 * A read that runs outside any durable step — a runner's admission at its entry, the registry
 * check on AWS — which must see the record as it is now (an erasure since the last checkpoint)
 * and so cannot be checkpointed: a step would replay the first invocation's verdict on every
 * wake. Only the read itself is retried, a bounded number of times, on a transient failure (a
 * dropped connection, a timeout); what it returns is never retried — a refusal is the caller's
 * — and a `PermanentError` (or any error that says `retryable: false`) ends it at once.
 */
export async function readWithRetry<T>(
  fn: () => Promise<T>,
  about: { what: string; instanceId: string },
  budget: { attempts: number; delaysMs: readonly number[] } = { attempts: 3, delaysMs: [100, 300] }
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= budget.attempts || !isRetryable(error)) throw error;
      const delayMs = budget.delaysMs[Math.min(attempt, budget.delaysMs.length) - 1] ?? 0;
      console.warn(
        `[workflow] ${about.what}: read failed for instance ${about.instanceId} (attempt ${attempt} of ${budget.attempts}), retrying in ${delayMs} ms`,
        error
      );
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }
}
