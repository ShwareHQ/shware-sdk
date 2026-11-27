import type { PropValueIR } from '../ir';
import type { EventMap, UserPropertyBase } from './base';

/**
 * Reference tables — the DSL's only two type-injection points (drizzle's
 * column-object pattern): `u = user<UserProperty>()` and `e = event<Event>()`.
 * Every other function in the DSL is generic-free and reads types off these
 * references.
 *
 * Type technique: phantom types. `UserPropertyRef<T>` carries the property's
 * type in an optional, never-assigned `__t` — purely so free functions like
 * `eq` can infer T from the reference. At runtime a ref is just
 * `{ type, path }`, produced by a Proxy on property access.
 */

/**
 * User-property reference (drizzle's column equivalent), shared by predicates
 * (eq/gt/…) and message-prop personalization. The phantom type __t is how a
 * free function reads the property's type off the reference.
 */
export interface UserPropertyRef<T> {
  readonly type: 'user_property';
  readonly path: string;
  readonly __t?: T;
}

/** Event reference: the argument to `performed`; future payload where-clauses and value refs hang off it. */
export interface EventRef<P = unknown> {
  readonly type: 'event_ref';
  readonly name: string;
  readonly __p?: P;
}

/** Property reference table: `u.subscription_status` is a UserPropertyRef (drizzle's `users.email`). */
export type UserRefs<U> = { readonly [K in keyof U]-?: UserPropertyRef<U[K]> };

/** Event reference table: `e.purchase` is an EventRef. */
export type EventRefs<E> = { readonly [K in keyof E]-?: EventRef<E[K]> };

/**
 * Build the reference tables: the app calls each once in its schema module and
 * exports the result (implemented with a Proxy — property access *is* the reference).
 *
 *   export const u = user<UserProperty>();
 *   export const e = event<Event>();
 *
 * From then on predicates and personalization are all property access:
 * eq(u.subscription_status, 'active'), performed(e.purchase, { within: '30 days' }),
 * { plan: u.subscription_plan }.
 *
 * Properties are deliberately single-level: the data source is a database
 * table and is naturally flat, so nested paths are out of scope.
 */
export function user<U extends UserPropertyBase>(): UserRefs<U> {
  return new Proxy({} as UserRefs<U>, {
    get: (_target, prop) => ({ type: 'user_property', path: String(prop) }),
  });
}

export function event<E extends EventMap>(): EventRefs<E> {
  return new Proxy({} as EventRefs<E>, {
    get: (_target, prop) => ({ type: 'event_ref', name: String(prop) }),
  });
}

/** An impossible field cannot be supplied indirectly through a reference either. */
export type PropInput<T> = [T] extends [never]
  ? never
  : T | UserPropertyRef<T> | TriggerPayloadRef<T>;
export type PropsInput<P> = { [K in keyof P]: PropInput<P[K]> };

/** Props may be omitted when a template declares none, and are required when it does. */
export type MessageArgs<P> =
  Record<string, never> extends P ? [props?: PropsInput<P>] : [props: PropsInput<P>];

/* ------------------------------ payload references ----------------------------- */

/**
 * Where a payload ref keeps its own state. A payload ref doubles as the table
 * of its sub-fields, so every *string* key it answered for itself shadowed an
 * author's field of that name: with a payload field called `path`,
 * `performed(e.page_view, (p) => eq(p.path, '/pricing'))` type-checked, handed
 * `prop()` the ref's own prefix instead of a sub-ref, and compiled to a
 * *profile* predicate on a property named 'path' — a mistake that only
 * surfaced later, as a zod error nowhere near the line that caused it. A symbol
 * key cannot be reached by `p.<field>`, so no field name can collide with it.
 */
export const PAYLOAD_PATH: unique symbol = Symbol('workflow.payloadPath');

/**
 * Event-payload reference: what a `where` callback's parameter hands out. The
 * path it carries is dotted for nested fields ('tags.utm_source'). Predicates
 * accept it alongside UserPropertyRef and compile to a `payload` condition —
 * which is only valid inside `performed({ where })` / the event trigger's
 * `where` (compileBundle enforces the placement).
 */
export interface PayloadRef<T> {
  readonly [PAYLOAD_PATH]: string;
  readonly __t?: T;
}

/** A payload field ref that is itself an object also acts as a table of its sub-field refs. */
export type PayloadRefNode<T> = [NonNullable<T>] extends [never]
  ? PayloadRef<T>
  : [NonNullable<T>] extends [object]
    ? PayloadRef<T> & {
        readonly [
          K in keyof NonNullable<T> & string as [NonNullable<T>[K]] extends [never] ? never : K
        ]-?: PayloadRefNode<NonNullable<T>[K]>;
      }
    : PayloadRef<T>;

