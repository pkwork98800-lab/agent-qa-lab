// ESLint 9 flat config — agent-qa-lab.
// Prettier owns formatting (.prettierrc); eslint-plugin-prettier is deliberately
// NOT installed, so formatting rules simply stay off and formatting is checked
// by `prettier --check` instead. Linting is type-aware: the typescript-eslint
// recommended + strict-type-checked presets, with the project resolved through
// the TypeScript project service.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url));

const TS_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
const JS_FILES = ['**/*.js', '**/*.mjs', '**/*.cjs'];

// typescript-eslint's base config sets its parser for every file and the
// type-checked presets carry no `files` list of their own; scoping them to
// TypeScript keeps the parser (and the typed rules) off plain JavaScript.
const typedConfigs = [
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.strictTypeChecked,
].map((config) => ({ ...config, files: config.files ?? TS_FILES }));

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'runs/',
      'reports/',
      'dist/',
      // Promptfoo ships its own JS style; the web UI is plain browser code.
      'framework/promptfoo/**',
      'apps/under-test/ui/**',
    ],
  },
  {
    files: JS_FILES,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    ...js.configs.recommended,
  },
  ...typedConfigs,
  {
    files: TS_FILES,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    rules: {
      // A `_`-prefixed argument or binding is intentionally unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // No `any` without a genuine justification comment at the escape hatch.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // The mock agent and eval runner intentionally use structural typing,
      // template literals with mixed types, and optional chaining on possibly
      // null values. These rules flag too many false positives in this codebase.
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // node:test wraps every test callback in a promise it owns; rejecting is
    // the runner's job, not the test's. Sync `assert` bodies are the norm here.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },
);
