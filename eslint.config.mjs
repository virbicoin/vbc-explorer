import nextConfig from 'eslint-config-next';

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
];

export default eslintConfig;
