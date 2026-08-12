import type { SourceLocIR } from './ir';

/**
 * Provenance — where in source code a definition came from.
 *
 * Every builder call records its callsite into `meta.loc`. This is the
 * compiler's source map: the IR knows which file:line:column produced each
 * node, so the UI can jump from a canvas node to the editor, and a UI edit can
 * later be written back as an in-place patch of the exact literal that
 * produced the value. `meta` is excluded from contentHash (see hash.ts), so
 * provenance never affects execution identity, version pinning, or plan.
 *
 * Capture is best-effort by design: it relies on `Error.captureStackTrace`
 * (V8, JavaScriptCore 16.4+, SpiderMonkey 132+) to start the stack at the
 * caller of the public builder method — no frame-skipping heuristics over
 * bundled/unbundled layouts. Where the API or a parsable frame is missing,
 * `loc` is simply absent and every consumer degrades gracefully.
 */

type AnyFunction = (...args: never[]) => unknown;

/**
 * V8-style frame: `at fn (file:line:col)` / `at file:line:col`, where file may
 * be an absolute path, a file:// URL (Node ESM) or an http(s) URL (Vite dev).
 */
const FRAME = /at (?:.*? \()?(.+?):(\d+):(\d+)\)?$/;

/**
 * Capture the source location of the call to `boundary` — pass the public
 * builder method itself; everything at and below it is excluded from the stack.
 */
export function captureLoc(boundary: AnyFunction): SourceLocIR | undefined {
  // Read off the constructor untyped: the API is V8-first, and this module must
  // typecheck in DOM-less / Node-less environments (workerd, browsers) alike.
  const capture = (Error as { captureStackTrace?: (target: object, boundary: AnyFunction) => void })
    .captureStackTrace;
  if (typeof capture !== 'function') return undefined;

  const holder = new Error('provenance capture');
  capture(holder, boundary);
  // [0] is the message header; [1] is the first frame past the boundary — the callsite.
  const frame = holder.stack?.split('\n')[1];
  const match = frame === undefined ? null : FRAME.exec(frame);
  if (!match) return undefined;

  const [, rawFile, line, column] = match;
  return {
    file: normalizeFile(rawFile),
    line: Number(line),
    column: Number(column),
  };
}

/**
 * file:// URLs become plain paths; paths under cwd become cwd-relative so the
 * IR stays portable across machines and never leaks a home directory. Browser
 * (Vite dev) URLs pass through untouched.
 */
function normalizeFile(rawFile: string): string {
  let file = rawFile;
  if (file.startsWith('file://')) {
    file = decodeURIComponent(file.slice('file://'.length));
  }
  // globalThis lookup instead of a bare `process` reference: same portability
  // requirement as above — no Node types in workerd / browser consumers.
  const cwd = (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.();
  if (cwd !== undefined && file.startsWith(`${cwd}/`)) {
    file = file.slice(cwd.length + 1);
  }
  return file;
}
