import { describe, expect, it } from 'vitest';
import { parseStoredCoordinatorConversation } from '../contracts/coordinator_conversation_contract';

// Real canonical keys cross this saved-authority boundary; S5 used `canon-1`.
const stored = (canonicalId: unknown) => ({
  schemaVersion: 4, id: 'conversation-1', sessionId: 'root-1', ownerUserId: 1,
  projectId: 'project-1', controlRevision: 3, primaryOwnerRoot: true,
  createdAt: '2026-10-06T15:00:00.000Z', updatedAt: '2026-10-06T15:00:01.000Z',
  goals: [{ id: 'goal-1', commandKey: 'goal-key', intentHash: 'a'.repeat(64), objective: 'Review the note.',
    state: 'linked', linkedWorkstreamId: 'workstream-1', revision: 2, createdAt: '2026-10-06T15:00:00.000Z' }],
  commandDedupe: [{ key: 'goal-key', intentHash: 'a'.repeat(64), kind: 'add_goal', goalId: 'goal-1', messageId: null }],
  continuations: [{
    schemaVersion: 6, authorizationId: 'admission-1', authorizationCommandKey: 'admission-1', goalId: 'goal-1',
    projectId: 'project-1', workstreamId: 'workstream-1', goalRevision: 2, parentSessionId: 'root-1',
    profileId: 'secretary', profileRevision: 1, workstreamRevision: 1, issuedFromControlRevision: 3,
    issuedAt: '2026-10-06T15:00:01.000Z', expiresAt: '2026-10-06T15:10:01.000Z',
    requestedModel: { providerId: 'test', modelId: 'test-model', mode: 'fixed' },
    permissionAuthority: {
      schemaVersion: 2,
      parent: { sessionId: 'root-1', permissionMode: 'plan', approvalBypassExplicit: false },
      worker: { parentSessionId: 'root-1', permissionMode: 'default', managedReadOnly: false },
      workflow: { parentSessionId: 'root-1', permissionMode: 'plan', approvalBypassExplicit: false, targetAgentConfigId: 'workflow-orchestrator' },
    },
    maxTurns: 2, consumedTurns: 0, totalTokenAuthorization: 8192, maxWallTimeSeconds: 300,
    acknowledgement: { schemaVersion: 1, actorUserId: 1, acknowledgedAt: '2026-10-06T15:00:01.000Z', kind: 'soft_total_tokens',
      includes: ['input', 'output', 'reasoning', 'cache'], outputCapEnforced: false },
    purpose: 'workflow', executionScope: null,
    workflow: { schemaVersion: 1, kind: 'coding_workflow', targetAgentConfigId: 'workflow-orchestrator', check: {
      kind: 'selected_reference_summary_v1', sourceId: 'memory:12345678-1234-4234-8234-123456789abc',
      expectedVersion: 'sha256:' + 'b'.repeat(64), canonicalId, observedVersion: 'sha256:' + 'b'.repeat(64),
      observedHash: 'b'.repeat(64), sourceNamespace: 'memory-vault', sourceInstance: 'c'.repeat(64),
    } }, dayflowDependency: null, status: 'authorized',
  }],
});

describe('saved Coding Workflow authority accepts real canonical memory keys', () => {
  it.each(['memory/fact/g2-synthetic.md', 'fact/g2-synthetic.md', 'fact/Owner and deadline.md', 'fact/確認.md', 'canon-1'])(
    'round-trips the server-resolved key %s', canonicalId => {
      const parsed = parseStoredCoordinatorConversation(stored(canonicalId));
      expect(parsed.continuations[0].workflow?.check.canonicalId).toBe(canonicalId);
    },
  );
  it.each(['/memory/fact/a.md', '../fact/a.md', 'memory/../a.md', 'fact/./a.md', 'fact//a.md', 'fact/a.md/',
    'C:/fact/a.md', 'fact\\a.md', 'fact/a\nb.md', 'fact/a\0b.md', 'fact/' + 'a'.repeat(1024) + '.md', '', null])(
    'holds malformed canonical key %j', canonicalId => {
      expect(() => parseStoredCoordinatorConversation(stored(canonicalId))).toThrow('workflow check');
    },
  );
  it('keeps the source selector separate from the canonical vault key', () => {
    const record = stored('memory/fact/g2-synthetic.md');
    record.continuations[0].workflow.check.sourceId = 'memory/fact/g2-synthetic.md';
    expect(() => parseStoredCoordinatorConversation(record)).toThrow('workflow check');
  });
});
