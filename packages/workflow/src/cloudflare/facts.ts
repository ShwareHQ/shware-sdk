import { matchesWhere } from '../engine/condition';
import type { FactSource } from '../engine/ports';
import { ConditionIR, type ScalarIR } from '../ir';
import type { D1DatabaseLike } from './bindings';

/** Single-user fact source over D1: evaluation lives in engine/condition.ts, this only reads. */
export class D1FactSource implements FactSource {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly userId: string
  ) {}

  async countEvents(
    event: string,
    opts?: { sinceMs?: number; where?: ConditionIR }
  ): Promise<number> {
    const sinceMs = opts?.sinceMs;
    const where = opts?.where;

    if (where !== undefined) {
      // Payload filtering happens in JS via the shared evaluator — one set of
      // where semantics with the in-memory FactSource, per-user row counts are small
      const { results } =
        sinceMs === undefined
          ? await this.db
              .prepare('SELECT payload FROM events WHERE user_id = ? AND name = ?')
              .bind(this.userId, event)
              .all<{ payload: string }>()
          : await this.db
              .prepare('SELECT payload FROM events WHERE user_id = ? AND name = ? AND ts >= ?')
              .bind(this.userId, event, sinceMs)
              .all<{ payload: string }>();
      return results.filter((row) => matchesWhere(JSON.parse(row.payload), where)).length;
    }

    const row =
      sinceMs === undefined
        ? await this.db
            .prepare('SELECT COUNT(*) AS c FROM events WHERE user_id = ? AND name = ?')
            .bind(this.userId, event)
            .first<{ c: number }>()
        : await this.db
            .prepare('SELECT COUNT(*) AS c FROM events WHERE user_id = ? AND name = ? AND ts >= ?')
            .bind(this.userId, event, sinceMs)
            .first<{ c: number }>();
    return row?.c ?? 0;
  }

  /**
   * The scalar boundary. Everything downstream — comparisons, subject
   * placeholders, resolved message props — is typed ScalarIR, but nothing so
   * far has checked that the stored JSON is one: /identify validates only that
   * `props` is a plain object, and json_patch stores whatever nesting it is
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
    const row = await this.db
      .prepare('SELECT props FROM profiles WHERE user_id = ?')
      .bind(this.userId)
      .first<{ props: string }>();
    if (!row) return undefined;
    const props = JSON.parse(row.props) as Record<string, unknown>;
    // Own keys only: `props[path]` would otherwise find Object.prototype, so
    // `exists(u.toString)` held for every user with a profile row and a subject
    // placeholder rendered native-code text into the email.
    if (!Object.hasOwn(props, path)) return undefined;
    const value = props[path];
    // An explicit null means "unset" and behaves as not_exists. /identify
    // itself clears a property by removing the key (json_patch drops nulls),
    // so this covers profiles written by other means — a direct SQL fixup, a
    // migration, an import.
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return undefined;
  }

  async getSegmentCondition(name: string): Promise<ConditionIR | undefined> {
    const row = await this.db
      .prepare('SELECT condition FROM segments WHERE name = ?')
      .bind(name)
      .first<{ condition: string }>();
    if (!row) return undefined;
    return ConditionIR.parse(JSON.parse(row.condition));
  }
}
