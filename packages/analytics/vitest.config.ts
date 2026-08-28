import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Most of the SDK is plain logic plus a mocked `fetch`, so node is the default; the files
    // that read the real DOM — web/getTags, the hooks — opt into jsdom with a
    // `// @vitest-environment jsdom` pragma on their first line.
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      // Type-only modules and the framework wrappers, which are thin composition over hooks
      // already tested directly and would need a full Next/TanStack runtime to render.
      exclude: [
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
