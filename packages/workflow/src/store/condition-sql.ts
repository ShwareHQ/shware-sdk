import { RECIPIENT_PROPERTY } from '../engine/recipient';
import type { ConditionIR, PropertyOperatorIR, ScalarIR } from '../ir';
import { USER_ID_PROPERTY } from './facts';

/**
 * A condition as one SQL boolean over a whole set of users, for the segment sweep: where
 * `engine/condition.ts` asks about one user in several round trips, this asks about all of them
 * in one statement.
 *
 * `engine/condition.ts` stays the authority, and this only narrows down who it has to look at.
 * So the result is three-valued: TRUE and FALSE state what the evaluator would answer, and NULL
 * means "ask the evaluator". SQL's AND, OR and NOT carry a NULL exactly as far as it can affect
 * the outcome, so a leaf that cannot match JavaScript's semantics returns NULL and nothing above
 * it has to know. That covers what SQL has no clean form for: a comparison across types (`'5' > 3`
 * coerces in JavaScript), a segment that is unknown or reaches itself (the evaluator throws, and
 * its error is the one to report), hand-built IR.
 *
 * Injection: nothing from the condition is ever written into the statement. Every name, path and
 * value goes through `bind`, as does the clock; the only other text is this file's own SQL, the
 * store's table names and a count checked to be an integer. Keep it that way: a segment id or a
 * property path is data, however trusted the bundle that carries it.
 */

export interface ConditionSqlContext {
  /** The qualified tables the condition reads. */
  tables: { event: string; suppression: string; device: string };
  /** The column holding the user id. */
  user: string;
  /** The column holding the user's profile props, NULL when there is no profile. */
  props: string;
  nowMs: number;
  /** Every deployed segment, for `segment(...)` references. */
  segments: ReadonlyMap<string, ConditionIR>;
  /** Registers a parameter and returns its placeholder (`$3`). */
  bind(value: unknown): string;
}

const UNKNOWN = 'NULL::boolean';

/** `to_timestamp`, as every other read of `ts` in the store writes it. */
const timestamp = (param: string) => `to_timestamp(${param}::double precision / 1000)`;

export function conditionToSql(condition: ConditionIR, context: ConditionSqlContext): string {
  // Postgres refuses NUL in text and jsonb, and one bad parameter would fail the statement for
  // every segment on the page. JSON escapes it, so this sees it wherever the tree holds it.
  if (JSON.stringify(condition).includes('\\u0000')) return UNKNOWN;
  return compile(condition, context, []);
}

function compile(
  condition: ConditionIR,
  context: ConditionSqlContext,
  enclosing: readonly string[]
): string {
  switch (condition.type) {
    case 'and':
      return join(
        condition.conditions.map((child) => compile(child, context, enclosing)),
        'AND',
        'TRUE'
      );
    case 'or':
      return join(
        condition.conditions.map((child) => compile(child, context, enclosing)),
        'OR',
        'FALSE'
      );
    case 'not':
      return `(NOT ${compile(condition.condition, context, enclosing)})`;
    case 'segment': {
      const definition = context.segments.get(condition.segment);
      if (definition === undefined || enclosing.includes(condition.segment)) return UNKNOWN;
      return compile(definition, context, [...enclosing, condition.segment]);
    }
    case 'performed':
      return performed(condition, context);
    case 'property':
      return compare(
        condition,
        once(() => profileScalar(condition.path, context)),
        context
      );
    case 'reachable':
      return reachable(condition.channel, context);
    case 'payload':
      // The evaluator rejects a payload condition outside a where clause
      return UNKNOWN;
  }
}

function once(make: () => string): () => string {
  let made: string | undefined;
  return () => (made ??= make());
}

function join(parts: string[], operator: 'AND' | 'OR', empty: string): string {
  return parts.length === 0 ? empty : `(${parts.join(` ${operator} `)})`;
}