/** Payload reference table for an event's payload P — the `p` in `where: (p) => eq(p.platform, 'web')`. */
export type PayloadRefs<P> = [P] extends [object]
  ? {
      readonly [K in keyof P & string as [P[K]] extends [never] ? never : K]-?: PayloadRefNode<
        P[K]
      >;
    }
  : Record<string, PayloadRef<unknown>>;

/**
 * Nested Proxy: every string key extends the dotted path, so an author's field
 * may be named anything — including `path` or `type`. The ref's own path reads
 * off PAYLOAD_PATH, the one key a field name cannot spell.
 * @internal used by performed() and trigger.event() to hand `p` to a where callback
 */
export function payloadRefs<P>(prefix = ''): PayloadRefs<P> {
  return new Proxy({} as PayloadRefs<P>, {
    get: (_target, prop) => {
      if (prop === PAYLOAD_PATH) return prefix;
      // Other symbols are the runtime's own probes (inspection, iteration, thenable checks), never fields
      if (typeof prop === 'symbol') return undefined;
      return payloadRefs(prefix === '' ? prop : `${prefix}.${prop}`);
    },
  });
}

/* --------------------------- trigger payload references -------------------------- */

/**
 * Where a trigger payload ref keeps its own state — a symbol key for the same
 * reason as PAYLOAD_PATH: the ref doubles as the table of its sub-fields, so a
 * string key would shadow an author's field of that name.
 */
export const TRIGGER_REF: unique symbol = Symbol('workflow.triggerRef');

/**
 * A field of the event that started the journey: what `t.payload.<field>` hands
 * out, for `const t = trigger.event(e.begin_checkout)`. Unlike a `where`
 * callback's payload ref it is valid anywhere in the workflow that event
 * triggers — predicates (branch / filter / waitUntil / goal / exitWhen),
 * message props, emitted payloads and action args — and reads the same value
 * for the whole journey: the payload the user entered with, never a later
 * occurrence of the event.
 */
export interface TriggerPayloadRef<T> {
  readonly [TRIGGER_REF]: { readonly event: string; readonly path: string };
  readonly __t?: T;
}

/** A trigger payload field that is itself an object also acts as the table of its sub-field refs. */
export type TriggerPayloadRefNode<T> = [NonNullable<T>] extends [never]
  ? TriggerPayloadRef<T>
  : [NonNullable<T>] extends [object]
    ? TriggerPayloadRef<T> & {
        readonly [
          K in keyof NonNullable<T> & string as [NonNullable<T>[K]] extends [never] ? never : K
        ]-?: TriggerPayloadRefNode<NonNullable<T>[K]>;
      }
    : TriggerPayloadRef<T>;

/** The table `t.payload` is, for a triggering event whose payload is P. */
export type TriggerPayloadRefs<P> = [P] extends [object]
  ? {
      readonly [
        K in keyof P & string as [P[K]] extends [never] ? never : K
      ]-?: TriggerPayloadRefNode<P[K]>;
    }
  : Record<string, TriggerPayloadRef<unknown>>;

/** @internal used by trigger.event() to build `t.payload` */
export function triggerPayloadRefs<P>(event: string, prefix = ''): TriggerPayloadRefs<P> {
  return new Proxy({} as TriggerPayloadRefs<P>, {
    get: (_target, prop) => {
      if (prop === TRIGGER_REF) return { event, path: prefix };
      if (typeof prop === 'symbol') return undefined;
      return triggerPayloadRefs(event, prefix === '' ? prop : `${prefix}.${prop}`);
    },
  });
}

/** @internal the event and path behind a trigger payload ref; undefined for anything else */
export function triggerRefOf(value: unknown): { event: string; path: string } | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  return (value as Partial<TriggerPayloadRef<unknown>>)[TRIGGER_REF];
}

/**
 * @internal Message props, an emitted payload or action args as IR values. A
 * user-property ref is already its own IR; a trigger payload ref is a Proxy,
 * so it is replaced by the plain value reference it stands for.
 */
export function propValuesIR(values: object | undefined): Record<string, PropValueIR> {
  const out: Record<string, PropValueIR> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    const ref = triggerRefOf(value);
    out[key] =
      ref === undefined
        ? (value as PropValueIR)
        : { type: 'trigger_payload', event: ref.event, path: ref.path };
  }
  return out;
}
