/**
 * #1156 — Delegated subagent/child sessions hang on their first
 * non-allowlisted tool call.
 *
 * Root cause: a delegated child row is created via `upsertChildSession` with
 * `permission_mode` left NULL (-> 'default'). The gate in
 * `OpencodeStreamBridge._relayEvent` ('permission.asked' / 'permission.updated'
 * case) only auto-accepts on 'bypassPermissions' / 'acceptEdits', so a
 * headless delegated child's ask is forwarded to a UI that does not exist for
 * it — the write blocks forever and the tool never runs.
 *
 * Fix: treat a session as "headless" when it has a non-null
 * `parentSessionId` (delegated child — the sole writer of that column is
 * `upsertChildSession`) or when no local row resolves at all (create-vs-
 * permission race). Headless sessions auto-accept, UNLESS the pre-existing
 * hardline blocklist deny or plan-mode auto-deny already fired.
 *
 * Harness pattern copied from `issue_736_contract.test.ts`: real in-memory
 * SQLite rows via `AgentSessionsRepository`, fake only the true boundaries
 * (`broadcast` WS sink + `opencodeClient` SDK), drive events through the
 * bridge's real `_relayEvent`.
 *
 * Criteria:
 *   c1 — delegated child (parentSessionId set, permission_mode NULL) auto-accepts.
 *   c2 — no local row resolves (race) → auto-accepts.
 *   c3 — hardline-blocklisted bash command on a child → still denied.
 *   c4 — child explicitly in plan mode → still auto-denied.
 *   c5 — interactive session (parentSessionId NULL, permission_mode 'default')
 *        → NO auto-response; ask is still forwarded/pending (regression guard).
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

const {
  broadcastSpy,
  broadcastSessionUpdatedSpy,
  respondPermissionSpy,
  replyToPermissionSpy,
  sessionMap,
} = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  broadcastSessionUpdatedSpy: vi.fn(),
  respondPermissionSpy: vi.fn().mockResolvedValue(true),
  replyToPermissionSpy: vi.fn().mockResolvedValue(true),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: broadcastSpy,
  broadcastSessionUpdated: broadcastSessionUpdatedSpy,
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    respondPermission: respondPermissionSpy,
    replyToPermission: replyToPermissionSpy,
    listQuestions: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/skill_extractor', () => ({
  queueSkillExtraction: vi.fn(),
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const PARENT_SDK_SESSION_ID = 'sdk-session-1156-parent';
const CHILD_SDK_SESSION_ID = 'sdk-session-1156-child';
const NO_ROW_SDK_SESSION_ID = 'sdk-session-1156-no-row';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Build a permission.asked event (the pre-execution gate opencode emits). */
function permissionEvent(
  sdkSessionId: string,
  toolName: string,
  permissionId: string,
  args: Record<string, unknown> = {},
) {
  return {
    type: 'permission.asked',
    properties: {
      permissionID: permissionId,
      sessionID: sdkSessionId,
      toolName,
      summary: `run ${toolName}`,
      args,
    },
  };
}

function acceptCalls() {
  return replyToPermissionSpy.mock.calls.filter((c) => c[1] === 'once');
}

function rejectCalls() {
  return replyToPermissionSpy.mock.calls.filter((c) => c[1] === 'reject');
}

function resolvedFrames(decision: 'accept' | 'deny') {
  return broadcastSpy.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((f) => f.type === 'permission.resolved' && f.decision === decision);
}

function pendingAskFrames() {
  return broadcastSpy.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((f) => f.type === 'permission.asked');
}

