import { matchesWhere } from '../engine/condition';
import type { FactSource, PushDevice } from '../engine/ports';
import type { ConditionIR, ScalarIR } from '../ir';
import type { EventCursor, JourneyStore } from './index';

/** The profile path that reads the user's own id (`u.userId`). */
export const USER_ID_PROPERTY = 'userId';

/** Payloads per round trip when a `where` filters events in JS. */
const PAYLOAD_PAGE = 500;

/** Single-user fact source over a JourneyStore: evaluation lives in engine/condition.ts, this only reads. */
export class JourneyFactSource implements FactSource {
  constructor(
    private readonly store: JourneyStore,
    private readonly userId: string
  ) {}

  async countEvents(
    event: string,
    opts?: { sinceMs?: number; untilMs?: number; where?: ConditionIR; atLeast?: number }
  ): Promise<number> {
    const window = {
      ...(opts?.sinceMs === undefined ? {} : { sinceMs: opts.sinceMs }),
      ...(opts?.untilMs === undefined ? {} : { untilMs: opts.untilMs }),
    };
    const atLeast = opts?.atLeast;
    if (opts?.where === undefined) {
      return this.store.countEvents(this.userId, event, window, atLeast);
    }
    // Payload filtering stays in JS through the shared evaluator — one set of where semantics
    // with the in-memory FactSource — but a page at a time, stopping as soon as enough events
    // match. A heavy user's history is no longer loaded whole on every evaluation; only a user
    // with no match left to find is read to the end, and then in bounded pages.
    const where = opts.where;
    let matched = 0;
    let after: EventCursor | undefined;
    for (;;) {
      const page = await this.store.pageEventPayloads(this.userId, event, window, {
        limit: PAYLOAD_PAGE,
        after,
      });
      for (const payload of page.payloads) {
        if (matchesWhere(payload, where)) matched += 1;
        if (atLeast !== undefined && matched >= atLeast) return matched;
      }
      if (page.next === undefined) return matched;
      after = page.next;
    }
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
    // The system field: the request's identity, never stored in the profile (contract.user.userId)
    if (path === USER_ID_PROPERTY) return this.userId;
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

  /** The user's opt-outs: the channel's, or with a topic that topic's as well. */
  async isSuppressed(channel: string, topic?: string): Promise<boolean> {
    return this.store.isSuppressed(this.userId, channel, topic);
  }

  listDevices(): Promise<PushDevice[]> {
    return this.store.listDevices(this.userId);
  }
}
