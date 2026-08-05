import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const respondPermissionSpy = vi.fn().mockResolvedValue(true);
// OCU-01 (#1042) — bridge auto-resolve now routes through replyToPermission.
const replyToPermissionSpy = vi.fn().mockResolvedValue(true);
// OCU-03 (#1044) — GET /permission rehydration source (default: nothing pending).
const listPermissionsSpy = vi.fn().mockResolvedValue([]);

const { broadcastSpy, sessionMap, engineSpies } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  engineSpies: {
    listAuthedProviders: vi.fn().mockResolvedValue(['openai', 'google']),
    abortSession: vi.fn().mockResolvedValue(true),
    revertSession: vi.fn().mockResolvedValue(undefined),
    updateSessionAllowlist: vi.fn().mockResolvedValue(true),
    promptAsync: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    respondPermission: (...args: unknown[]) => respondPermissionSpy(...args),
    replyToPermission: (...args: unknown[]) => replyToPermissionSpy(...args),
    listPermissions: (...args: unknown[]) => listPermissionsSpy(...args),
    ...engineSpies,
  },
  opencodeSessionMap: sessionMap,
}));

// #1109 — spy on scheduleIdleEvaluation so the turn-completion path's harvest
// wiring is verifiable: proves the per-turn call site invokes the new
// scheduling function instead of evaluateHarvestedDrafts directly.
const { mockScheduleIdleEvaluation } = vi.hoisted(() => ({ mockScheduleIdleEvaluation: vi.fn() }));
vi.mock('../services/harvested_skill_evaluator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/harvested_skill_evaluator')>();
  return { ...actual, scheduleIdleEvaluation: mockScheduleIdleEvaluation };
});

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';
import {
  _resetForTests as resetRedispatchForTests,
  noteUserMessage,
  retainTurn,
} from '../services/turn_redispatch';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('OpencodeStreamBridge — transcript.append emission', () => {
  let bridge: OpencodeStreamBridge;
  const LOCAL_ID = 'local-session-1';
  const SDK_ID = 'sdk-session-1';

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    sessionMap.set(LOCAL_ID, SDK_ID);
    broadcastSpy.mockClear();
    mockScheduleIdleEvaluation.mockClear();
    for (const spy of Object.values(engineSpies)) spy.mockClear();
    engineSpies.listAuthedProviders.mockResolvedValue(['openai', 'google']);
    engineSpies.abortSession.mockResolvedValue(true);
    engineSpies.revertSession.mockResolvedValue(undefined);
    engineSpies.updateSessionAllowlist.mockResolvedValue(true);
    engineSpies.promptAsync.mockResolvedValue(true);
    resetRedispatchForTests();
    bridge = new OpencodeStreamBridge();

    // Seed an agent session row so updateStatus/updatePreview don't throw.
    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'test',
    });
    // The repo generates its own id; overwrite our local handle via raw SQL
    // is overkill — instead reuse the inserted row's id by querying.
    const inserted = repo.listActive()[0];
    sessionMap.set(inserted.id, SDK_ID);
  });

  function relay(event: Record<string, unknown>): void {
    (bridge as unknown as {
      _relayEvent: (e: unknown) => void;
    })._relayEvent(event);
  }

  it('on session.idle broadcasts transcript.append with accumulated text', () => {
    const localId = sessionMap.keys().next().value as string;
    // Re-target sessionMap so only the seeded session participates.
    sessionMap.clear();
    sessionMap.set(localId, SDK_ID);

    relay({
      type: 'message.part.delta',
      properties: {
        part: { sessionID: SDK_ID },
        delta: 'Hello, ',
        field: 'text',
      },
    });
    relay({
      type: 'message.part.delta',
      properties: {
        part: { sessionID: SDK_ID },
        delta: 'world!',
        field: 'text',
      },
    });
    relay({
      type: 'session.idle',
      properties: { sessionID: SDK_ID },
    });

    const transcriptAppend = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'transcript.append');
    expect(transcriptAppend).toBeDefined();
    expect(transcriptAppend?.id).toBe(localId);
    expect(transcriptAppend?.role).toBe('output');
    expect(transcriptAppend?.text).toBe('Hello, world!');
  });

  it('#1109 — on turn completion schedules idle evaluation instead of running it directly', () => {
    const localId = sessionMap.keys().next().value as string;
    sessionMap.clear();
    sessionMap.set(localId, SDK_ID);

    relay({
      type: 'message.part.delta',
      properties: { part: { sessionID: SDK_ID }, delta: 'Hello', field: 'text' },
    });
    relay({ type: 'session.idle', properties: { sessionID: SDK_ID } });

    expect(mockScheduleIdleEvaluation).toHaveBeenCalledOnce();
  });

  it('on session.error with partial text flushes a transcript.append before the error frame', () => {
    const localId = sessionMap.keys().next().value as string;
    sessionMap.clear();
    sessionMap.set(localId, SDK_ID);

    relay({
      type: 'message.part.delta',
      properties: {
        part: { sessionID: SDK_ID },
        delta: 'partial answer',
        field: 'text',
      },
    });
    relay({
      type: 'session.error',
      properties: {
        sessionID: SDK_ID,
        error: { data: { message: 'Key limit exceeded' } },
      },
    });

    const types = broadcastSpy.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>).type,
    );
    const appendIdx = types.indexOf('transcript.append');
    const errorIdx = types.indexOf('error');
    expect(appendIdx).toBeGreaterThanOrEqual(0);
    expect(errorIdx).toBeGreaterThan(appendIdx);

    const partial = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'transcript.append');
    expect(partial?.text).toBe('partial answer');
  });

  it('on session.error with a tool_use/tool_result pairing message, tags errorClass and rewrites the message', () => {
    const localId = sessionMap.keys().next().value as string;
    sessionMap.clear();
    sessionMap.set(localId, SDK_ID);

    relay({
      type: 'session.error',
      properties: {
        sessionID: SDK_ID,
        error: {
          data: {
            message:
              'messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01NmvKDstL9aMqb4G6ZYFm4x',
          },
        },
      },
    });

    const errorFrame = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'error');
    expect(errorFrame).toBeDefined();
    expect(errorFrame?.errorClass).toBe('tool_pairing');
    expect(errorFrame?.message).toBe(
      'Conversation history became inconsistent (tool call/result pairing). Send a new message to continue.',
    );
  });

  it('on session.error with an unrelated message, does NOT tag errorClass', () => {
    const localId = sessionMap.keys().next().value as string;
    sessionMap.clear();
    sessionMap.set(localId, SDK_ID);

    relay({
      type: 'session.error',
      properties: {
        sessionID: SDK_ID,
        error: { data: { message: 'Key limit exceeded' } },
      },
    });

    const errorFrame = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'error');
    expect(errorFrame).toBeDefined();
    expect(errorFrame?.errorClass).toBeUndefined();
    expect(errorFrame?.message).toBe('Key limit exceeded');
  });

  it('on structured OpenAI 429 re-dispatches the retained turn to Gemini through the real bridge/state path', async () => {
    const localId = new AgentSessionsRepository().listActive()[0].id;
    sessionMap.clear();
    sessionMap.set(localId, SDK_ID);
    retainTurn(localId, {
      sdkSessionId: SDK_ID,
      data: 'retained bridge prompt',
      model: { providerID: 'openai', modelID: 'gpt-5.4' },
      mcpRoleConfig: null,
    });
    noteUserMessage(localId, 'bridge-user-message');

    relay({
      type: 'session.error',
      properties: {
        sessionID: SDK_ID,
        error: {
          name: 'APIError',
          data: { statusCode: 429, isRetryable: true, message: 'Too Many Requests' },
        },
      },
    });

    await vi.waitFor(() => {
      expect(engineSpies.promptAsync).toHaveBeenCalledWith(
        SDK_ID,
        'retained bridge prompt',
        { providerID: 'google', modelID: 'gemini-2.5-pro' },
        undefined,
        undefined,
        undefined,
      );
    });
    expect(engineSpies.updateSessionAllowlist).toHaveBeenCalledWith(SDK_ID, null, 'google');
    expect(new AgentSessionsRepository().findById(localId)?.providerId).toBe('google');
    expect(
      broadcastSpy.mock.calls
        .map((call) => call[0] as Record<string, unknown>)
        .find((frame) => frame.type === 'error' && frame.id === localId),
    ).toBeUndefined();
  });

  it('on session.idle with empty buffer does NOT broadcast transcript.append', () => {
    const localId = sessionMap.keys().next().value as string;
    sessionMap.clear();
    sessionMap.set(localId, SDK_ID);

    relay({
      type: 'session.idle',
      properties: { sessionID: SDK_ID },
    });

    const transcriptAppend = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'transcript.append');
    expect(transcriptAppend).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Permission mode auto-accept / auto-deny logic (#608 + #611)
// ---------------------------------------------------------------------------

describe('OpencodeStreamBridge — permission mode auto-resolution', () => {
  let bridge: OpencodeStreamBridge;
  const SDK_ID = 'sdk-perm-1';
  let localId: string;

  function makePermEvent(opts: {
    permissionID: string;
    toolName: string;
  }): Record<string, unknown> {
    // Real SDK event: `permission.updated` carrying a `Permission` payload
    // (id/type/title/metadata) — NOT the fictional `permission.asked`. The
    // bridge maps id→permissionId, type→toolName, title→summary.
    return {
      type: 'permission.updated',
      properties: {
        id: opts.permissionID,
        type: opts.toolName,
        sessionID: SDK_ID,
        messageID: 'msg-perm',
        title: `Allow ${opts.toolName}?`,
        metadata: { path: '/tmp/file.ts' },
        time: { created: 0 },
      },
    };
  }

  function relay(event: Record<string, unknown>): void {
    (bridge as unknown as {
      _relayEvent: (e: unknown) => void;
    })._relayEvent(event);
  }

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    sessionMap.clear();
    broadcastSpy.mockClear();
    respondPermissionSpy.mockClear();
    replyToPermissionSpy.mockClear();
    bridge = new OpencodeStreamBridge();

    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'perm-test',
    });
    localId = repo.listActive()[0].id;
    sessionMap.set(localId, SDK_ID);
  });

  it('default mode: broadcasts permission.asked without auto-resolving', () => {
    relay(makePermEvent({ permissionID: 'perm-1', toolName: 'bash' }));

    const asked = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.asked');
    expect(asked).toBeDefined();
    expect(asked?.permissionId).toBe('perm-1');
    expect(asked?.toolName).toBe('bash');
    expect(replyToPermissionSpy).not.toHaveBeenCalled();

    // Pending entry should be registered.
    expect(bridge.getPendingPermission(localId, 'perm-1')).toBeDefined();
  });

  it('acceptEdits mode: auto-accepts edit tools', async () => {
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(localId, 'acceptEdits');

    relay(makePermEvent({ permissionID: 'perm-2', toolName: 'edit' }));

    // Give the async replyToPermission call a tick to run.
    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).toHaveBeenCalledWith('perm-2', 'once', undefined, '/tmp', SDK_ID);
    const resolved = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.resolved');
    expect(resolved?.decision).toBe('accept');
  });

  it('acceptEdits mode: does NOT auto-accept non-edit tools', async () => {
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(localId, 'acceptEdits');

    relay(makePermEvent({ permissionID: 'perm-3', toolName: 'bash' }));

    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).not.toHaveBeenCalled();
    const asked = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.asked');
    expect(asked).toBeDefined();
  });

  it('plan mode: auto-denies all tools', async () => {
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(localId, 'plan');

    relay(makePermEvent({ permissionID: 'perm-4', toolName: 'bash' }));

    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).toHaveBeenCalledWith(
      'perm-4',
      'reject',
      expect.stringContaining('plan mode'),
      '/tmp',
      SDK_ID,
    );
    const resolved = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.resolved');
    expect(resolved?.decision).toBe('deny');
  });

  it('bypassPermissions mode: auto-accepts all tools', async () => {
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(localId, 'bypassPermissions');

    relay(makePermEvent({ permissionID: 'perm-5', toolName: 'bash' }));

    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).toHaveBeenCalledWith('perm-5', 'once', undefined, '/tmp', SDK_ID);
    const resolved = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.resolved');
    expect(resolved?.decision).toBe('accept');
  });
});

