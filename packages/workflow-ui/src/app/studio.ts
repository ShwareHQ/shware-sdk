/**
 * Client for the studio's dev-server endpoints. Read-only: the studio views
 * source, it never writes it — edits happen in the editor and reach the page
 * through Vite.
 */

/** Query params in, JSON out. Used to resolve a node's captured position to a line on disk. */
export async function studioGet<T>(path: string, params: Record<string, unknown>): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)])
  );
  const response = await fetch(`${path}?${query.toString()}`);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
  return payload;
}
