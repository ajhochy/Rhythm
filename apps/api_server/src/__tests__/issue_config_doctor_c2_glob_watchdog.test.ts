/**
 * Config Doctor track C, C2 — `glob` has no timeout of its own in the
 * engine. A hung call (pathological search root, symlink loop, network
 * volume) previously consumed the ENTIRE 600s run inactivity window before
 * the run aborted, with no diagnostic naming the actual culprit tool
 * (daily-dev-summary task d324b36d-483a-4919-8e44-e895a0067188, 2026-08-01).
 *
 * Fix: OpencodeStreamBridge arms a short per-session watchdog right after
 * auto-accepting a `glob` permission. ANY subsequent event for that session
 * (any type — the tool finished, or a new one started) cancels it. If
 * nothing happens before the bound, the bridge force-aborts just that
 * session with a diagnostic naming `glob`.
 *
 * Harness pattern copied from issue_1156_delegated_permission_gate.test.ts:
 * real in-memory SQLite rows via AgentSessionsRepository, fake only the true
 * boundaries (`broadcast` WS sink + `opencodeClient` SDK), drive events
 * through the bridge's real `_relayEvent`.
 *
 * Criteria:
 *   c1 — auto-accepted glob with no further event fires the watchdog:
 *        abortSession called, session marked 'error' with a diagnostic
 *        naming glob, an error frame broadcast.
 *   c2 — any subsequent event (even unrelated) for the same session cancels
 *        the watchdog before it fires — no abort.
 *   c3 — a non-glob tool (e.g. grep) never arms a watchdog at all.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

const {
  broadcastSpy,
  broadcastSessionUpdatedSpy,
  replyToPermissionSpy,
  abortSessionSpy,
  sessionMap,
} = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  broadcastSessionUpdatedSpy: vi.fn(),
  replyToPermissionSpy: vi.fn().mockResolvedValue(true),
  abortSessionSpy: vi.fn().mockResolvedValue(true),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: broadcastSpy,
  broadcastSessionUpdated: broadcastSessionUpdatedSpy,
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    replyToPermission: replyToPermissionSpy,
    abortSession: abortSessionSpy,
    listQuestions: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/skill_extractor', () => ({
  queueSkillExtraction: vi.fn(),
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const SDK_SESSION_ID = 'sdk-session-c2-glob';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function permissionEvent(toolName: string, permissionId: string) {
  return {
    type: 'permission.asked',
    properties: {
      permissionID: permissionId,
      sessionID: SDK_SESSION_ID,
      toolName,
      summary: `run ${toolName}`,
      args: {},
    },
  };
}

function messagePartEvent() {
  return {
    type: 'message.part.updated',
    properties: {
      part: { sessionID: SDK_SESSION_ID, id: 'part-1', messageID: 'msg-1', type: 'text', text: 'x' },
    },
  };
}

describe('config-doctor C2 — glob per-call watchdog', () => {
  let bridge: OpencodeStreamBridge;
  let repo: AgentSessionsRepository;
  let sessionId: string;

  beforeEach(() => {
    vi.useFakeTimers();
    setDb(makeDb());
    repo = new AgentSessionsRepository();
    sessionMap.clear();
    broadcastSpy.mockClear();
    broadcastSessionUpdatedSpy.mockClear();
    replyToPermissionSpy.mockClear();
    abortSessionSpy.mockClear();
    process.env.AGENT_GLOB_TOOL_TIMEOUT_MS = '5000';

    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp/work',
      name: 'headless session',
      projectId: null,
    });
    repo.updatePermissionMode(session.id, 'bypassPermissions');
    sessionId = session.id;
    sessionMap.set(session.id, SDK_SESSION_ID);

    bridge = new OpencodeStreamBridge();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AGENT_GLOB_TOOL_TIMEOUT_MS;
    vi.clearAllMocks();
  });

  function relay(event: unknown) {
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
  }

  it('c1: a hung glob call is aborted with a diagnostic once the timeout elapses', async () => {
    relay(permissionEvent('glob', 'perm-glob-1'));
    expect(replyToPermissionSpy).toHaveBeenCalledWith(
      'perm-glob-1',
      'once',
      undefined,
      expect.anything(),
      SDK_SESSION_ID,
    );

    await vi.advanceTimersByTimeAsync(5001);

    expect(abortSessionSpy).toHaveBeenCalledWith(SDK_SESSION_ID, '/tmp/work');
    const row = repo.findById(sessionId);
    expect(row?.status).toBe('error');
    expect(row?.lastPreview ?? '').toMatch(/glob/i);
    const errorFrames = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((f) => f.type === 'error');
    expect(errorFrames.length).toBe(1);
    expect(String(errorFrames[0]!.message)).toMatch(/glob/i);
  });

  it('c2: any subsequent event cancels the watchdog before it fires', async () => {
    relay(permissionEvent('glob', 'perm-glob-2'));
    await vi.advanceTimersByTimeAsync(2000);
    relay(messagePartEvent());
    await vi.advanceTimersByTimeAsync(5001);

    expect(abortSessionSpy).not.toHaveBeenCalled();
    const row = repo.findById(sessionId);
    expect(row?.status).not.toBe('error');
  });

  it('c3: a non-glob tool never arms a watchdog', async () => {
    relay(permissionEvent('grep', 'perm-grep-1'));
    await vi.advanceTimersByTimeAsync(6000);

    expect(abortSessionSpy).not.toHaveBeenCalled();
    const row = repo.findById(sessionId);
    expect(row?.status).not.toBe('error');
  });
});
