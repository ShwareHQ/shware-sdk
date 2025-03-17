import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  entries: [
    'src/index.ts',
    'src/web/index.ts',
    'src/next/index.tsx',
    'src/react/index.tsx',
    'src/react-router/index.tsx',
  ],
  declaration: 'node16',
  rollup: {
    emitCJS: false,
    dts: {
      compilerOptions: {
        paths: {},
      },
    },
  },
});
