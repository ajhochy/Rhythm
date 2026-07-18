/**
 * Contract tests for issue #818 (org-optimizer-02) — denied-tool event log.
 *
 * SECURITY-CRITICAL: this exercises the same #736/#812 dispatch backstop
 * (`OpencodeStreamBridge.isToolAllowedForSession` → `isToolAllowed`) covered by
 * `issue_736_contract.test.ts` and `mcp_dispatch_guard.test.ts`. The additive
 * logging under test here MUST NOT change the guard's allow/deny decision in
 * any way — these tests assert the decision is identical with logging wired in
 * and separately assert the logging side-effect itself, so a regression in
 * either dimension fails a distinct test.
 *
 * These MUST fail on the unmodified codebase: no `denied_tool_events` table /
 * repository exists yet, so nothing is ever recorded.
 *
 * Criteria covered:
 *   issue-818-c2 — When the dispatch-time check returns false, exactly one row
 *                  is written; when true, no row.
 *   issue-818-c3 — Logging is best-effort / NEVER throws into the dispatch
 *                  path (fail-open for logging, fail-closed for the guard
 *                  itself — the allow/deny decision unchanged).
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
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { DeniedToolEventsRepository } from '../repositories/denied_tool_events_repository';
import { isToolAllowed } from '../services/mcp_dispatch_guard';
import type { AgentKind } from '../models/agent_session';

const ALLOWLIST_JSON = JSON.stringify({
  rhythm: ['rhythm_list_tasks', 'rhythm_create_task'],
  read: [],
});

const SDK_SESSION_ID = 'sdk-session-818';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function permissionEvent(toolName: string, permissionId = 'perm-1') {
  return {
    type: 'permission.asked',
    properties: {
      permissionID: permissionId,
      sessionID: SDK_SESSION_ID,
      toolName,
      summary: `run ${toolName}`,
      args: { secret: 'must-not-be-logged' },
    },
  };
}

function toolPartEvent(toolName: string, status = 'pending') {
  return {
    type: 'message.part.updated',
    properties: {
      part: {
        id: `part-${toolName}`,
        messageID: 'msg-tools',
        sessionID: SDK_SESSION_ID,
        type: 'tool',
        tool: toolName,
        state: { status, input: { secret: 'must-not-be-logged' } },
      },
    },
  };
}

describe('issue-818 — denied-tool event log (dispatch guard logging contract)', () => {
  let bridge: OpencodeStreamBridge;
  let sessionsRepo: AgentSessionsRepository;
  let deniedRepo: DeniedToolEventsRepository;

  beforeEach(() => {
    setDb(makeDb());
    sessionsRepo = new AgentSessionsRepository();
    deniedRepo = new DeniedToolEventsRepository();
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

  function seedSession(
    mcpRole: string | null,
    allowlistJson: string | null,
    agentKind: string = 'claude-code',
  ): string {
    const session = sessionsRepo.insert({
      // The model type narrows agentKind, but the column is free TEXT (a
      // logical FK to agent_configs.id) — cast so tests can exercise kinds
      // that do / don't resolve to a real agent_configs row.
      agentKind: agentKind as AgentKind,
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

  // ── issue-818-c2 ────────────────────────────────────────────────────────────
  it('issue-818-c2: a denied permission-ask call writes exactly one denied_tool_events row', async () => {
    // Bug this catches: the logging seam is never wired up, or is wired to the
    // wrong branch (e.g. logs on allow instead of deny), so the org audit sees
    // zero rows or misattributed rows.
    const localId = seedSession('secretary', ALLOWLIST_JSON);

    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent('rhythm_delete_task'),
    );

    // Give any fire-and-forget async logging a tick to land.
    await new Promise((r) => setTimeout(r, 0));

    const rows = await deniedRepo.listAllAsync();
    expect(rows).toHaveLength(1);
    expect(rows[0].toolName).toBe('rhythm_delete_task');
    expect(rows[0].sessionId).toBe(localId);
  });

  it('issue-818-c2: a denied tool-part call writes exactly one denied_tool_events row', async () => {
    const localId = seedSession('secretary', ALLOWLIST_JSON);

    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      toolPartEvent('rhythm_delete_task'),
    );
    await new Promise((r) => setTimeout(r, 0));

    const rows = await deniedRepo.listAllAsync();
    expect(rows).toHaveLength(1);
    expect(rows[0].toolName).toBe('rhythm_delete_task');
    expect(rows[0].sessionId).toBe(localId);
  });

  it('issue-818-c2: an allowed tool-call writes no denied_tool_events row', async () => {
    // Bug this catches: logging fires unconditionally (on every dispatch check,
    // not just denials), polluting the audit signal with allow-path noise.
    seedSession('secretary', ALLOWLIST_JSON);

    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent('rhythm_list_tasks'),
    );
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      toolPartEvent('rhythm_list_tasks'),
    );
    await new Promise((r) => setTimeout(r, 0));

    const rows = await deniedRepo.listAllAsync();
    expect(rows).toHaveLength(0);
  });

  it('issue-818-c2: a non-role-scoped session (pass-through) writes no denied_tool_events row', async () => {
    seedSession(null, null);

    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent('bash'),
    );
    await new Promise((r) => setTimeout(r, 0));

    const rows = await deniedRepo.listAllAsync();
    expect(rows).toHaveLength(0);
  });

  it('issue-818-c2 / safety: never logs tool arguments or payloads, only the tool name', async () => {
    // Bug this catches: a naive implementation logs the whole event/part
    // object (including `args`/`input`) instead of just the tool name,
    // leaking potentially sensitive call payloads into a log table.
    seedSession('secretary', ALLOWLIST_JSON);

    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent('rhythm_delete_task'),
    );
    await new Promise((r) => setTimeout(r, 0));

    const rows = await deniedRepo.listAllAsync();
    expect(rows).toHaveLength(1);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain('must-not-be-logged');
  });

  // ── issue-818 follow-up: agent_config_id attribution ───────────────────────
  // The bridge resolves agent_config_id best-effort from the session row's
  // mcp_role (the enforcing profile's agent_configs.id on the #765 interactive
  // path) then agent_kind (a logical FK to agent_configs.id), validating each
  // against a real agent_configs row before use.
  it('attribution: a denied call from a session whose mcp_role is a known profile writes the row WITH that agent_config_id', async () => {
    // Bug this catches: attribution never resolves (always null), or prefers
    // the base agentKind over the enforcing per-turn profile, so the org audit
    // attributes secretary's denials to 'claude-code'.
    new AgentConfigsRepository().insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'assets/agents/secretary.png',
    });
    seedSession('secretary', ALLOWLIST_JSON);

    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent('rhythm_delete_task'),
    );
    await new Promise((r) => setTimeout(r, 0));

    const rows = await deniedRepo.listAllAsync();
    expect(rows).toHaveLength(1);
    expect(rows[0].agentConfigId).toBe('secretary');
  });

  it('attribution: falls back to agent_kind when mcp_role is a legacy role slug that is not a profile', async () => {
    // Bug this catches: the fallback chain stops at mcp_role, losing the
    // scheduled-path attribution where agent_kind carries the real profile id.
    // 'claude-code' is seeded into agent_configs by runMigrations; the role
    // slug below is not a profile.
    seedSession('legacy-mcp-role-slug', ALLOWLIST_JSON, 'claude-code');

    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent('rhythm_delete_task'),
    );
    await new Promise((r) => setTimeout(r, 0));

    const rows = await deniedRepo.listAllAsync();
    expect(rows).toHaveLength(1);
    expect(rows[0].agentConfigId).toBe('claude-code');
  });

  it('attribution: a session with no resolvable profile still writes the row with agent_config_id null', async () => {
    // Bug this catches: an unvalidated candidate (legacy role slug or
    // placeholder kind) is written verbatim, polluting the telemetry column
    // with fake "profiles" the org audit would report on.
    seedSession('legacy-mcp-role-slug', ALLOWLIST_JSON, 'not-a-config-id');

    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent('rhythm_delete_task'),
    );
    await new Promise((r) => setTimeout(r, 0));

    const rows = await deniedRepo.listAllAsync();
    expect(rows).toHaveLength(1);
    expect(rows[0].agentConfigId).toBeNull();
    expect(rows[0].toolName).toBe('rhythm_delete_task');
  });

  it('attribution: resolved profiles flow through countByProfileAndToolAsync end-to-end', async () => {
    // Bug this catches: attribution and aggregation disagree on the id form
    // (e.g. one writes the label, the other groups on the id), breaking the
    // "profile X was denied tool Y N times" audit signal end-to-end.
    new AgentConfigsRepository().insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'assets/agents/secretary.png',
    });
    seedSession('secretary', ALLOWLIST_JSON);

    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent('rhythm_delete_task', 'perm-1'),
    );
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      permissionEvent('rhythm_delete_task', 'perm-2'),
    );
    await new Promise((r) => setTimeout(r, 0));

    const counts = await deniedRepo.countByProfileAndToolAsync(
      new Date(Date.now() - 60_000).toISOString(),
    );
    const secretary = counts.find(
      (c) => c.agentConfigId === 'secretary' && c.toolName === 'rhythm_delete_task',
    );
    expect(secretary).toBeDefined();
    expect(secretary!.count).toBe(2);
  });

  // ── issue-818-c3 ────────────────────────────────────────────────────────────
  it('issue-818-c3: isToolAllowed return value is byte-for-byte unchanged by the presence of logging', () => {
    // Bug this catches: wiring logging into the guard's own module (rather
    // than a call-site seam) accidentally changes control flow or the
    // predicate's return value. Directly exercises the pure predicate that
    // #736/#812 depend on — must be identical to the existing
    // mcp_dispatch_guard.test.ts expectations.
    expect(isToolAllowed('rhythm_delete_task', ALLOWLIST_JSON)).toBe(false);
    expect(isToolAllowed('rhythm_list_tasks', ALLOWLIST_JSON)).toBe(true);
    expect(isToolAllowed('bash', null)).toBe(true);
    expect(isToolAllowed('read', '[]')).toBe(false);
    expect(isToolAllowed('read', 'not-json{')).toBe(false);
  });

  it('issue-818-c3: a throwing logger/repository does not affect the guard decision or crash dispatch', async () => {
    // Bug this catches: logging is implemented as a blocking, throwing call in
    // the dispatch path — an unexpected DB error (e.g. disk full, migration
    // race) would then propagate and either crash the stream bridge or (worse)
    // get caught by a broad try/catch that also swallows the deny decision,
    // silently converting a deny into an allow.
    // Poison the underlying DB so BOTH the denied_tool_events write AND the
    // agent_config_id resolution (agent_configs lookup) throw, simulating a
    // failing logger + failing resolver without special-casing test mocks.
    const db = new Database(':memory:');
    runMigrations(db);
    db.exec('DROP TABLE denied_tool_events');
    db.exec('DROP TABLE agent_configs');
    setDb(db);
    // Seed the session row in the poisoned DB handle so the bridge can still
    // resolve session/allowlist context. sessionMap is cleared first (it is a
    // reverse sdkSessionId → localSessionId lookup; a stale entry from a
    // different db generation must not collide with SDK_SESSION_ID here).
    sessionMap.clear();
    const sessionsRepo2 = new AgentSessionsRepository();
    const session2 = sessionsRepo2.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp/work',
      name: 'role session 2',
      projectId: null,
      mcpRole: 'secretary',
      mcpAllowedToolsJson: ALLOWLIST_JSON,
    });
    sessionMap.set(session2.id, SDK_SESSION_ID);

    expect(() => {
      (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
        permissionEvent('rhythm_delete_task'),
      );
    }).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    // The guard's own decision must still have denied the tool: no accept call
    // was made to replyToPermission (decision 'once' means accept).
    const acceptCalls = replyToPermissionSpy.mock.calls.filter((c) => c[1] === 'once');
    expect(acceptCalls.length).toBe(0);

    // A denied result must still have been surfaced to the client even though
    // the logging table is unavailable.
    const denials = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((f) => {
        const t = String(f.type ?? '');
        return t === 'tool.denied' || t === 'tool.rejected' || t === 'error';
      });
    expect(denials.length).toBeGreaterThan(0);
  });
});
