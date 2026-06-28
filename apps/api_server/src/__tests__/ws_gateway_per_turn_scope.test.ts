/**
 * Issue #765 — ws_gateway interactive path: per-turn agent selection must
 * drive MCP scope, not the session's stored agentKind.
 *
 * ROOT CAUSE (discovered by smoke 2026-06-27):
 *   The Flutter app creates sessions agent-less (agentId: null → agent_kind =
 *   '' or 'claude-code'). The actual profile is picked PER TURN in the
 *   composer and arrives on the WS frame as `agent: 'secretary'`. Before the
 *   fix, ws_gateway resolved scope from `session.agentKind` ('claude-code'),
 *   which has no allowed_mcps_json → null config → ALL tools. The real
 *   profile's MCP restriction was never applied on the interactive path.
 *
 * THE FIX (ws_gateway.ts):
 *   const scopeAgentId = perTurnAgent ?? agentKind ?? null;
 *   ... resolveProfileScope(scopeAgentId) ...
 *
 * THIS TEST CATCHES REGRESSION:
 *   - Creates a session row with agentKind='claude-code' (no MCP restriction)
 *   - Sends a WS frame with agent='secretary'
 *   - Asserts the DB row gets mcp_role='secretary' AFTER handleInputFrame runs
 *   - If the fix is reverted, resolveProfileScope is called with 'claude-code'
 *     → null mcpRoleConfig → setMcpScope(id, null, null) → row.mcpRole stays null
 *     → this test fails
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/ws_gateway_per_turn_scope.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ── Module mocks ─────────────────────────────────────────────────────────────
// Mock BEFORE importing handleInputFrame so mocks are in place when the module
// is first loaded (vitest hoists vi.mock() calls automatically).

// Heavy dependencies that block / require a live engine.
// opencodeSessionMap must start EMPTY so handleInputFrame sees no existing SDK
// session and tries to create a new one.
vi.mock('../services/opencode_engine', () => {
  const map = new Map<string, string>();
  return {
    opencodeSessionMap: map,
    opencodeClient: {
      createSession: vi.fn().mockResolvedValue(null), // null → early-exit path
      getSession: vi.fn().mockResolvedValue(null),
      promptAsync: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock('../services/pty_proxy', () => ({
  bridgePty: false,
  ptyEngineUrl: null,
}));

vi.mock('../services/skill_retrieval', () => ({
  buildSkillsPreface: vi.fn().mockResolvedValue(null),
  isSkillInjectionEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/memory_retrieval', () => ({
  buildMemoryPreface: vi.fn().mockResolvedValue(null),
  isMemoryInjectionEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock('../utils/app_events', () => ({
  appEvents: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

// ── Import the unit under test AFTER mocks ───────────────────────────────────
import { handleInputFrame } from '../services/ws_gateway';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Minimal WebSocket stand-in — captures frames sent to the client. */
class FakeWs {
  readonly sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  readyState = 1; // OPEN
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('issue-765: ws_gateway per-turn scope resolution', () => {
  let sessionId: string;
  let ws: FakeWs;

  beforeEach(async () => {
    setDb(makeDb());

    // Secretary profile: only the rhythm MCP server is allowed.
    new AgentConfigsRepository().insert({
      id: 'secretary',
      label: 'Secretary',
      icon: '🗂️',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    // Note: the 'claude-code' config is seeded by migrations (INSERT OR IGNORE),
    // so there is no need to insert it here. It has no allowed_mcps_json,
    // representing the unrestricted baseline that the pre-fix code incorrectly
    // used for scope resolution.

    // Create an agent session with agentKind='claude-code'
    // (what the app stores when creating an agent-less session).
    const session = new AgentSessionsRepository().insert({
      agentKind: 'claude-code',
      taskId: null,
      name: 'scope-test-session',
      cwd: '/tmp',
    });
    sessionId = session.id;

    ws = new FakeWs();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('issue-765-ws-c1: per-turn agent="secretary" persists secretary scope even when agentKind="claude-code"', async () => {
    // The app creates the session with agentKind='claude-code' (no restriction).
    // The user then picks "Secretary" in the composer — frame carries agent='secretary'.
    await handleInputFrame(ws as unknown as import('ws').WebSocket, {
      v: 1,
      type: 'session.input',
      id: sessionId,
      data: 'Draft a reply',
      agent: 'secretary',
    });

    // Core assertion: the session row now carries secretary's scope.
    const row = new AgentSessionsRepository().findById(sessionId);
    expect(row?.mcpRole).toBe('secretary');
    expect(row?.mcpAllowedToolsJson).toBeDefined();
    const allowedServers = JSON.parse(row?.mcpAllowedToolsJson ?? '[]') as string[];
    expect(allowedServers).toContain('rhythm');

    // Regression guard: if the fix reverts (uses agentKind='claude-code'),
    // claude-code has no allowed_mcps → setMcpScope(id, null, null) → mcpRole stays null.
  });

  it('issue-765-ws-c2: frame without agent field falls back to agentKind for scope', async () => {
    // When the composer sends no `agent` field (pure model turn, no profile override),
    // scope should resolve from the session's stored agentKind ('claude-code' → no restriction).
    await handleInputFrame(ws as unknown as import('ws').WebSocket, {
      v: 1,
      type: 'session.input',
      id: sessionId,
      data: 'No agent override',
      // Note: no `agent` field
    });

    const row = new AgentSessionsRepository().findById(sessionId);
    // 'claude-code' profile has no allowed_mcps_json → resolveProfileScope returns
    // null mcpRoleConfig → setMcpScope(id, null, null) → row keeps null scope.
    expect(row?.mcpRole).toBeNull();
    expect(row?.mcpAllowedToolsJson).toBeNull();
  });

  it('issue-765-ws-c3: per-turn agent overrides a previously set scope on the row', async () => {
    // Pre-set a stale scope on the row (simulates a prior secretary turn).
    new AgentSessionsRepository().setMcpScope(sessionId, 'secretary', JSON.stringify(['rhythm']));
    let row = new AgentSessionsRepository().findById(sessionId);
    expect(row?.mcpRole).toBe('secretary');

    // New turn arrives with no agent override (unrestricted model turn).
    // The scope should be cleared so the row no longer carries a stale allowlist.
    await handleInputFrame(ws as unknown as import('ws').WebSocket, {
      v: 1,
      type: 'session.input',
      id: sessionId,
      data: 'Unrestricted turn',
      // no `agent` field → falls back to agentKind='claude-code' → null scope
    });

    row = new AgentSessionsRepository().findById(sessionId);
    expect(row?.mcpRole).toBeNull();
    expect(row?.mcpAllowedToolsJson).toBeNull();
  });
});