// ---------------------------------------------------------------------------
// #878 — command approval before shell exec, wired at the bash permission ask
// ---------------------------------------------------------------------------

describe('OpencodeStreamBridge — #878 command approval (bash tool)', () => {
  let bridge: OpencodeStreamBridge;
  const SDK_ID = 'sdk-approval-1';
  let localId: string;
  let originalApprovalsMode: string | undefined;

  function makeBashPermEvent(permissionID: string, command: string): Record<string, unknown> {
    return {
      type: 'permission.updated',
      properties: {
        id: permissionID,
        type: 'bash',
        sessionID: SDK_ID,
        messageID: 'msg-approval',
        title: 'Allow bash?',
        metadata: { command },
        time: { created: 0 },
      },
    };
  }

  function relay(event: Record<string, unknown>): void {
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
  }

  beforeEach(() => {
    originalApprovalsMode = process.env.APPROVALS_MODE;
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    sessionMap.clear();
    broadcastSpy.mockClear();
    respondPermissionSpy.mockClear();
    replyToPermissionSpy.mockClear();
    bridge = new OpencodeStreamBridge();

    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'approval-test',
    });
    localId = repo.listActive()[0].id;
    sessionMap.set(localId, SDK_ID);
  });

  afterEach(() => {
    if (originalApprovalsMode === undefined) delete process.env.APPROVALS_MODE;
    else process.env.APPROVALS_MODE = originalApprovalsMode;
  });

  it('denies a hardline-blocklisted command even under bypassPermissions mode', async () => {
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(localId, 'bypassPermissions');

    relay(makeBashPermEvent('perm-hard-1', 'rm -rf /'));
    await new Promise((r) => setTimeout(r, 10));

    // The dangerous command must be denied, NOT auto-accepted despite bypassPermissions.
    // OCU-01 (#1042): auto-deny now routes through replyToPermission(reject + message).
    expect(replyToPermissionSpy).toHaveBeenCalledWith(
      'perm-hard-1',
      'reject',
      expect.stringContaining('Command blocked'),
      '/tmp',
      SDK_ID,
    );
    const resolved = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.resolved');
    expect(resolved?.decision).toBe('deny');
    const denied = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'tool.denied');
    expect(denied).toBeDefined();
    expect(String(denied?.message)).toContain('hardline-blocklist');
  });

  it('smart mode: a low-risk command under bypassPermissions still auto-accepts (no behavior change for low-risk)', async () => {
    process.env.APPROVALS_MODE = 'smart';
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(localId, 'bypassPermissions');

    relay(makeBashPermEvent('perm-safe-1', 'ls -la'));
    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).toHaveBeenCalledWith('perm-safe-1', 'once', undefined, '/tmp', SDK_ID);
  });

  it('default (manual) mode: even a low-risk command surfaces an ask, since manual mode always asks for bash', async () => {
    // approvals.mode defaults to 'manual' (env.ts) when APPROVALS_MODE is
    // unset — manual mode asks for every non-hardline bash command
    // regardless of risk tier, which is the documented default behavior.
    relay(makeBashPermEvent('perm-manual-safe-1', 'ls -la'));
    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).not.toHaveBeenCalled();
    const asked = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.asked');
    expect(asked).toBeDefined();
  });

  it('manual mode (default) surfaces an approval ask for a dangerous-but-not-hardline command, even under bypassPermissions', async () => {
    process.env.APPROVALS_MODE = 'manual';
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(localId, 'bypassPermissions');

    relay(makeBashPermEvent('perm-ask-1', 'git push --force origin main'));
    await new Promise((r) => setTimeout(r, 10));

    // Must NOT auto-accept despite bypassPermissions — forced to the ask path.
    expect(replyToPermissionSpy).not.toHaveBeenCalled();
    const asked = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.asked');
    expect(asked).toBeDefined();
    expect(asked?.permissionId).toBe('perm-ask-1');
    expect(bridge.getPendingPermission(localId, 'perm-ask-1')).toBeDefined();
  });

  // ── unattended runs must not hang on an 'ask' (2026-08-04) ────────────────
  //
  // In manual mode (the default — APPROVALS_MODE is unset and nothing in the
  // app sets it) every command the engine escalates classifies 'ask'. The 'ask'
  // branch used to registerPermission() and break past the #1156 headless
  // auto-accept, so a scheduled run waited on a human who never arrived until
  // the 600s inactivity abort killed it. Which commands the engine escalates is
  // per-profile (the `permission.bash` map in the agent's .md), so this bites
  // exactly the profiles with an `ask` entry — e.g. worship-planning and
  // fantasy-gm both mark `git push*` / `rm -rf*` / `sudo *` as ask.

  /** Mark the session as a scheduler-originated system run. */
  function makeScheduledRun(): void {
    getDb()
      .prepare(`INSERT INTO agent_scheduled_tasks (id, name, prompt) VALUES (?, ?, ?)`)
      .run('sched-1', 'nightly', 'do the thing');
    getDb()
      .prepare(`UPDATE agent_sessions SET is_system = 1, scheduled_task_id = 'sched-1' WHERE id = ?`)
      .run(localId);
  }

  it('unattended scheduled run: an ask-classified command auto-accepts instead of hanging', async () => {
    process.env.APPROVALS_MODE = 'manual';
    makeScheduledRun();

    relay(makeBashPermEvent('perm-sched-1', 'defuddle parse https://example.com --md'));
    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).toHaveBeenCalledWith('perm-sched-1', 'once', undefined, '/tmp', SDK_ID);
    expect(bridge.getPendingPermission(localId, 'perm-sched-1')).toBeUndefined();
  });

  it('unattended scheduled run: a HARDLINE command is still denied, never auto-accepted', async () => {
    process.env.APPROVALS_MODE = 'manual';
    makeScheduledRun();

    relay(makeBashPermEvent('perm-sched-hardline', 'rm -rf /'));
    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).toHaveBeenCalledWith(
      'perm-sched-hardline',
      'reject',
      expect.stringContaining('hardline-blocklist'),
      '/tmp',
      SDK_ID,
    );
  });

  it('unattended scheduled run in PLAN mode is still auto-denied, not auto-accepted', async () => {
    process.env.APPROVALS_MODE = 'manual';
    makeScheduledRun();
    new AgentSessionsRepository().updatePermissionMode(localId, 'plan');

    relay(makeBashPermEvent('perm-sched-plan', 'echo hi'));
    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).toHaveBeenCalledWith(
      'perm-sched-plan',
      'reject',
      expect.stringContaining('plan mode'),
      '/tmp',
      SDK_ID,
    );
  });

  it('an INTERACTIVE session is unaffected — still surfaces the ask (regression guard)', async () => {
    // No is_system / scheduled_task_id → a human is presumed present.
    process.env.APPROVALS_MODE = 'manual';

    relay(makeBashPermEvent('perm-interactive-1', 'defuddle parse https://example.com --md'));
    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).not.toHaveBeenCalled();
    expect(bridge.getPendingPermission(localId, 'perm-interactive-1')).toBeDefined();
  });

  it('E2: a session UNKNOWN to Rhythm still surfaces the ask — absence of a row is not proof of absence of a human', async () => {
    // Found by smoke test 2026-08-04. `isDelegatedChild` is true when no row
    // resolves (`!dbSession`) — correct for #1156's auto-accept race, but it had
    // also been treated as "unattended" here, so a session created directly
    // against the engine (no Rhythm row at all) ran `git push --force` with no
    // approval card. Unattendedness now requires POSITIVE evidence: a real
    // parent id, or a scheduler-originated run.
    process.env.APPROVALS_MODE = 'manual';
    // Point the map at an sdk id with no corresponding agent_sessions row.
    sessionMap.clear();
    sessionMap.set('ghost-local-id', SDK_ID);

    relay(makeBashPermEvent('perm-ghost-1', 'git push --force origin main'));
    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).not.toHaveBeenCalled();
    const asked = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.asked');
    expect(asked).toBeDefined();
  });

  it('a delegated child (real parent id) still auto-accepts an ask', async () => {
    // The positive-evidence path must keep working, or the E2 fix would simply
    // have disabled the unattended behavior the scheduler depends on.
    process.env.APPROVALS_MODE = 'manual';
    getDb()
      .prepare(
        `INSERT INTO agent_sessions (id, name, agent_kind, status, cwd, sdk_session_id, parent_session_id)
         VALUES ('child-of-local', 'child', 'librarian', 'idle', '/tmp', 'sdk-child-1', ?)`,
      )
      .run(localId);
    sessionMap.clear();
    sessionMap.set('child-of-local', 'sdk-child-1');

    relay({
      type: 'permission.asked',
      properties: {
        id: 'perm-child-1',
        sessionID: 'sdk-child-1',
        toolName: 'bash',
        type: 'bash',
        metadata: { command: 'defuddle parse https://example.com --md' },
        title: 'Allow bash?',
        time: { created: 0 },
      },
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).toHaveBeenCalledWith('perm-child-1', 'once', undefined, '/tmp', 'sdk-child-1');
  });

  it('mode=off allows a non-blocklisted command under default permission mode without asking', async () => {
    process.env.APPROVALS_MODE = 'off';

    relay(makeBashPermEvent('perm-off-1', 'echo hello'));
    await new Promise((r) => setTimeout(r, 10));

    // classifyCommand returns 'allow' for mode=off on a non-blocklisted
    // command, so it falls through to the existing permissionMode='default'
    // logic — which, for a non-edit tool, still asks. This test locks that
    // "off mode does not itself introduce a new prompt beyond what
    // permissionMode already does" contract.
    const asked = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.asked');
    expect(asked).toBeDefined();
    expect(replyToPermissionSpy).not.toHaveBeenCalled();
  });

  it('mode=off still blocks a hardline command', async () => {
    process.env.APPROVALS_MODE = 'off';
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(localId, 'bypassPermissions');

    relay(makeBashPermEvent('perm-off-2', ':(){:|:&};:'));
    await new Promise((r) => setTimeout(r, 10));

    expect(replyToPermissionSpy).toHaveBeenCalledWith(
      'perm-off-2',
      'reject',
      expect.stringContaining('Command blocked'),
      '/tmp',
      SDK_ID,
    );
  });
});

