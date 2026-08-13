import type { ScalarIR } from '../ir';

/**
 * Subject personalization: a subject is a string template whose
 * `{{ user.prop }}` placeholders name user properties (compile-checked by
 * `emailSubject` on the DSL side). The engine fills them from the profile at
 * send time — subjects are data end to end, never closures.
 *
 * The type layer accepts only the canonical single-space form; this filler is
 * deliberately lenient about whitespace, so hand-typed variants still fill.
 */

const PLACEHOLDER = /\{\{\s*user\.([^{}\s]+)\s*\}\}/g;

/**
 * Fill a subject template from a property lookup. A missing property renders
 * as an empty string — an incomplete profile should soften the copy, not leak
 * a placeholder or block the send.
 */
export async function fillSubject(
  template: string,
  getProperty: (path: string) => Promise<ScalarIR | undefined>
): Promise<string> {
  const paths = [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
  const values = new Map<string, string>();
  for (const path of new Set(paths)) {
    const value = await getProperty(path);
    values.set(path, value === undefined || value === null ? '' : String(value));
  }
  return template.replace(PLACEHOLDER, (_, path: string) => values.get(path) ?? '');
}
