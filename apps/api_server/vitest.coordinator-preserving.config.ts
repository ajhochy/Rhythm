import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// Execution still requires actual socket/archive review. Do not run to "collect"
// under a deleting setup or claim that static188 is a runtime PASS.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    globalSetup: ['./vitest.coordinator-preserving.global-setup.ts'],
    setupFiles: ['./vitest.coordinator-preserving.setup.ts'],
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
    include: [
      'src/__tests__/coordinator_coding_execution_proposal.test.ts',
      'src/__tests__/coordinator_goal_approval_resume.test.ts',
      'src/__tests__/coordinator_coding_approval_continuation.test.ts',
      'src/contract/chat_bounded_workflow.contract.test.ts',
      'src/contract/issue_1392_approval_continuation.test.ts',
      'src/security/security_advisories.test.ts',
      'src/__tests__/coordinator_command_journal.test.ts',
    ],
  },
});
