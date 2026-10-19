import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import { analyticsCompiler } from './src/test/compiler/plugin.test.ts';

export default defineConfig({
  test: {
    // Most of the SDK is plain logic plus a mocked `fetch`, so node is the default; the files
    // that read the real DOM — web/getTags, the hooks — opt into jsdom with a
    // `// @vitest-environment jsdom` pragma on their first line.
    environment: 'node',
    projects: [
      {
        test: {
          name: 'unit',
          exclude: [
            ...configDefaults.exclude,
            'src/hooks/compiler.test.tsx',
            'src/test/compiler/**',
          ],
        },
      },
      {
        plugins: [analyticsCompiler()],
        resolve: {
          alias: {
            'react-native': fileURLToPath(
              new URL('./src/test/compiler/native.test.ts', import.meta.url)
            ),
          },
        },
        test: {
          name: 'react-compiler',
          environment: 'jsdom',
          include: ['src/hooks/compiler.test.tsx'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      // Type-only modules and the framework wrappers, which are thin composition over hooks
      // already tested directly and would need a full Next/TanStack runtime to render.
      exclude: [
        'src/test/compiler/**',
        'src/**/types.ts',
        'src/track/gtag.ts',
        'src/track/lintrk.ts',
        'src/next/**',
        'src/react-router/**',
        'src/tanstack/index.tsx',
        'src/tanstack/analytics.tsx',
        'src/native/fbsdk.ts',
        'src/native/firebase.ts',
        'src/native/posthog.ts',
        'src/native/index.ts',
      ],
    },
  },
});
