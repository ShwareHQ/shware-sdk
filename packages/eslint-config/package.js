import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import pluginImport from 'eslint-plugin-import';
import { config as baseConfig } from './base.js';

/** @type {import("eslint").Linter.Config} */
export const packageConfig = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    ...pluginImport.flatConfigs.recommended,
    plugins: { import: pluginImport },
    settings: { 'import/resolver': { typescript: true, node: true } },
    rules: {
      ...pluginImport.flatConfigs.recommended.rules,
      'import/newline-after-import': ['error', { count: 1 }],
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'sort-imports': 'error',
    },
  },
  {
    ignores: ['node_modules', 'cdk.out', '**/*.cjs'],
  },
];