describe('#1156 — delegated subagent permission gate', () => {
  let bridge: OpencodeStreamBridge;
  let repo: AgentSessionsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSessionsRepository();
    sessionMap.clear();
    broadcastSpy.mockClear();
    broadcastSessionUpdatedSpy.mockClear();
    respondPermissionSpy.mockClear();
    replyToPermissionSpy.mockClear();
    bridge = new OpencodeStreamBridge();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function relay(event: unknown) {
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
  }

  // c1 — delegated child auto-accepts a non-allowlisted, non-blocklisted tool.
  it('c1: a delegated child session (parentSessionId set) auto-accepts', () => {
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp/work',
      name: 'parent session',
      projectId: null,
    });
    repo.setSdkSessionId(parent.id, PARENT_SDK_SESSION_ID);
    sessionMap.set(parent.id, PARENT_SDK_SESSION_ID);

    const child = repo.upsertChildSession(
      CHILD_SDK_SESSION_ID,
      PARENT_SDK_SESSION_ID,
      'delegated task (@specialist subagent)',
      '/tmp/work',
    );
    expect(child).not.toBeNull();
    expect(child?.parentSessionId).toBe(parent.id);
    sessionMap.set(child!.id, CHILD_SDK_SESSION_ID);

    relay(permissionEvent(CHILD_SDK_SESSION_ID, 'glob', 'perm-c1'));

    expect(acceptCalls().length).toBe(1);
    expect(replyToPermissionSpy).toHaveBeenCalledWith(
      'perm-c1',
      'once',
      undefined,
      expect.anything(),
      CHILD_SDK_SESSION_ID,
    );
    expect(rejectCalls().length).toBe(0);
    expect(resolvedFrames('accept').length).toBe(1);
    expect(pendingAskFrames().length).toBe(0);
  });

  // c2 — event whose SDK session id maps to no local row (create-vs-permission
  // race) auto-accepts rather than hanging with no UI to answer it.
  it('c2: no resolvable local row (race) auto-accepts', () => {
    // Deliberately no session row and no sessionMap entry for this SDK id —
    // _relayEvent's own localSessionId resolution (reverse map / durable
    // fallback) will fail to resolve a local id... but the gate requires a
    // localSessionId to proceed at all (permissionId && localSessionId
    // guard). To exercise "row exists in the map but not in the DB" (the
    // actual race — upsertChildSession hasn't landed yet when the ask
    // arrives), map a synthetic local id with no backing row.
    const orphanLocalId = 'orphan-local-id-not-in-db';
    sessionMap.set(orphanLocalId, NO_ROW_SDK_SESSION_ID);

    relay(permissionEvent(NO_ROW_SDK_SESSION_ID, 'grep', 'perm-c2'));

    expect(acceptCalls().length).toBe(1);
    expect(rejectCalls().length).toBe(0);
    expect(pendingAskFrames().length).toBe(0);
  });

  // c3 — hardline blocklist deny still wins on a delegated child.
  it('c3: a hardline-blocklisted bash command on a child is still denied', () => {
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp/work',
      name: 'parent session',
      projectId: null,
    });
    repo.setSdkSessionId(parent.id, PARENT_SDK_SESSION_ID);
    sessionMap.set(parent.id, PARENT_SDK_SESSION_ID);

    const child = repo.upsertChildSession(
      CHILD_SDK_SESSION_ID,
      PARENT_SDK_SESSION_ID,
      'delegated task (@specialist subagent)',
      '/tmp/work',
    );
    expect(child).not.toBeNull();
    sessionMap.set(child!.id, CHILD_SDK_SESSION_ID);

    relay(
      permissionEvent(CHILD_SDK_SESSION_ID, 'bash', 'perm-c3', {
        command: 'rm -rf /',
      }),
    );

    expect(acceptCalls().length).toBe(0);
    expect(rejectCalls().length).toBe(1);
    expect(resolvedFrames('deny').length).toBe(1);
  });

  // c4 — plan-mode auto-deny still wins on a delegated child.
  it('c4: a child session explicitly in plan mode still auto-denies', () => {
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp/work',
      name: 'parent session',
      projectId: null,
    });
    repo.setSdkSessionId(parent.id, PARENT_SDK_SESSION_ID);
    sessionMap.set(parent.id, PARENT_SDK_SESSION_ID);

    const child = repo.upsertChildSession(
      CHILD_SDK_SESSION_ID,
      PARENT_SDK_SESSION_ID,
      'delegated task (@specialist subagent)',
      '/tmp/work',
    );
    expect(child).not.toBeNull();
    repo.updatePermissionMode(child!.id, 'plan');
    sessionMap.set(child!.id, CHILD_SDK_SESSION_ID);

    relay(permissionEvent(CHILD_SDK_SESSION_ID, 'glob', 'perm-c4'));

    expect(acceptCalls().length).toBe(0);
    expect(rejectCalls().length).toBe(1);
    expect(replyToPermissionSpy).toHaveBeenCalledWith(
      'perm-c4',
      'reject',
      expect.stringContaining('plan mode'),
      expect.anything(),
      CHILD_SDK_SESSION_ID,
    );
    expect(resolvedFrames('deny').length).toBe(1);
  });

  // c5 — SECURITY REGRESSION GUARD: an interactive session (no parent, default
  // mode) must NOT be swept up by the new headless heuristic. Ask stays
  // pending/forwarded exactly as before this fix.
  it('c5: an interactive default session (no parent) still forwards the ask — no auto-response', () => {
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp/work',
      name: 'interactive session',
      projectId: null,
    });
    expect(session.parentSessionId).toBeNull();
    expect(session.permissionMode).toBe('default');
    sessionMap.set(session.id, PARENT_SDK_SESSION_ID);

    relay(permissionEvent(PARENT_SDK_SESSION_ID, 'glob', 'perm-c5'));

    expect(acceptCalls().length).toBe(0);
    expect(rejectCalls().length).toBe(0);
    expect(replyToPermissionSpy).not.toHaveBeenCalled();
    expect(pendingAskFrames().length).toBe(1);
  });
});
