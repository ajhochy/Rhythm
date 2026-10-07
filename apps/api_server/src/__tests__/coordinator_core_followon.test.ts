/**
 * Core follow-on: direct goal capture, goal→child outcome projection and
 * freshness, and fresh coordinator/memory context at the ACTUAL completion
 * enqueue. Real SQLite, real AsyncDelegationCompletionService and real
 * CoordinatorConversationService; only the SDK client and memory retrieval are
 * stubs, and the assertions read the SDK request that was actually made.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import type { CoordinatorContextRead } from '../contracts/coordinator_conversation_contract';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';

const { promptAsync, memoryPreface } = vi.hoisted(() => ({
  promptAsync: vi.fn(),
  memoryPreface: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { promptAsync, abortSession: vi.fn() },
  opencodeSessionMap: new Map<string, string>(),
}));
vi.mock('../services/automatic_memory_preface', () => ({
  prepareAutomaticMemoryPreface: memoryPreface,
}));

import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { AsyncDelegationCompletionService } from '../services/async_delegation_completion_service';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import {
  CoordinatorConversationService,
  ordinaryForegroundGoalCandidate,
} from '../services/coordinator_conversation_service';

const OWNER = 7;
const PROJECT = 'project-followon';
const SDK = 'ses_root_followon';
const NOW = new Date('2026-10-06T12:00:00.000Z');
const MEMORY_TEXT = 'SYNTHETIC_MEMORY_PREFACE';
// What onChildIdle records for a child that produced no output message.
const CHILD_RESULT = 'The delegated agent completed without a text result.';
const CONTRACT_MARK = 'completion callback of one Coding Workflow child';

function available<T>(items: T[]): CoordinatorContextRead<T> {
  return {
    availability: 'available', reason: null, complete: true, authoritative: true,
    observedAt: NOW.toISOString(), sourceVersion: 'snapshot-1', items,
  };
}

describe('direct goal capture classifier', () => {
  it('captures direct and polite fix/implement/update/test requests with the exact authored text', () => {
    for (const message of [
      'Fix the login bug',
      'please implement dark mode for the settings page',
      'Update the README with the new flags',
      'Test the importer against the sample export',
      'I need you to fix the flaky scheduler test',
      'Could you implement the retry button?',
      'Can you update the changelog?',
    ]) expect(ordinaryForegroundGoalCandidate(`  ${message}  `)).toBe(message);
  });

  it('captures explicit evidence-first planning requests with exact authored text', () => {
    for (const message of [
      'First read the qualified synthetic Dayflow evidence and current managed memory reference. Then propose, without starting work, a bounded workflow to implement a fixture-only task-summary function.',
      'First, review the selected reference; Then please plan one focused implementation and test.',
      'First inspect the current evidence\nThen prepare a bounded proposal for review.',
    ]) expect(ordinaryForegroundGoalCandidate(`  ${message}  `)).toBe(message);
  });

  it('keeps non-imperative or incomplete evidence-first language as chat', () => {
    for (const message of [
      '"First read the evidence. Then propose a bounded workflow."',
      'The user said first read the evidence. Then propose a bounded workflow.',
      'If you first read the evidence, then propose a bounded workflow.',
      'First read the evidence. Then propose a bounded workflow?',
      'First read the evidence. Then summarize the current status.',
      'First read the evidence and tell me what is happening.',
      'Firstread the evidence. Then propose a bounded workflow.',
    ]) expect(ordinaryForegroundGoalCandidate(message)).toBeNull();
  });

  it('keeps questions, status requests, explanations and greetings as chat', () => {
    for (const message of [
      'How do I fix the login bug?',
      'Why does the test fail?',
      'Did you fix it?',
      'update me on the status',
      "what's the status",
      'Thanks',
      'What needs my attention',
      'The tests are green',
    ]) expect(ordinaryForegroundGoalCandidate(message)).toBeNull();
  });
});

describe('goal outcomes and callback context', () => {
  let access: { value: boolean };
  let assembleCalls: number;
  let onAssemble: ((call: number) => void) | null;
  let repository: CoordinatorConversationsRepository;
  let service: CoordinatorConversationService;
  let completion: AsyncDelegationCompletionService;
  let goalId: string;

  function session(id: string, over: Record<string, unknown> = {}): void {
    new AgentSessionsRepository().insert({
      agentKind: 'librarian', taskId: null, cwd: '/tmp', name: id, profileId: 'librarian',
    } as never);
    const created = getDb().prepare('SELECT id FROM agent_sessions ORDER BY rowid DESC LIMIT 1').get() as { id: string };
    getDb().prepare('UPDATE agent_sessions SET id=? WHERE id=?').run(id, created.id);
    getDb().prepare(`UPDATE agent_sessions SET owner_user_id=?, project_id=?, status='idle' WHERE id=?`)
      .run(OWNER, PROJECT, id);
    for (const [column, value] of Object.entries(over)) {
      getDb().prepare(`UPDATE agent_sessions SET ${column}=? WHERE id=?`).run(value, id);
    }
  }

  function delegation(id: string, child: string, over: { status?: string; target?: string; parent?: string; error?: string | null } = {}): void {
    getDb().prepare(`INSERT INTO agent_async_delegations
      (id, parent_session_id, child_session_id, target_agent_config_id, status, completion_text, error_text,
       completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, over.parent ?? 'root', child, over.target ?? 'workflow-orchestrator', over.status ?? 'dispatched',
      over.status && over.status !== 'dispatched' ? 'child result' : null, over.error ?? null,
      over.status && over.status !== 'dispatched' ? NOW.toISOString() : null, NOW.toISOString(), NOW.toISOString(),
    );
  }

  const scopeOf = () => ({ ownerUserId: OWNER, projectId: PROJECT, sessionId: 'root' });

  beforeEach(() => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.pragma('foreign_keys = OFF');
    setDb(db);
    promptAsync.mockReset().mockResolvedValue(true);
    memoryPreface.mockReset().mockResolvedValue({ text: MEMORY_TEXT });
    db.prepare(`INSERT OR IGNORE INTO agent_configs (id, label, icon, command, enabled, is_agent)
      VALUES ('librarian', 'Synthetic profile', 'x', 'synthetic', 1, 1)`).run();
    access = { value: true };
    assembleCalls = 0;
    onAssemble = null;
    session('root', { sdk_session_id: SDK, permission_mode: 'plan', model_mode: 'auto' });
    repository = new CoordinatorConversationsRepository(db, () => NOW);
    expect(repository.designatePrimaryOwnerRoot(scopeOf()).kind).toBe('found');
    const goal = repository.addGoal({
      ...scopeOf(), expectedControlRevision: 1, commandKey: 'goal-1', objective: 'Fix the login bug',
    });
    expect(goal.kind).toBe('created');
    goalId = (goal as { goal: { id: string } }).goal.id;
    expect(repository.reserveGoalDelegation({
      ...scopeOf(), expectedControlRevision: 2, commandKey: 'delegate-1', goalId, parentSdkSessionId: SDK,
    }).kind).toBe('reserved');
    session('child-1', { parent_session_id: 'root' });
    delegation('dg-1', 'child-1');
    expect(repository.settleGoalDelegation({
      ...scopeOf(), expectedControlRevision: 3, commandKey: 'delegate-1', goalId,
      outcome: 'dispatched', delegationId: 'dg-1', childSessionId: 'child-1',
    }).kind).toBe('dispatched');

    const assembler = new CoordinatorConversationContextAssembler({
      tasks: { read: async () => available([]) },
      schedules: { read: async () => available([]) },
      rhythms: { read: async () => available([]) },
      workstreams: { read: async () => available([]) },
      receipts: { read: async () => available([]) },
    });
    const profile = {
      id: 'librarian', enabled: true, isAgent: true, locked: false, modelProvider: 'provider', modelId: 'model', revision: 1,
    };
    service = new CoordinatorConversationService({
      repository,
      context: {
        assemble: async (input: Parameters<typeof assembler.assemble>[0]) => {
          assembleCalls += 1;
          onAssemble?.(assembleCalls);
          return assembler.assemble(input);
        },
      } as never,
      sessions: new AgentSessionsRepository(),
      configs: { getById: () => profile, listEnabled: () => [profile] } as never,
      projects: { findById: () => ({ id: PROJECT, archivedAt: null }) } as never,
      projectAccess: { canAccess: () => access.value, canOwnerAccess: () => access.value },
      enabled: () => true,
    } as never);
    completion = new AsyncDelegationCompletionService();
    completion.setCoordinatorCallbackContext({ prepare: (input) => service.prepareCallbackContext(input) });
  });

  describe('bounded goal → child outcome', () => {
    const outcome = () => repository.listGoalDelegationOutcomes(scopeOf())[0];

    it('keeps dispatched, returned-unverified, failed and cancelled distinct', () => {
      expect(outcome()).toMatchObject({ goalId, delegationId: 'dg-1', childSessionId: 'child-1', outcome: 'running' });
      for (const [status, error, expected] of [
        ['completed', null, 'returned_result_unverified'],
        ['notified', null, 'returned_result_unverified'],
        ['completed', 'boom', 'failed'],
        ['failed', 'boom', 'failed'],
        ['cancelled', null, 'cancelled'],
      ] as const) {
        getDb().prepare('UPDATE agent_async_delegations SET status=?, error_text=? WHERE id=?').run(status, error, 'dg-1');
        expect(outcome().outcome).toBe(expected);
      }
      expect(JSON.stringify(repository.listGoalDelegationOutcomes(scopeOf()))).not.toContain('child result');
    });

    it('reports unknown, never success, for foreign, stale or rebound links', () => {
      getDb().prepare(`UPDATE agent_async_delegations SET status='completed' WHERE id='dg-1'`).run();
      const cases: Array<[string, string, unknown[]]> = [
        ['foreign delegation parent', 'UPDATE agent_async_delegations SET parent_session_id=? WHERE id=?', ['someone-else', 'dg-1']],
        ['wrong target profile', 'UPDATE agent_async_delegations SET target_agent_config_id=? WHERE id=?', ['librarian', 'dg-1']],
        ['child owner changed', 'UPDATE agent_sessions SET owner_user_id=? WHERE id=?', [99, 'child-1']],
        ['child project changed', 'UPDATE agent_sessions SET project_id=? WHERE id=?', ['elsewhere', 'child-1']],
        ['child reparented', 'UPDATE agent_sessions SET parent_session_id=? WHERE id=?', ['other-root', 'child-1']],
        ['root SDK rebound', 'UPDATE agent_sessions SET sdk_session_id=? WHERE id=?', ['ses_other', 'root']],
        ['root archived', 'UPDATE agent_sessions SET archived_at=? WHERE id=?', ['2026-10-06', 'root']],
      ];
      for (const [label, sql, args] of cases) {
        const restore = getDb().prepare('SELECT * FROM agent_sessions WHERE id IN (?, ?)').all('root', 'child-1');
        const delegationRow = getDb().prepare('SELECT * FROM agent_async_delegations WHERE id=?').get('dg-1') as Record<string, unknown>;
        getDb().prepare(sql).run(...args);
        expect(outcome().outcome, label).toBe('unknown');
        for (const row of restore as Array<Record<string, unknown>>) {
          getDb().prepare('UPDATE agent_sessions SET owner_user_id=?, project_id=?, parent_session_id=?, sdk_session_id=?, archived_at=? WHERE id=?')
            .run(row.owner_user_id, row.project_id, row.parent_session_id, row.sdk_session_id, row.archived_at, row.id);
        }
        getDb().prepare('UPDATE agent_async_delegations SET parent_session_id=?, target_agent_config_id=? WHERE id=?')
          .run(delegationRow.parent_session_id, delegationRow.target_agent_config_id, 'dg-1');
      }
      expect(outcome().outcome).toBe('returned_result_unverified');
    });

    it('changes the freshness fingerprint on an outcome change with controlRevision unchanged', () => {
      const fingerprint = (): string => {
        const conversation = repository.get(scopeOf());
        if (conversation.kind !== 'found') throw new Error('missing');
        return (service as unknown as { foregroundUnqualifiedFingerprint(c: unknown): string })
          .foregroundUnqualifiedFingerprint(conversation.conversation);
      };
      const before = fingerprint();
      const revision = (repository.get(scopeOf()) as { conversation: { controlRevision: number } }).conversation.controlRevision;
      getDb().prepare(`UPDATE agent_async_delegations SET status='failed', error_text='boom' WHERE id='dg-1'`).run();
      expect(fingerprint()).not.toBe(before);
      expect((repository.get(scopeOf()) as { conversation: { controlRevision: number } }).conversation.controlRevision).toBe(revision);
    });
  });

  describe('actual completion enqueue', () => {
    async function wake(): Promise<{ system: string; meta: Record<string, unknown>; text: string }> {
      await completion.onChildIdle('child-1');
      expect(promptAsync).toHaveBeenCalledTimes(1);
      const call = promptAsync.mock.calls[0];
      return {
        text: String(call[1]),
        system: String((call[4] as { system?: string }).system ?? ''),
        meta: call[7] as Record<string, unknown>,
      };
    }

    it('sends fresh bounded coordinator contract and memory with the status-only callback marker', async () => {
      const sent = await wake();
      expect(sent.system).toContain(CONTRACT_MARK);
      expect(sent.system).toContain('status-only');
      expect(sent.system).toContain(MEMORY_TEXT);
      expect(sent.system).toContain('Current bounded coordinator snapshot');
      expect(sent.meta).toMatchObject({
        origin: 'delegation_completion', routeAuthed: null, reasonCode: 'c2_goal_callback:dg-1',
      });
      expect(memoryPreface).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'root', ownerUserId: OWNER }));
      // The completion body travels only in the wake text, never the overlay.
      expect(sent.system).not.toContain(CHILD_RESULT);
      expect(sent.text).toContain(CHILD_RESULT);
      // Not a foreground reservation or user-authored command.
      const conversation = repository.get(scopeOf()) as { conversation: { commandDedupe: Array<{ kind: string }> } };
      expect(conversation.conversation.commandDedupe.map((command) => command.kind)).toEqual(['add_goal', 'delegate_goal']);
    });

    it('withholds the overlay when access is revoked during preparation', async () => {
      onAssemble = (call) => { if (call === 1) access.value = false; };
      const sent = await wake();
      expect(sent.system).not.toContain(CONTRACT_MARK);
      expect(sent.system).not.toContain(MEMORY_TEXT);
      expect(memoryPreface).not.toHaveBeenCalled();
      expect(sent.text).toContain(CHILD_RESULT);
    });

    it('withholds the overlay when scope changes after memory preparation, directly before enqueue', async () => {
      onAssemble = (call) => {
        if (call === 2) getDb().prepare(`UPDATE agent_sessions SET archived_at='2026-10-06' WHERE id='root'`).run();
      };
      const sent = await wake();
      expect(memoryPreface).toHaveBeenCalledTimes(1);
      expect(sent.system).not.toContain(CONTRACT_MARK);
      expect(sent.system).not.toContain(MEMORY_TEXT);
    });

    it('withholds the overlay when the root SDK binding changes during preparation', async () => {
      onAssemble = (call) => {
        if (call === 1) getDb().prepare(`UPDATE agent_sessions SET sdk_session_id='ses_rebound' WHERE id='root'`).run();
      };
      const sent = await wake();
      expect(sent.system).not.toContain(CONTRACT_MARK);
    });

    it('gives a mixed completion batch no coordinator context or callback marker', async () => {
      session('child-2', { parent_session_id: 'root' });
      delegation('dg-2', 'child-2', { status: 'completed', target: 'librarian' });
      const sent = await wake();
      expect(sent.system).not.toContain(CONTRACT_MARK);
      expect(sent.system).not.toContain(MEMORY_TEXT);
      expect(sent.meta.reasonCode).toBeUndefined();
      expect(assembleCalls).toBe(0);
    });
  });
});