describe('OpencodeStreamBridge — #812 role-scoped dispatch guard (array allowlist)', () => {
  let bridge: OpencodeStreamBridge;
  const SDK_ID = 'sdk-scope-1';
  let localId: string;

  // Relay a tool-call part (message.part.updated) — the bypassPermissions path
  // that hits isToolAllowedForSession → isToolAllowed.
  function relayToolPart(toolName: string): void {
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: `part-${toolName}`,
          type: 'tool',
          tool: toolName,
          sessionID: SDK_ID,
          messageID: 'msg-scope',
        },
      },
    });
  }

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    sessionMap.clear();
    broadcastSpy.mockClear();
    bridge = new OpencodeStreamBridge();

    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'scope-test',
    });
    localId = repo.listActive()[0].id;
    sessionMap.set(localId, SDK_ID);
    // Secretary role scoped to the rhythm server, persisted in the ARRAY form
    // the writers actually produce (#812 repro).
    repo.setMcpScope(localId, 'secretary', '["rhythm"]');
  });

  it('forwards a rhythm tool for a ["rhythm"]-scoped session (not denied)', () => {
    relayToolPart('rhythm_rhythm_get_dashboard');

    const types = broadcastSpy.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>).type,
    );
    expect(types).toContain('message.part.updated');
    expect(types).not.toContain('tool.denied');
  });

  // `image_generation` (#1094) is engine-native but absent from the tool
  // registry — it is a provider-executed tool injected in session/prompt.ts.
  // It must pass this guard like any other native tool; when it did not, every
  // call on a role-scoped session came back "not permitted for this agent's
  // role", which looks identical to the profile lacking the grant.
  it.each(['skill', 'task', 'read', 'bash', 'image_generation'])(
    'forwards the native %s tool for the same scoped session',
    (toolName) => {
      relayToolPart(toolName);

      const types = broadcastSpy.mock.calls.map(
        (c) => (c[0] as Record<string, unknown>).type,
      );
      expect(types).toContain('message.part.updated');
      expect(types).not.toContain('tool.denied');
    },
  );

  it('denies a non-rhythm tool for the same scoped session', () => {
    relayToolPart('nfl_mcp_get_roster');

    const types = broadcastSpy.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>).type,
    );
    expect(types).toContain('tool.denied');
    expect(types).not.toContain('message.part.updated');
  });
});

