import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  entries: ['src/index.ts', 'src/polyfills.ts'],
  declaration: 'node16',
  rollup: {
    emitCJS: false,
    dts: {
      compilerOptions: {
        paths: {},
      },
    },
  },
  // externals: ['axios'],
});
