import { defineConfig } from 'vitest/config';

// Private temporary files and in-memory SQLite only; no runtime or provider.
export default defineConfig({ envDir: false, test: {
  pool: 'threads', maxWorkers: 1, fileParallelism: false,
  include: ['src/__tests__/qualification_fixture_setup.test.ts'],
} });
