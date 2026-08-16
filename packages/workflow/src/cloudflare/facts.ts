import type { FactSource } from '../engine/ports';
import { ConditionIR, type ScalarIR } from '../ir';
import type { D1DatabaseLike } from './bindings';

/** Single-user fact source over D1: evaluation lives in engine/condition.ts, this only reads. */
export class D1FactSource implements FactSource {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly userId: string
  ) {}

  async countEvents(event: string, sinceMs?: number): Promise<number> {
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

  async getProperty(path: string): Promise<ScalarIR | undefined> {
    const row = await this.db
      .prepare('SELECT props FROM profiles WHERE user_id = ?')
      .bind(this.userId)
      .first<{ props: string }>();
    if (!row) return undefined;
    const props = JSON.parse(row.props) as Record<string, ScalarIR | null | undefined>;
    const value = props[path];
    // An explicit null in the profile means "unset": it behaves as not_exists,
    // which is how an /identify caller clears a property.
    return value ?? undefined;
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
