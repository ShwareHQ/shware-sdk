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

  /**
   * The scalar boundary. Everything downstream — comparisons, subject
   * placeholders, resolved message props — is typed ScalarIR, but nothing so
   * far has checked that the stored JSON is one: /identify validates only that
   * `props` is a plain object, and the merge stores whatever nesting it is
   * handed. Left unchecked, `gt(score, 3)` on `['5']` coerces its way to true
   * while `eq(score, 5)` is false, and `String(recipient)` on an object
   * addresses an email to `[object Object]`.
   *
   * So a non-scalar value reads as absent, matching how matchesWhere treats a
   * non-scalar payload leaf. The port cannot say "present but not a scalar",
   * and guessing at a coercion is what produced the wrong branch in the first
   * place.
   */
  async getProperty(path: string): Promise<ScalarIR | undefined> {
    const props: Record<string, unknown> | undefined = await this.store.getProfile(this.userId);
    if (props === undefined) return undefined;
    // Own keys only: `props[path]` would otherwise find Object.prototype, so
    // `exists(u.toString)` held for every user with a profile row and a subject
    // placeholder rendered native-code text into the email.
    if (!Object.hasOwn(props, path)) return undefined;
    const value = props[path];
    // An explicit null means "unset" and behaves as not_exists. /identify
    // itself clears a property by removing the key (the merge drops nulls), so
    // this covers profiles written by other means — a direct SQL fixup, a
    // migration, an import.
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return undefined;
  }

  getSegmentCondition(name: string): Promise<ConditionIR | undefined> {
    return this.store.getSegmentCondition(name);
  }
}
