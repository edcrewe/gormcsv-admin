import { defineConfig } from 'vitest/config';

// Node-side API tests. Angular component specs (*.spec.ts) run separately via `ng test`.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/api/**/*.test.ts'],
  },
});
