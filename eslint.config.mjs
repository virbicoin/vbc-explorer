import nextConfig from 'eslint-config-next';

const eslintConfig = [
  ...nextConfig,
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'public/**'],
  },
  {
    rules: {
      // Relax strict react-hooks rules for legacy code
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'off',
    },
  },
];

export default eslintConfig;