describe('OpencodeStreamBridge — session.created recording-gap fix (mcp_allowed_tools_json)', () => {
  let bridge: OpencodeStreamBridge;
  let repo: AgentSessionsRepository;

  function relay(event: Record<string, unknown>): void {
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
  }

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    sessionMap.clear();
    broadcastSpy.mockClear();
    bridge = new OpencodeStreamBridge();
    repo = new AgentSessionsRepository();
  });

  it("persists the child's info.mcpAllowlist into mcp_allowed_tools_json on session.created (task-spawned child)", () => {
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'Parent',
    });
    repo.setSdkSessionId(parent.id, 'sdk-parent-recgap');

    relay({
      type: 'session.created',
      properties: {
        sessionID: 'sdk-child-recgap',
        info: {
          parentID: 'sdk-parent-recgap',
          title: 'Do X (@coding-agent subagent)',
          directory: '/tmp/proj',
          mcpAllowlist: { servers: ['rhythm'], tools: [] },
        },
      },
    });

    const childRow = repo.findBySdkSessionId('sdk-child-recgap');
    expect(childRow).not.toBeNull();
    expect(childRow!.mcpAllowedToolsJson).toBe(
      JSON.stringify({ servers: ['rhythm'], tools: [] }),
    );
  });

  it('persists null when the child session.created event carries no mcpAllowlist (unscoped)', () => {
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'Parent',
    });
    repo.setSdkSessionId(parent.id, 'sdk-parent-recgap-2');

    relay({
      type: 'session.created',
      properties: {
        sessionID: 'sdk-child-recgap-2',
        info: {
          parentID: 'sdk-parent-recgap-2',
          title: 'Do Y (@coding-agent subagent)',
          directory: '/tmp/proj',
        },
      },
    });

    const childRow = repo.findBySdkSessionId('sdk-child-recgap-2');
    expect(childRow).not.toBeNull();
    expect(childRow!.mcpAllowedToolsJson).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// OCU-03 (#1044) — rehydrate pending permissions on (re)connect via GET /permission
