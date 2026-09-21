import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The CLI points Vite's root at the shipped `src/app` and compiles it in the
 * consumer's project, so every file that tree reaches has to be in the tarball
 * — a dangling `../../components/button` is a studio that never renders, and
 * `private: true` is the only reason nobody has hit it yet.
 */

/* Containment is spelled out here rather than imported, so this pins the manifest and nothing else. */
function isPublished(entry: string, file: string): boolean {
  const rel = relative(entry, file);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

const SPECIFIERS = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
const EXTENSIONS = ['', '.ts', '.tsx', '.css', '/index.ts', '/index.tsx'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css|html)$/.test(entry.name) ? [path] : [];
  });
}

/** Everything `src/app` pulls in, transitively, as absolute paths. */
function importedFiles(): Set<string> {
  const seen = new Set<string>();
  const queue = sourceFiles(resolve(packageRoot, 'src/app'));
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(SPECIFIERS)) {
      const base = resolve(dirname(file), specifier);
      const resolved = EXTENSIONS.map((extension) => `${base}${extension}`).find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile()
      );
      /* Unresolvable specifiers are a different bug; packaging only owns real files. */
      if (resolved !== undefined) queue.push(resolved);
    }
  }
  return seen;
}

describe('the published tarball', () => {
  test('carries every file the studio app imports', () => {
    const published = (
      JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { files: string[] }
    ).files.map((entry) => resolve(packageRoot, entry));

    const missing = [...importedFiles()]
      .filter((file) => !published.some((entry) => isPublished(entry, file)))
      .map((file) => relative(packageRoot, file))
      .sort();

    expect(missing).toEqual([]);
  });
});
