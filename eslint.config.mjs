import nextConfig from 'eslint-config-next';
import tseslint from 'typescript-eslint';

const eslintConfig = [
  ...nextConfig,
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'public/**'],
  },
  {
    rules: {
      // Disable React Compiler rules (react-hooks v7 strict rules)
      // These are too strict for existing codebase patterns
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  {
    // Surface remaining `any` usages as warnings to drive incremental typing.
    // Kept as 'warn' so it does not block CI while the count is reduced.
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];

export default eslintConfig;
