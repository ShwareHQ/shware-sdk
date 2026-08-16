import type { UserRefs } from './refs';

/**
 * Subject templates — a subject line is data end to end: a plain string whose
 * `{{ user.prop }}` placeholders the engine fills from the profile at send
 * time, and the studio edits in place. Never a closure.
 *
 * Type technique: recursive template-literal inference extracts every
 * placeholder into a union, which is then checked against the user-property
 * table. The check rides the value parameter as an intersection
 * (`T & SubjectTemplate<T, U>`): T infers from the literal, and on failure the
 * expected type collapses to an error string naming the bad placeholder.
 */

/**
 * Placeholder names inside a `{{ user.prop }}` subject template, extracted at
 * the type level. The syntax is Liquid-style on purpose — it matches what the
 * rest of the ecosystem (customer.io, Braze) and the rest of this codebase
 * (`to = '{{ user.email }}'`) already speak — and the `user.` prefix is a
 * namespace, leaving room for `{{ event.x }}` later. The type accepts exactly
 * the canonical single-space form; the engine's filler is lenient about
 * whitespace at runtime.
 */
export type SubjectPlaceholders<T extends string> =
  T extends `${string}{{ user.${infer K} }}${infer Rest}` ? K | SubjectPlaceholders<Rest> : never;

/**
 * Valid when every `{{ user.prop }}` names a user property; otherwise the type
 * collapses to an error string naming the offending placeholders, so the
 * compiler message says exactly what is wrong.
 */
type SubjectTemplate<T extends string, U> = [SubjectPlaceholders<T>] extends [keyof U & string]
  ? T
  : `unknown user property in subject: {{ user.${Exclude<SubjectPlaceholders<T>, keyof U> & string} }}`;

/**
 * A personalizable subject line: a plain string template whose
 * `{{ user.prop }}` placeholders are checked against the user-property table
 * at compile time — a typo inside the braces does not compile:
 *
 *   emailSubject(u, 'Finish upgrading to {{ user.subscription_plan }}')
 */
export function emailSubject<U, T extends string>(
  refs: UserRefs<U>,
  template: T & SubjectTemplate<T, U>
): T {
  void refs; // type carrier only
  return template;
}
