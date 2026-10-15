import * as z from 'zod/mini';
import type * as core from 'zod/v4/core';
import { type EventRefs, type UserRefs, event, user } from './dsl';

/**
 * `defineContract({ events, profile })` — the producer/engine contract as Zod
 * schemas, written once in a package both sides import. From it:
 *
 * - `contract.events` / `contract.user` are the DSL's typed reference tables
 *   (what `event<E>()` / `user<U>()` used to be, now derived from the schemas);
 * - `JourneyClient({ contract })` types `track` / `identify` by event name and
 *   checks payloads before sending;
 * - `journeyWorker({ contract })` re-validates every inbound `/events` and
 *   `/identify` — never trusting the caller used the SDK — and refuses a bad
 *   one with a 4xx before anything is stored, woken or started.
 *
 * Supported schemas (v1), synchronous and JSON-shaped: event payloads are
 * object schemas (`z.looseObject` keeps a producer's extra analytics fields,
 * `z.strictObject` refuses them) and may nest objects and arrays; the profile
 * is a flat object of string / number / boolean / enum / literal fields. Input
 * and output must mean the same thing, so defaults, transforms, coercion,
 * custom refinements and async checks are refused when the contract is
 * defined. The Zod instances stay in the host; nothing here changes the IR.
 */

type ObjectSchema = core.$ZodObject;

/** The declared fields of an object schema — without a loose object's `[key: string]: unknown`, so the DSL only offers fields that were written down. */
export type DeclaredOutput<S> =
  S extends core.$ZodObject<infer Shape>
    ? core.$InferObjectOutput<Shape, Record<never, never>>
    : never;

export interface ContractDefinition<
  E extends Record<string, ObjectSchema>,
  P extends ObjectSchema,
> {
  events: E;
  profile: P;
}

/** One rejected field, with the dotted path the producer can fix. */
export interface ContractIssue {
  path: string;
  message: string;
}

export type ContractResult<T> = { ok: true; data: T } | { ok: false; issues: ContractIssue[] };

export interface Contract<
  E extends Record<string, ObjectSchema> = Record<string, ObjectSchema>,
  P extends ObjectSchema = ObjectSchema,
> {
  readonly kind: 'journey-contract';
  /** The DSL's event reference table: `e.purchase` — payload refs from the declared fields only. */
  readonly events: EventRefs<{ [K in keyof E]: DeclaredOutput<E[K]> }>;
  /** The DSL's user-property reference table: `u.name`, plus the system `u.userId`. */
  readonly user: UserRefs<DeclaredOutput<P> & { userId: string }>;
  /** The raw schemas, for hosts that need them (validation, docs). */
  readonly schemas: { readonly events: E; readonly profile: P };
  /** Every event name the contract declares — what a producer forwards. */
  readonly eventNames: readonly (keyof E & string)[];
  isEvent(name: string): name is keyof E & string;
  /** Validate one event's payload; the parsed value is what may be stored. */
  parseEvent<K extends keyof E & string>(
    name: K,
    payload: unknown
  ): ContractResult<core.output<E[K]>>;
  /**
   * Validate an `/identify` merge patch: omitted fields stay as they are,
   * `null` removes a field, every provided value is checked against its field
   * schema, and an undeclared field is refused — a patch, never a full parse
   * that would fill defaults over fields the caller did not send.
   */
  parseProfilePatch(patch: unknown): ContractResult<ProfilePatch<P>>;
}

/** An `/identify` patch over the profile: any subset of fields, `null` to remove one. */
export type ProfilePatch<P> = { [K in keyof DeclaredOutput<P>]?: DeclaredOutput<P>[K] | null };

/** Payload type of one event, for producers: `EventPayload<typeof contract, 'purchase'>`. */
export type EventPayload<C, K extends string> =
  C extends Contract<infer E> ? (K extends keyof E ? core.input<E[K]> : never) : never;

export function defineContract<E extends Record<string, ObjectSchema>, P extends ObjectSchema>(
  definition: ContractDefinition<E, P>
): Contract<E, P> {
  for (const [name, schema] of Object.entries(definition.events)) {
    if (name.startsWith('$')) {
      throw new TypeError(`contract event '${name}': names starting with $ are reserved`);
    }
    assertJsonSchema(schema, `event '${name}'`, true);
  }
  assertJsonSchema(definition.profile, 'profile', true);
  const profileShape = (definition.profile._zod.def as core.$ZodObjectDef).shape;
  for (const [field, schema] of Object.entries(profileShape)) {
    assertFlatScalar(schema, `profile.${field}`);
  }
  const strictProfile = definition.profile._zod.def.catchall?._zod.def.type === 'never';

  const names = Object.keys(definition.events) as (keyof E & string)[];
  return {
    kind: 'journey-contract',
    events: event() as never,
    user: user() as never,
    schemas: { events: definition.events, profile: definition.profile },
    eventNames: names,
    isEvent: (name): name is keyof E & string => Object.hasOwn(definition.events, name),
    parseEvent(name, payload) {
      if (!Object.hasOwn(definition.events, name)) {
        return { ok: false, issues: [{ path: '', message: `unknown event '${name}'` }] };
      }
      return toResult(z.safeParse(definition.events[name], payload));
    },
    parseProfilePatch(patch) {
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        return { ok: false, issues: [{ path: '', message: 'props must be an object' }] };
      }
      const issues: ContractIssue[] = [];
      const data: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(patch)) {
        if (!Object.hasOwn(profileShape, field)) {
          // userId is the request's identity, not a profile field
          if (strictProfile || field === 'userId') {
            issues.push({ path: field, message: 'not a declared profile field' });
          } else {
            data[field] = value;
          }
          continue;
        }
        if (value === null) {
          data[field] = null;
          continue;
        }
        const result = z.safeParse(profileShape[field], value);
        if (result.success) data[field] = result.data;
        else issues.push(...prefixed(field, result.error));
      }
      return issues.length > 0 ? { ok: false, issues } : { ok: true, data: data as never };
    },
  };
}

