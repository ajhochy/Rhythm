import { defineConfig } from 'vitest/config';

// In-memory core mechanics only; no live/default global setup, teardown/unlink,
// credential env files, SDK launch or existing188 config change.
export default defineConfig({
  envDir: false,
  test: {
    pool: 'threads', maxWorkers: 1, fileParallelism: false,
    include: ['src/__tests__/coordinator_coding_execution_proposal.test.ts',
      'src/__tests__/coordinator_coding_deadlines.test.ts',
      'src/__tests__/coordinator_coding_child_terms.test.ts',
      'src/__tests__/coordinator_coding_effort_status.test.ts',
      'src/__tests__/coordinator_coding_terminal_recovery.test.ts',
      'src/__tests__/coordinator_coding_docker_contract.test.ts',
      'src/__tests__/live_coordinator_coding_quickjs.test.ts',
      'src/__tests__/coordinator_coding_snapshot_result.test.ts',
      'src/__tests__/coordinator_coding_delivery_controls.test.ts',
      'src/__tests__/live_coordinator_coding_delivery_recovery.test.ts',
      'src/__tests__/coordinator_coding_grant_journal.test.ts',
      'src/__tests__/async_delegation_wake_fence.test.ts',
      'src/__tests__/async_delegation_status.test.ts',
      'src/__tests__/issue_1123_contract.test.ts'],
  },
});
