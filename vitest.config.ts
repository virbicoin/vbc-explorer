import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve the `@/` alias from tsconfig.json (replaces the vite-tsconfig-paths plugin)
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.{test,spec}.ts', 'lib/**/*.{test,spec}.ts'],
  },
});
