import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'node', include: ['tests/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: { name: 'jsdom', include: ['tests/app/**/*.test.tsx'], environment: 'jsdom' },
      },
    ],
  },
});
