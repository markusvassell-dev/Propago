import { defineConfig } from 'vitest/config';

// Unit tests (tests/unit) run anywhere. Integration tests (tests/integration)
// need Postgres + Redis and are gated behind PROPAGO_IT=1 — see tests/setup.ts.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
