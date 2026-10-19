import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import reactCompiler, { type PluginOptions } from 'babel-plugin-react-compiler';
import type { Plugin } from 'vitest/config';

export interface CompilerReport {
  file: string;
  code: string;
  events: { kind: string; name?: string | null; memoSlots?: number }[];
}

const fixture = fileURLToPath(new URL('./app.test.tsx', import.meta.url));
const reportsModule = fileURLToPath(new URL('./reports.test.ts', import.meta.url));
const targets = [
  fileURLToPath(new URL('../../hooks/use-web-analytics.ts', import.meta.url)),
  fileURLToPath(new URL('../../hooks/use-app-analytics.ts', import.meta.url)),
  fixture,
];

/** Only the Compiler project uses this plugin; the ordinary suite keeps its uncompiled baseline. */
export function analyticsCompiler(): Plugin {
  const cache = new Map<string, { source: string; report: CompilerReport }>();

  function compile(source: string, filename: string): CompilerReport {
    const previous = cache.get(filename);
    if (previous?.source === source) return previous.report;

    const events: CompilerReport['events'] = [];
    const options: PluginOptions = {
      target: '19',
      compilationMode: 'infer',
      panicThreshold: 'none',
      logger: {
        logEvent(_file, event) {
          events.push(
            event.kind === 'CompileSuccess'
              ? { kind: event.kind, name: event.fnName, memoSlots: event.memoSlots }
              : { kind: event.kind }
          );
        },
      },
    };
    const result = transformSync(source, {
      filename,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      plugins: [[reactCompiler, options]],
      sourceMaps: false,
    });
    if (!result?.code) throw new Error(`React Compiler produced no code for ${filename}`);
    const report = { file: filename.split('/').at(-1) ?? filename, code: result.code, events };
    cache.set(filename, { source, report });
    return report;
  }

  return {
    name: 'analytics-react-compiler-regression',
    enforce: 'pre',
    transform(source, id) {
      const filename = id.split('?')[0];
      if (!targets.includes(filename)) return;
      const report = compile(source, filename);
      // A report is registered only when this transformed module actually executes. Merely
      // compiling an unused source copy cannot satisfy the test's compilation assertions.
      return {
        code: `${report.code}\nimport { compilerReports as __analyticsCompilerReports } from ${JSON.stringify(reportsModule)};\n__analyticsCompilerReports.push(${JSON.stringify(report)});`,
        map: null,
      };
    },
  };
}
