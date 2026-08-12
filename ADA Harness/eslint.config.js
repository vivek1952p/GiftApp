// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  {
    ignores: ['node_modules/**', 'reports/**', 'test-results/**', 'playwright-report/**', 'agent/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The config file itself runs under plain Node CommonJS, not the
    // project's own tsconfig — give it Node globals instead of type-aware
    // linting (it's not part of tsconfig.json's `include`).
    files: ['eslint.config.js'],
    languageOptions: {
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['playwright/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // The harness deliberately reads untyped JSON/CLI/CDP payloads at its
      // boundaries (config.json, axe/UIA output, spawnSync results) and narrows
      // them by hand — treating that as an error would force unsafe `as` casts
      // instead of the explicit checks already in place.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  eslintConfigPrettier
);