/** Mirrors `JourneyFactSource.countEvents`: the window's bounds are inclusive at both ends. */
function performed(
  condition: Extract<ConditionIR, { type: 'performed' }>,
  context: ConditionSqlContext
): string {
  const atLeast = Math.ceil(condition.count ?? 1);
  if (!Number.isSafeInteger(atLeast)) return UNKNOWN;
  if (atLeast <= 0) return 'TRUE'; // Every count is at least zero
  const since = condition.within === undefined ? undefined : context.nowMs - condition.within.ms;
  // Before anything is bound: to_timestamp would fail the whole statement on it
  if (since !== undefined && !Number.isFinite(since)) return UNKNOWN;
  let events =
    `SELECT 1 FROM ${context.tables.event} ev ` +
    `WHERE ev.user_id = ${context.user} AND ev.name = ${context.bind(condition.event)}::text`;
  if (since !== undefined) events += ` AND ev.ts >= ${timestamp(context.bind(since))}`;
  if (condition.where === undefined) return reaches(events, atLeast);
  const where = whereToSql(condition.where, context);
  // An event the where clause cannot decide may or may not count
  const certain = reaches(`${events} AND (${where}) IS TRUE`, atLeast);
  const possible = reaches(`${events} AND (${where}) IS NOT FALSE`, atLeast);
  return `(CASE WHEN ${certain} THEN TRUE WHEN ${possible} THEN ${UNKNOWN} ELSE FALSE END)`;
}

/** Whether a query yields `atLeast` rows, stopping there: the (user_id, name, ts) index serves it. */
function reaches(query: string, atLeast: number): string {
  return atLeast === 1
    ? `EXISTS (${query})`
    : `((SELECT count(*) FROM (${query} LIMIT ${String(atLeast)}) capped) >= ${String(atLeast)})`;
}

/** Mirrors `matchesWhere`, over the event row `ev`. */
function whereToSql(where: ConditionIR, context: ConditionSqlContext): string {
  switch (where.type) {
    case 'and':
      return join(
        where.conditions.map((child) => whereToSql(child, context)),
        'AND',
        'TRUE'
      );
    case 'or':
      return join(
        where.conditions.map((child) => whereToSql(child, context)),
        'OR',
        'FALSE'
      );
    case 'not':
      return `(NOT ${whereToSql(where.condition, context)})`;
    case 'payload': {
      const keys = where.path.split('.');
      if (!keys.every(isPlainKey)) return UNKNOWN;
      const raw = once(() =>
        keys.reduce((json, key) => `${json} -> ${context.bind(key)}::text`, 'ev.payload')
      );
      // Unlike a comparison, exists sees objects and arrays too; only JSON null reads as missing
      const present = () =>
        `(jsonb_typeof(${raw()}) IS DISTINCT FROM 'null' AND ${raw()} IS NOT NULL)`;
      if (where.op === 'exists') return present();
      if (where.op === 'not_exists') return `(NOT ${present()})`;
      return compare(
        where,
        once(() => scalarOf(raw())),
        context
      );
    }
    default:
      // Compile rejects these, and the evaluator throws on hand-built IR
      return UNKNOWN;
  }
}

/**
 * A key `valueAtPath` finds in plain JSON objects only. It indexes with `current[key]`, so a
 * number reaches into an array, `length` reads an array's size and `toString` finds the prototype,
 * none of which `->` does.
 */
function isPlainKey(key: string): boolean {
  return !/^\d+$/.test(key) && key !== 'length' && !(key in Object.prototype);
}

/** The value if it is a JSON scalar, SQL NULL otherwise: a non-scalar reads as absent. */
function scalarOf(json: string): string {
  return `(CASE WHEN jsonb_typeof(${json}) IN ('string', 'number', 'boolean') THEN ${json} END)`;
}

/** Mirrors `JourneyFactSource.getProperty`. */
function profileScalar(path: string, context: ConditionSqlContext): string {
  if (path === USER_ID_PROPERTY) return `to_jsonb(${context.user})`;
  return scalarOf(`${context.props} -> ${context.bind(path)}::text`);
}