/**
 * An event the contract refuses — raised for events a journey emits itself
 * (`.sendEvent()`), which never pass the HTTP ingest: they go through the same
 * check, and a refusal is deterministic, so it is not retried.
 */
export class ContractValidationError extends Error {
  override readonly name = 'ContractValidationError';
  constructor(
    readonly event: string,
    readonly issues: ContractIssue[]
  ) {
    super(
      `event '${event}' refused by the contract: ${issues
        .map((i) => `${i.path || '(root)'} ${i.message}`)
        .join('; ')}`
    );
  }
}

/** The one check every event passes, from HTTP or from a journey: declared, and its payload parses. */
export function checkEvent(
  contract: Contract,
  name: string,
  payload: unknown
): ContractResult<Record<string, unknown>> {
  if (!contract.isEvent(name)) {
    return {
      ok: false,
      issues: [{ path: '', message: `'${String(name)}' is not in the contract` }],
    };
  }
  return contract.parseEvent(name, payload);
}

export function isContract(value: unknown): value is Contract {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'journey-contract'
  );
}

function toResult<T>(result: core.util.SafeParseResult<T>): ContractResult<T> {
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, issues: prefixed('', result.error) };
}

function prefixed(prefix: string, error: core.$ZodError): ContractIssue[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter((p) => p !== '').join('.'),
    message: issue.message,
  }));
}

/* ---------------------------- supported schemas ---------------------------- */

/**
 * The schema types a contract may use — JSON shapes that parse synchronously
 * and mean the same before and after parsing. Anything not listed (default,
 * transform, pipe, lazy, promise, custom, date, bigint, …) is refused, and
 * every container is walked so nothing unsupported hides inside one.
 */
const ALLOWED = new Set([
  'object',
  'array',
  'tuple',
  'union',
  'intersection',
  'record',
  'optional',
  'nullable',
  'readonly',
  'nonoptional',
  'string',
  'number',
  'boolean',
  'null',
  'enum',
  'literal',
  'unknown',
  'any',
  'never',
]);

/** Checks that change the value (`overwrite`: `.trim()`, `.toLowerCase()`, …) or run arbitrary code (`custom`: `.refine()`, async or not). */
const REFUSED_CHECKS = new Set(['custom', 'overwrite']);

function assertJsonSchema(schema: unknown, where: string, top = false): void {
  const def = (schema as core.$ZodType | undefined)?._zod?.def;
  if (def === undefined) throw new TypeError(`contract ${where}: not a Zod schema`);
  if (top && def.type !== 'object') {
    throw new TypeError(
      `contract ${where}: must be an object schema (z.looseObject / z.strictObject)`
    );
  }
  if (!ALLOWED.has(def.type)) {
    throw new TypeError(
      `contract ${where}: ${def.type} schemas are not supported (input and output must mean the same JSON, parsed synchronously)`
    );
  }
  if ((def as { coerce?: boolean }).coerce === true) {
    throw new TypeError(`contract ${where}: coercion (z.coerce) is not supported`);
  }
  for (const check of def.checks ?? []) {
    if (REFUSED_CHECKS.has(check._zod.def.check)) {
      throw new TypeError(
        `contract ${where}: ${check._zod.def.check === 'overwrite' ? 'value-changing checks (.overwrite, .trim, …)' : 'custom refinements'} are not supported`
      );
    }
  }
  const children: [string, unknown][] = [];
  switch (def.type) {
    case 'object': {
      const object = def as core.$ZodObjectDef;
      for (const [k, v] of Object.entries(object.shape)) children.push([`${where}.${k}`, v]);
      if (object.catchall !== undefined) children.push([`${where}.*`, object.catchall]);
      break;
    }
    case 'optional':
    case 'nullable':
    case 'readonly':
    case 'nonoptional':
      children.push([where, (def as unknown as { innerType: unknown }).innerType]);
      break;
    case 'array':
      children.push([`${where}[]`, (def as core.$ZodArrayDef).element]);
      break;
    case 'tuple': {
      const tuple = def as core.$ZodTupleDef;
      tuple.items.forEach((item, index) => children.push([`${where}[${index}]`, item]));
      if (tuple.rest !== null) children.push([`${where}[…]`, tuple.rest]);
      break;
    }
    case 'union':
      for (const option of (def as core.$ZodUnionDef).options) children.push([where, option]);
      break;
    case 'intersection': {
      const intersection = def as core.$ZodIntersectionDef;
      children.push([where, intersection.left], [where, intersection.right]);
      break;
    }
    case 'record': {
      const record = def as core.$ZodRecordDef;
      children.push([`${where}{key}`, record.keyType], [`${where}{}`, record.valueType]);
      break;
    }
    default:
      break;
  }
  for (const [path, child] of children) assertJsonSchema(child, path);
}

const SCALARS = new Set(['string', 'number', 'boolean', 'enum', 'literal']);

function assertFlatScalar(schema: unknown, where: string): void {
  let def = (schema as core.$ZodType)._zod.def;
  if (def.type === 'optional') def = (def as core.$ZodOptionalDef).innerType._zod.def;
  if (!SCALARS.has(def.type)) {
    throw new TypeError(
      `contract ${where}: profile fields must be flat scalars (string, number, boolean, enum, literal), got ${def.type}`
    );
  }
}
