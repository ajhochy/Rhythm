/**
 * #736 — Layer 2: WS-gateway dispatch backstop honoring mcp_allowed_tools_json
 *
 * C1 (PR #734) persists `mcp_role` + `mcp_allowed_tools_json` on the
 * agent_sessions row but does NOT enforce it at tool-call time. This is the
 * runtime dispatch-time backstop: every OpenCode tool-call event that funnels
 * through the stream bridge is re-checked against the session's allowlist and
 * rejected BEFORE it executes/completes — defense-in-depth behind Layer 1
 * (#765), modeled on Odysseus's `_execute_tool_block_impl`.
 *
 * The real surface under test is `OpencodeStreamBridge._relayEvent` (the path
 * that proxies OpenCode events to the Flutter client). We fake only the
 * boundaries OUTSIDE the unit: the WS `broadcast` sink and the `opencodeClient`
 * SDK (so we can observe a deny call without a real engine). The session row is
 * a REAL row in an in-memory SQLite DB so the bridge reads the real persisted
 * `mcpAllowedToolsJson` — the value the production POST /agent-sessions path
 * actually writes.
 *
 * Criteria:
 *   issue-736-c1 — role-scoped session: out-of-allowlist tool-call is blocked
 *                  (not executed) with a clear denied result surfaced.
 *   issue-736-c2 — sessions with no mcp_role are unaffected (full pass-through).
 *   issue-736-c3 — a simulated out-of-allowlist tool-call event is asserted blocked.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

// ── Boundary fakes (hoisted) ─────────────────────────────────────────────────
// broadcast (WS sink) and opencodeClient (SDK) are the true boundaries outside
// the bridge. We never mock the bridge itself.
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

// skill_extractor is fire-and-forget on idle; stub so it never touches the DB.
vi.mock('../services/skill_extractor', () => ({
  queueSkillExtraction: vi.fn(),
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// Allowlist mirrors what POST /agent-sessions persists for a role: a JSON
// Record<serverName, string[]>. `read` is a builtin grant; rhythm_list_tasks is
// an allowed MCP tool. `rhythm_delete_task` is NOT in the allowlist.
const ALLOWLIST_JSON = JSON.stringify({
  rhythm: ['rhythm_list_tasks', 'rhythm_create_task'],
  read: [],
});

const SDK_SESSION_ID = 'sdk-session-736';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Build a message.part.updated tool-call event (real opencode shape). */
function toolPartEvent(localId: string, toolName: string, status = 'pending') {
  return {
    type: 'message.part.updated',
    properties: {
      part: {
        id: `part-${toolName}`,
        messageID: 'msg-tools',
        sessionID: SDK_SESSION_ID,
        type: 'tool',
        tool: toolName,
        state: { status, input: {} },
      },
    },
  };
}

