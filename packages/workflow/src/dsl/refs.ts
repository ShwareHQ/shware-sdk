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

export type PropInput<T> = T | UserPropertyRef<T>;
export type PropsInput<P> = { [K in keyof P]: PropInput<P[K]> };

/** Props may be omitted when a template declares none, and are required when it does. */
export type MessageArgs<P> =
  Record<never, never> extends P ? [props?: PropsInput<P>] : [props: PropsInput<P>];
