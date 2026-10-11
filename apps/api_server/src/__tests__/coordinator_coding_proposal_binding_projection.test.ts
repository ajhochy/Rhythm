/**
 * Regression guard for the coding-execution proposal hold.
 *
 * CoordinatorCodingExecutionService.resolveProposal receives the runtime
 * foreground binding, which carries seven fields — the five session-scope
 * fields plus `kind` and `sdkUserMessageId`. The closed proposal schema is
 * exact-key, so spreading that binding into the proposal object added
 * `cwd`, `kind` and `sdkUserMessageId` and made EVERY proposal unparseable:
 * the live symptom was a generic "proposal is held" with no approval card,
 * manager, worker or edit ever following.
 *
 * TypeScript cannot catch this — the binding's declared parameter type is
 * narrower than the object actually passed at runtime, and excess runtime
 * keys are invisible to the compiler. So the guard has to be a runtime one.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  codingExecutionIntentHash,
  parseCodingExecutionProposal,
} from '../contracts/coordinator_coding_execution_contract';
import type { CoordinatorForegroundMcpDispatchBinding } from '../repositories/coordinator_conversations_repository';

const DIGEST = 'a'.repeat(64);
const ROOT = '/private/tmp/coordinator-coding-proposal-projection';
const EXECUTABLE = '/usr/local/bin/node';
const LOADER = `${ROOT}/node_modules/tsx/dist/loader.mjs`;
const ARGV = ['--import', LOADER, '--test', 'tests/selectTasks.test.mjs'];
const quote = (part: string) => `'${part.replace(/'/g, "'\"'\"'")}'`;
const profile = (profileId: string) => ({
  profileId, revision: 1, policyFingerprint: DIGEST,
  providerId: 'openai', modelId: 'model', modelVersion: 'model', reasoningEffort: 'high',
});

/** The exact runtime shape findForegroundMcpDispatch returns. */
const binding: CoordinatorForegroundMcpDispatchBinding = {
  ownerUserId: 1, sessionId: 'session-1', projectId: 'project-1', sdkSessionId: 'sdk-1',
  cwd: ROOT, kind: 'foreground', sdkUserMessageId: 'message-1',
};

function proposal(identifiers: Record<string, unknown>) {
  const proposedAt = new Date('2026-10-11T00:00:00.000Z').toISOString();
  const value: Record<string, unknown> = {
    schemaVersion: 1, purpose: 'coordinator_coding_execution_v1', proposalId: 'proposal-1',
    ownerUserId: 1, ...identifiers,
    profileId: 'profile-1', profileRevision: 1, scopeFingerprint: DIGEST,
    controlRevision: 1, goalId: 'goal-1', goalRevision: 1, objective: 'objective',
    normalizedIntentHash: '',
    workspace: {
      id: 'project-1', generation: 1, canonicalRoot: ROOT, baseDigest: DIGEST,
      readablePaths: ['src/selectTasks.ts', 'tests/selectTasks.test.mjs', 'package.json', 'tsconfig.json'],
      writablePaths: ['src/selectTasks.ts', 'tests/selectTasks.test.mjs'],
    },
    chain: {
      transport: 'rhythm_delegate_async',
      manager: profile('workflow-orchestrator'), worker: profile('coding-agent'),
    },
    command: {
      id: 'selectTasks-tests-v1', cwd: ROOT, executable: EXECUTABLE,
      executableDigest: DIGEST, loaderDigest: DIGEST, argv: ARGV, env: {},
      shellCommand: [EXECUTABLE, ...ARGV].map(quote).join(' '),
    },
    limits: {
      managerAttempts: 1, workerAttempts: 1, concurrentWorkers: 1, automaticRetries: 0,
      managerCompletionWakes: 1, rootCompletionWakes: 0, taskWallSeconds: 600,
      workerWallSeconds: 300, totalSoftTokens: 75_000, includesManagerCompletion: true,
    },
    acceptance: {
      evaluatorId: 'selectTasks-independent-v1', version: 1, evaluatorDigest: DIGEST,
      runnerDigest: DIGEST, writableByWorker: false, capture: 'immutable_allowed_bytes_v1',
      criteria: ['open', 'done', 'omitted', 'empty_no_match', 'order', 'unsupported_status', 'input_preservation'],
    },
    proposedAt, expiresAt: new Date(Date.parse(proposedAt) + 900_000).toISOString(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value.normalizedIntentHash = codingExecutionIntentHash(value as any);
  return value;
}

describe('coordinator coding proposal binding projection', () => {
  it('accepts a proposal that projects only the three permitted session identifiers', () => {
    const projected = proposal({
      sessionId: binding.sessionId, projectId: binding.projectId, sdkSessionId: binding.sdkSessionId,
    });
    expect(Object.keys(projected)).toHaveLength(22);
    expect(parseCodingExecutionProposal(projected)).not.toBeNull();
  });

  it('rejects a proposal built by spreading the whole foreground binding', () => {
    const spread = proposal({ ...binding } as unknown as Record<string, unknown>);
    expect(Object.keys(spread)).toEqual(expect.arrayContaining(['cwd', 'kind', 'sdkUserMessageId']));
    expect(parseCodingExecutionProposal(spread)).toBeNull();
  });

  it.each(['cwd', 'kind', 'sdkUserMessageId'] as const)(
    'rejects a proposal carrying the extra binding field %s',
    (field) => {
      const projected = proposal({
        sessionId: binding.sessionId, projectId: binding.projectId, sdkSessionId: binding.sdkSessionId,
      });
      expect(parseCodingExecutionProposal({ ...projected, [field]: binding[field] })).toBeNull();
    },
  );

  it('pins the exact key set the construction site must emit', () => {
    const projected = proposal({
      sessionId: binding.sessionId, projectId: binding.projectId, sdkSessionId: binding.sdkSessionId,
    });
    expect(createHash('sha256').update(Object.keys(projected).sort().join(',')).digest('hex'))
      .toBe(createHash('sha256').update([
        'acceptance', 'chain', 'command', 'controlRevision', 'expiresAt', 'goalId', 'goalRevision',
        'limits', 'normalizedIntentHash', 'objective', 'ownerUserId', 'profileId', 'profileRevision',
        'projectId', 'proposalId', 'proposedAt', 'purpose', 'schemaVersion', 'scopeFingerprint',
        'sdkSessionId', 'sessionId', 'workspace',
      ].join(',')).digest('hex'));
  });
});
