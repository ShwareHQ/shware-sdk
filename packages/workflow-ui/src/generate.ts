import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { type JourneyConfig, isConfig } from '@shware/workflow';
import { renderDrizzleSchema } from '@shware/workflow/store';
import { runnerImport } from 'vite';
import { findConfig } from './server';

/**
 * `workflow-ui generate` — the engine's Postgres tables as one drizzle file, on the schema the
 * project's `database.schema` names (`workflow` by default). The host re-exports the file from
 * its drizzle schema and lets drizzle-kit write the migration, so the migration history stays the
 * host's. `--check` exits non-zero when the file on disk differs (CI, after an SDK upgrade).
 */

export interface GenerateOptions {
  cwd?: string;
  config?: string;
  out: string;
  check?: boolean;
}

export type GenerateResult = 'written' | 'unchanged' | 'outdated';

/** The host's formatter may rewrap the file, change quotes or trailing commas: not a difference. */
function normalize(source: string): string {
  return (
    source
      .replace(/"/g, "'")
      .replace(/\s+/g, ' ')
      // Spaces around punctuation, and trailing commas, are the formatter's choice
      .replace(/ ?([{}()[\],;:=<>.]) ?/g, '$1')
      .replace(/,([}\])])/g, '$1')
      .trim()
  );
}

export async function generateSchema(options: GenerateOptions): Promise<GenerateResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = findConfig(cwd, options.config);
  const { module } = await runnerImport<{ default?: unknown }>(configPath);
  if (!isConfig(module.default)) {
    throw new Error(
      `workflow-ui: ${relative(cwd, configPath)} must \`export default defineConfig({...})\``
    );
  }
  const config: JourneyConfig = module.default;
  const file = renderDrizzleSchema(config.database?.schema);

  const out = resolve(cwd, options.out);
  const current = existsSync(out) ? readFileSync(out, 'utf8') : undefined;
  if (current !== undefined && normalize(current) === normalize(file)) return 'unchanged';
  if (options.check) return 'outdated';
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, file);
  return 'written';
}