function reachable(
  channel: Extract<ConditionIR, { type: 'reachable' }>['channel'],
  context: ConditionSqlContext
): string {
  // The channel-wide opt-out only, as in the evaluator: its row has no topic
  const suppressed =
    `EXISTS (SELECT 1 FROM ${context.tables.suppression} s ` +
    `WHERE s.user_id = ${context.user} AND s.channel = ${context.bind(channel)}::text AND s.topic IS NULL)`;
  let address: string;
  if (channel === 'push') {
    address = `EXISTS (SELECT 1 FROM ${context.tables.device} d WHERE d.user_id = ${context.user})`;
  } else {
    const path = RECIPIENT_PROPERTY[channel];
    address = path === undefined ? 'TRUE' : `${profileScalar(path, context)} IS NOT NULL`;
  }
  return `(NOT ${suppressed} AND ${address})`;
}

/**
 * Mirrors `compareProperty`. `actual` yields a jsonb scalar, or SQL NULL for "undefined". It is
 * asked for only by a branch that uses it: Postgres cannot type a parameter no statement mentions,
 * so an operator that needs no value (`between` without a range) must not bind one.
 */
function compare(
  condition: {
    op: PropertyOperatorIR;
    value?: ScalarIR | undefined;
    values?: ScalarIR[] | undefined;
  },
  actual: () => string,
  context: ConditionSqlContext
): string {
  const { value, values } = condition;
  const json = (scalar: ScalarIR) => `${context.bind(JSON.stringify(scalar))}::text::jsonb`;
  const isIn = () =>
    (values ?? []).length === 0
      ? 'FALSE'
      : `COALESCE(${actual()} IN (${(values ?? []).map(json).join(', ')}), FALSE)`;
  const isBetween = () => {
    if (values === undefined || values.length < 2) return 'FALSE';
    const [min, max] = values as [ScalarIR, ScalarIR, ...ScalarIR[]];
    return `(${order(actual, '>=', min, context)} AND ${order(actual, '<=', max, context)})`;
  };
  const contains = () =>
    typeof value === 'string'
      ? `COALESCE(jsonb_typeof(${actual()}) = 'string' AND strpos(${actual()} #>> '{}', ${context.bind(value)}::text) > 0, FALSE)`
      : 'FALSE';
  switch (condition.op) {
    case 'exists':
      return `(${actual()} IS NOT NULL)`;
    case 'not_exists':
      return `(${actual()} IS NULL)`;
    case 'eq':
      return value === undefined
        ? `(${actual()} IS NULL)`
        : `COALESCE(${actual()} = ${json(value)}, FALSE)`;
    case 'ne':
      return value === undefined
        ? `(${actual()} IS NOT NULL)`
        : `(${actual()} IS DISTINCT FROM ${json(value)})`;
    case 'gt':
      return order(actual, '>', value, context);
    case 'gte':
      return order(actual, '>=', value, context);
    case 'lt':
      return order(actual, '<', value, context);
    case 'lte':
      return order(actual, '<=', value, context);
    case 'between':
      return isBetween();
    case 'not_between':
      return `(NOT ${isBetween()})`;
    case 'in_array':
      return isIn();
    case 'not_in_array':
      return `(NOT ${isIn()})`;
    case 'contains':
      return contains();
    case 'not_contains':
      return `(NOT ${contains()})`;
  }
}

/**
 * An ordering of two values of one type; across types JavaScript coerces, so that is the
 * evaluator's to answer. Strings compare by code point, what `COLLATE "C"` does on UTF-8: JavaScript
 * compares UTF-16 units, which differs only between an astral character and U+E000 to U+FFFF.
 */
function order(
  scalar: () => string,
  operator: '>' | '>=' | '<' | '<=',
  value: ScalarIR | undefined,
  context: ConditionSqlContext
): string {
  if (value === undefined) return 'FALSE';
  const actual = scalar();
  let same = UNKNOWN;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const bound = `${context.bind(String(value))}::text::numeric`;
    same = `(CASE WHEN jsonb_typeof(${actual}) = 'number' THEN (${actual})::numeric ${operator} ${bound} END)`;
  } else if (typeof value === 'string') {
    const bound = `${context.bind(value)}::text`;
    same = `(CASE WHEN jsonb_typeof(${actual}) = 'string' THEN (${actual} #>> '{}') COLLATE "C" ${operator} ${bound} END)`;
  }
  return `(CASE WHEN ${actual} IS NULL THEN FALSE ELSE ${same} END)`;
}
