import type { WorkflowIR } from '../ir';

/**
 * The workflow bodies a process has read, by content hash. A hash names one body for good, so
 * what is kept never goes stale and nothing is ever taken back: a run reads its workflow from
 * here instead of from the store, on every turn after the process's first for that version.
 *
 * One per host (a Worker isolate, a Lambda container, a Node process). Bounded, the least
 * recently used body going first: versions pile up over a long life, and only the ones with
 * journeys still running are asked for.
 */
export class WorkflowCache {
  private readonly kept = new Map<string, WorkflowIR>();

  constructor(private readonly limit = 100) {}

  /**
   * The body under `contentHash`, from memory or through `load`. Undefined when the store has
   * none — which is not remembered, so a body written later is found.
   */
  async get(
    contentHash: string,
    load: () => Promise<WorkflowIR | undefined>
  ): Promise<WorkflowIR | undefined> {
    const kept = this.kept.get(contentHash);
    if (kept !== undefined) {
      // Moved to the end: a Map keeps insertion order, so the front is the least recently used
      this.kept.delete(contentHash);
      this.kept.set(contentHash, kept);
      return kept;
    }
    const loaded = await load();
    if (loaded === undefined) return undefined;
    // Shared by every run of this version from here on: nobody may change it
    this.kept.set(contentHash, freeze(loaded));
    if (this.kept.size > this.limit) {
      const oldest = this.kept.keys().next().value;
      if (oldest !== undefined) this.kept.delete(oldest);
    }
    return loaded;
  }
}

function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const inner of Object.values(value)) freeze(inner);
  return value;
}
