import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';

// typescript-eslint / @eslint-react は TypeScript 7（ネイティブ版）が JS コンパイラ API を
// 同梱しなくなったため動作せず撤去。TS/TSX の構文解析は @babel/eslint-parser
// （@babel/preset-typescript、型情報なし）で行い、型に依存する検査は tsc（TS7）が担う。
// TSX かどうかは Babel 8 が拡張子から自動判定する。

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
    // .tsx の JSX 構文は Babel 8 では自動有効にならないため明示する
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
      // TypeScript(tsc) 側で検査されるルール、および TS 構文へ誤検知するルールは無効化
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-dupe-class-members': 'off',
      // 既存コードに残る指摘は warn で計上し、漸進的に解消する（旧構成では未検査だったルール）
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
