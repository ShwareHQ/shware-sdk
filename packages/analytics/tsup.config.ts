import { Options, defineConfig } from 'tsup';

const options: Options = {
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: false,
  dts: true,
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => (format === 'esm' ? { js: '.mjs' } : { js: '.cjs' }),
};

export default defineConfig([
  {
    ...options,
    entry: ['src/**/*.ts', 'src/**/*.tsx'],
    outDir: 'dist',
    esbuildPlugins: [
      {
        name: 'add-extension',
        setup(build) {
          const defaultExtension = build.initialOptions.format === 'esm' ? '.mjs' : '.cjs';
          const extension = build.initialOptions.outExtension?.js ?? defaultExtension;
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.importer && args.path.startsWith('.')) {
              return { path: args.path + extension, external: true };
            }
          });
        },
      },
    ],
  },
]);
