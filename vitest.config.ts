import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve the `@/` alias from tsconfig.json (replaces the vite-tsconfig-paths plugin)
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.{test,spec}.ts', 'lib/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.{test,spec}.ts', 'lib/**/index.ts', 'lib/**/types/**'],
    },
  },
});
