import { defineConfig } from 'vitest/config';

// Narrow CAS qualification: no global cleanup or filesystem substitutions.
// This suite owns in-memory SQLite and requires the launcher's clean envelope.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/coordinator_coding_grant_journal.test.ts'],
    pool: 'threads',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