/** Build a permission.asked event (the pre-execution gate opencode emits). */
function permissionEvent(toolName: string, permissionId = 'perm-1') {
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

function deniedFrames() {
  return broadcastSpy.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((f) => {
      const t = String(f.type ?? '');
      // A "denied result" can surface as an error frame, a permission.resolved
      // with decision 'deny', or a dedicated tool.denied frame. Accept any.
      if (t === 'permission.resolved' && f.decision === 'deny') return true;
      if (t === 'tool.denied' || t === 'tool.rejected') return true;
      if (t === 'error') return true;
      return false;
    });
}

describe('#736 — WS-gateway dispatch backstop', () => {
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

  // Helper: insert a session row and map it to the SDK session id.
  function seedSession(mcpRole: string | null, allowlistJson: string | null): string {
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp/work',
      name: 'role session',
      projectId: null,
      mcpRole,
      mcpAllowedToolsJson: allowlistJson,
    });
    sessionMap.set(session.id, SDK_SESSION_ID);
    return session.id;
  }

  // ── issue-736-c1 / c3 ──────────────────────────────────────────────────────
  // Regression caught: an agent emits an MCP tool-call the session's role never
  // granted. Without the backstop the bridge forwards/permits it and the tool
  // runs. The backstop must surface a denied result and NOT let the disallowed
  // tool proceed. OpenCode-native tools use the engine's permission policy and
  // are covered separately in opencode_stream_bridge.test.ts.
  it('issue-736-c1: blocks an out-of-allowlist tool-call on a role-scoped session and surfaces a denied result', () => {
    const localId = seedSession('secretary', ALLOWLIST_JSON);

    // Simulate the agent attempting an MCP tool outside the allowlist.
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent('rhythm_delete_task'),
    );

    // A denied result must be surfaced to the client.
    const denials = deniedFrames();
    expect(denials.length).toBeGreaterThan(0);

    // The disallowed tool must NOT be auto-accepted. If the bridge responds to
    // the permission at all, it must be a 'deny' (reject) — never an accept
    // ('once'). The auto-deny path calls the modern replyToPermission(id,
    // decision, message, dir, sdkSessionId) — decision 'once' means accept.
    const acceptCalls = replyToPermissionSpy.mock.calls.filter(
      (c) => c[1] === 'once',
    );
    expect(acceptCalls.length).toBe(0);
    expect(replyToPermissionSpy).toHaveBeenCalledWith(
      'perm-1',
      'reject',
      expect.stringContaining('rhythm_delete_task'),
      expect.anything(),
      SDK_SESSION_ID,
    );
  });

  it('issue-736-c3: blocks an out-of-allowlist tool-call delivered as a message.part.updated tool part', () => {
    const localId = seedSession('secretary', ALLOWLIST_JSON);

    // Simulate a disallowed MCP tool arriving as a tool part (bypassPermissions
    // path, where no permission event fires).
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      toolPartEvent(localId, 'rhythm_delete_task'),
    );

    // The bridge must NOT forward the disallowed tool part as a normal
    // message.part.updated (that would render the tool as running/completed in
    // the UI). A denied result must be surfaced instead.
    const forwardedToolParts = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter(
        (f) =>
          f.type === 'message.part.updated' &&
          (f.part as Record<string, unknown> | undefined)?.tool ===
            'rhythm_delete_task',
      );
    expect(forwardedToolParts.length).toBe(0);
    expect(deniedFrames().length).toBeGreaterThan(0);
  });

  // ── issue-736-c2 ────────────────────────────────────────────────────────────
  // Regression caught: the backstop over-reaches and blocks tools on a session
  // that never opted into a role. A session with mcp_role = null must pass every
  // tool through untouched — no denial, no permission rewrite.
  it('issue-736-c2: a session with no mcp_role passes tool-calls through untouched', () => {
    const localId = seedSession(null, null);

    // Same `bash` permission event that was denied for the role-scoped session.
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent('bash'),
    );
    // And a tool part the role would have blocked.
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      toolPartEvent(localId, 'rhythm_delete_task'),
    );

    // No denied result should be surfaced for an unscoped session.
    expect(deniedFrames().length).toBe(0);

    // The tool part must be forwarded normally (default pass-through).
    const forwardedToolParts = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter(
        (f) =>
          f.type === 'message.part.updated' &&
          (f.part as Record<string, unknown> | undefined)?.tool ===
            'rhythm_delete_task',
      );
    expect(forwardedToolParts.length).toBe(1);
  });

  // Sanity: an ALLOWED tool on a role-scoped session must still pass through and
  // must NOT be denied — proves the guard isn't a blanket block.
  it('issue-736-c1 (positive): an allowed tool on a role-scoped session is not denied and forwards normally', () => {
    const localId = seedSession('secretary', ALLOWLIST_JSON);

    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      toolPartEvent(localId, 'rhythm_list_tasks'),
    );

    const forwardedToolParts = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter(
        (f) =>
          f.type === 'message.part.updated' &&
          (f.part as Record<string, unknown> | undefined)?.tool ===
            'rhythm_list_tasks',
      );
    expect(forwardedToolParts.length).toBe(1);
    expect(deniedFrames().length).toBe(0);
  });
});
