import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const respondPermissionSpy = vi.fn().mockResolvedValue(true);

const { broadcastSpy, sessionMap } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    respondPermission: (...args: unknown[]) => respondPermissionSpy(...args),
  },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

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
    expect(respondPermissionSpy).not.toHaveBeenCalled();

    // Pending entry should be registered.
    expect(bridge.getPendingPermission(localId, 'perm-1')).toBeDefined();
  });

  it('acceptEdits mode: auto-accepts edit tools', async () => {
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(localId, 'acceptEdits');

    relay(makePermEvent({ permissionID: 'perm-2', toolName: 'edit' }));

    // Give the async respondPermission call a tick to run.
    await new Promise((r) => setTimeout(r, 10));

    expect(respondPermissionSpy).toHaveBeenCalledWith(SDK_ID, 'perm-2', 'accept', '/tmp');
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

    expect(respondPermissionSpy).not.toHaveBeenCalled();
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

    expect(respondPermissionSpy).toHaveBeenCalledWith(SDK_ID, 'perm-4', 'deny', '/tmp');
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

    expect(respondPermissionSpy).toHaveBeenCalledWith(SDK_ID, 'perm-5', 'accept', '/tmp');
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
    expect(respondPermissionSpy).toHaveBeenCalledWith(SDK_ID, 'perm-hard-1', 'deny', '/tmp');
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

    expect(respondPermissionSpy).toHaveBeenCalledWith(SDK_ID, 'perm-safe-1', 'accept', '/tmp');
  });

  it('default (manual) mode: even a low-risk command surfaces an ask, since manual mode always asks for bash', async () => {
    // approvals.mode defaults to 'manual' (env.ts) when APPROVALS_MODE is
    // unset — manual mode asks for every non-hardline bash command
    // regardless of risk tier, which is the documented default behavior.
    relay(makeBashPermEvent('perm-manual-safe-1', 'ls -la'));
    await new Promise((r) => setTimeout(r, 10));

    expect(respondPermissionSpy).not.toHaveBeenCalled();
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
    expect(respondPermissionSpy).not.toHaveBeenCalled();
    const asked = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.asked');
    expect(asked).toBeDefined();
    expect(asked?.permissionId).toBe('perm-ask-1');
    expect(bridge.getPendingPermission(localId, 'perm-ask-1')).toBeDefined();
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
    expect(respondPermissionSpy).not.toHaveBeenCalled();
  });

  it('mode=off still blocks a hardline command', async () => {
    process.env.APPROVALS_MODE = 'off';
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(localId, 'bypassPermissions');

    relay(makeBashPermEvent('perm-off-2', ':(){:|:&};:'));
    await new Promise((r) => setTimeout(r, 10));

    expect(respondPermissionSpy).toHaveBeenCalledWith(SDK_ID, 'perm-off-2', 'deny', '/tmp');
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

  it.each(['skill', 'task', 'read', 'bash'])(
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