// ---------------------------------------------------------------------------

describe('OpencodeStreamBridge — #1044 permission rehydration on reconnect', () => {
  let bridge: OpencodeStreamBridge;
  const SDK_ID = 'sdk-rehydrate-1';
  let localId: string;

  function relay(event: Record<string, unknown>): void {
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(event);
  }

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    sessionMap.clear();
    broadcastSpy.mockClear();
    listPermissionsSpy.mockClear();
    listPermissionsSpy.mockResolvedValue([]);
    bridge = new OpencodeStreamBridge();

    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'rehydrate-test',
    });
    localId = repo.listActive()[0].id;
    sessionMap.set(localId, SDK_ID);
  });

  it('re-broadcasts a permission.asked card for a permission GET /permission reports pending (server restart)', async () => {
    // Simulate a fresh bridge (no in-memory pending) with the engine still
    // holding one pending permission.
    listPermissionsSpy.mockResolvedValue([
      {
        id: 'perm-orphan-1',
        sessionID: SDK_ID,
        permission: 'bash',
        metadata: { command: 'ls -la' },
        tool: { callID: 'call-1' },
      },
    ]);

    await bridge.recoverPendingPermissions('/tmp');

    const asked = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.asked' && m.permissionId === 'perm-orphan-1');
    expect(asked).toBeDefined();
    expect(asked?.toolName).toBe('bash');
    // And it is now tracked so a reply routes correctly.
    expect(bridge.getPendingPermission(localId, 'perm-orphan-1')).toBeDefined();
  });

  it('does not double-broadcast when recovery runs twice (idempotent)', async () => {
    listPermissionsSpy.mockResolvedValue([
      { id: 'perm-orphan-2', sessionID: SDK_ID, permission: 'edit', metadata: {} },
    ]);

    await bridge.recoverPendingPermissions('/tmp');
    await bridge.recoverPendingPermissions('/tmp');

    const asks = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((m) => m.type === 'permission.asked' && m.permissionId === 'perm-orphan-2');
    expect(asks).toHaveLength(1);
  });

  it('dedups against a live permission.updated for the same requestID (event + rehydrate → one card)', async () => {
    // Live event surfaces the card first.
    relay({
      type: 'permission.updated',
      properties: {
        id: 'perm-dup-1',
        type: 'bash',
        sessionID: SDK_ID,
        messageID: 'msg-x',
        title: 'Allow bash?',
        metadata: {},
        time: { created: 0 },
      },
    });
    // Then rehydrate reports the same one still pending.
    listPermissionsSpy.mockResolvedValue([
      { id: 'perm-dup-1', sessionID: SDK_ID, permission: 'bash', metadata: {} },
    ]);
    await bridge.recoverPendingPermissions('/tmp');

    const asks = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((m) => m.type === 'permission.asked' && m.permissionId === 'perm-dup-1');
    expect(asks).toHaveLength(1);
  });

  it('ignores pending permissions for unknown SDK sessions', async () => {
    listPermissionsSpy.mockResolvedValue([
      { id: 'perm-unknown', sessionID: 'sdk-not-mapped', permission: 'bash', metadata: {} },
    ]);
    await bridge.recoverPendingPermissions('/tmp');

    const asks = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((m) => m.type === 'permission.asked');
    expect(asks).toHaveLength(0);
  });
});
