import { defineConfig } from 'vitest/config';

// In-memory core mechanics only; no live/default global setup, teardown/unlink,
// credential env files, SDK launch or existing188 config change.
export default defineConfig({
  envDir: false,
  test: {
    pool: 'threads', maxWorkers: 1, fileParallelism: false,
    include: ['src/__tests__/async_delegation_wake_fence.test.ts',
      'src/__tests__/async_delegation_status.test.ts',
      'src/__tests__/issue_1123_contract.test.ts'],
  },
});
