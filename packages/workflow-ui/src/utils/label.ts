/**
 * What to call a code-owned asset in the UI.
 *
 * Keys are wire identity — referenced by name in IR, keyed on by the engine —
 * and nothing anyone should have to read. The label is `meta.name` when set;
 * when it is not, an explicit placeholder, because a blank is easy to miss and
 * "Untitled" is an invitation to name the thing.
 */
export function displayName(name: string | undefined, untitled: string): string {
  const trimmed = name?.trim();
  return trimmed !== undefined && trimmed !== '' ? trimmed : untitled;
}
