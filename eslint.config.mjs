import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';

// typescript-eslint / @eslint-react were removed: TypeScript 7 (the native compiler) no longer
// ships the JS compiler API they depend on. TS/TSX syntax is parsed by @babel/eslint-parser
// (@babel/preset-typescript, no type information); type-aware checks are left to tsc (TS7).
// Babel 8 decides TS vs TSX from the file extension.

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['node_modules/', '.next/', 'out/', 'dist/', 'public/'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: babelParser,
      sourceType: 'module',
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ['@babel/preset-typescript'],
        },
      },
    },
  },
  {
    // Babel 8 does not enable JSX automatically for .tsx, so request it explicitly
    files: ['**/*.tsx'],
    languageOptions: {
      parser: babelParser,
      sourceType: 'module',
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ['@babel/preset-typescript'],
          plugins: ['@babel/plugin-syntax-jsx'],
        },
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      ...js.configs.recommended.rules,
      // Rules covered by tsc, or that misfire on TypeScript syntax, are off
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-dupe-class-members': 'off',
      // Findings left in existing code are warnings to be cleaned up gradually (not checked by the old config)
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      'no-useless-escape': 'warn',
      'no-empty': 'warn',
      'no-control-regex': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      // React Compiler rules are too strict for existing patterns
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'no-case-declarations': 'off',
    },
  },
  eslintConfigPrettier,
];
