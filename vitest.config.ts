import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/app/**/*.test.tsx'],
    environment: 'node',
    environmentMatchGlobs: [['tests/app/**/*.test.tsx', 'jsdom']],
  },
});
