import { createHash } from 'node:crypto';
import type { AgentApproval } from '../../repositories/agent_approvals_repository';
import { WORKFLOW_APPROVAL_ACTION } from '../../services/chat_bounded_workflow';
export function codingTerms() {
  const root = '/private/tmp/rhythm-coordinator-repair-sandbox/tmp/task-list';
  const loader = '/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-repair-first-20261009/apps/api_server/node_modules/tsx/dist/loader.mjs';
  const terms = {
    schemaVersion: 1, purpose: 'coordinator_coding_execution_v1', proposalId: 'proposal-unit',
    ownerUserId: 7, sessionId: 'root-unit', projectId: 'project-unit', sdkSessionId: 'ses_root_unit',
    profileId: 'secretary', profileRevision: 5, scopeFingerprint: 'a'.repeat(64), controlRevision: 3,
    goalId: 'goal-unit', goalRevision: 1, objective: 'Add optional open/done filtering without mutation',
    normalizedIntentHash: 'b'.repeat(64),
    workspace: { id: 'workspace-unit', generation: 1, canonicalRoot: root, baseDigest: 'c'.repeat(64),
      readablePaths: ['src/selectTasks.ts', 'tests/selectTasks.test.mjs'],
      writablePaths: ['src/selectTasks.ts', 'tests/selectTasks.test.mjs'] },
    chain: { transport: 'rhythm_delegate_async', manager: { profileId: 'workflow-orchestrator', revision: 8,
      policyFingerprint: 'd'.repeat(64), providerId: 'openai', modelId: 'gpt-6.1-sol', modelVersion: 'unit-version', reasoningEffort: 'xhigh' },
      worker: { profileId: 'coding-agent', revision: 4, policyFingerprint: 'e'.repeat(64),
        providerId: 'openai', modelId: 'gpt-6.1-sol', modelVersion: 'unit-version', reasoningEffort: 'xhigh' } },
    command: { id: 'selectTasks-tests-v1', cwd: root, executable: '/opt/homebrew/bin/node',
      executableDigest: 'f'.repeat(64), loaderDigest: '1'.repeat(64),
      argv: ['--import', loader, '--test', 'tests/selectTasks.test.mjs'], env: {},
      shellCommand: `'/opt/homebrew/bin/node' '--import' '${loader}' '--test' 'tests/selectTasks.test.mjs'` },
    limits: { managerAttempts: 1, workerAttempts: 1, concurrentWorkers: 1, automaticRetries: 0,
      managerCompletionWakes: 1, rootCompletionWakes: 0, taskWallSeconds: 600, workerWallSeconds: 300,
      totalSoftTokens: 30000, includesManagerCompletion: true },
    acceptance: { evaluatorId: 'selectTasks-independent-v1', version: 1, evaluatorDigest: '2'.repeat(64),
      runnerDigest: '3'.repeat(64), writableByWorker: false, capture: 'immutable_allowed_bytes_v1',
      criteria: ['open', 'done', 'omitted', 'empty_no_match', 'order', 'unsupported_status', 'input_preservation'] },
    proposedAt: '2026-10-09T12:00:00.000Z', expiresAt: '2026-10-09T12:15:00.000Z',
  };
  terms.normalizedIntentHash = intentFor(terms);
  return terms;
}

export function intentFor(p: ReturnType<typeof codingTerms>): string {
  // Independent fixture canonicalization; not consent and not a signature.
  const { schemaVersion, purpose, proposalId, controlRevision, normalizedIntentHash, proposedAt, expiresAt, ...intent } = p;
  return createHash('sha256').update(JSON.stringify(intent)).digest('hex');
}

export function approvalFor(p: unknown): AgentApproval {
  const terms = p as ReturnType<typeof codingTerms>;
  return { id: 'approval-unit', sessionId: terms.sessionId, agentConfigId: terms.profileId,
    action: 'Approve bounded coding execution', preview: null, consequence: null, status: 'pending', actor: null,
    decidedAt: null, securityAction: WORKFLOW_APPROVAL_ACTION,
    payloadDigest: createHash('sha256').update(JSON.stringify(p)).digest('hex'), boundPayloadJson: JSON.stringify(p),
    taintId: null, taintedTurnId: null, boundAgent: terms.profileId, expiresAt: terms.expiresAt,
    consumedAt: null, decisionNonce: 'unit-nonce-not-a-signature', createdAt: terms.proposedAt };
}
