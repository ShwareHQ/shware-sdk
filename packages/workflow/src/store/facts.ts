import { matchesWhere } from '../engine/condition';
import type { FactSource } from '../engine/ports';
import type { ConditionIR, ScalarIR } from '../ir';
import type { JourneyStore } from './index';

/** Single-user fact source over a JourneyStore: evaluation lives in engine/condition.ts, this only reads. */
export class JourneyFactSource implements FactSource {
  constructor(
    private readonly store: JourneyStore,
    private readonly userId: string
  ) {}

  async countEvents(
    event: string,
    opts?: { sinceMs?: number; where?: ConditionIR }
  ): Promise<number> {
    const window = opts?.sinceMs === undefined ? undefined : { sinceMs: opts.sinceMs };
    if (opts?.where === undefined) return this.store.countEvents(this.userId, event, window);
    // Payload filtering happens in JS via the shared evaluator — one set of
    // where semantics with the in-memory FactSource; per-user row counts are small.
    const where = opts.where;
    const payloads = await this.store.listEventPayloads(this.userId, event, window);
    return payloads.filter((payload) => matchesWhere(payload, where)).length;
  }

  async getProperty(path: string): Promise<ScalarIR | undefined> {
    const props = await this.store.getProfile(this.userId);
    // An explicit null in the profile means "unset": it behaves as not_exists,
    // which is how an /identify caller clears a property.
    return props?.[path] ?? undefined;
  }

  getSegmentCondition(name: string): Promise<ConditionIR | undefined> {
    return this.store.getSegmentCondition(name);
  }
}
