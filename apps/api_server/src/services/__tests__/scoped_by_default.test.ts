/**
 * Acceptance-contract tests for issue #842 (tokens-02) — Scoped-by-default sessions.
 *
 * Scoping decision (documented in docs/ai/contracts/issue-842.json): AC1 says
 * "UI badge and/or log warning" — the "and/or" makes a log-warning-only
 * implementation sufficient. This contract tests the BACKEND log-warning path
 * only; no Flutter UI badge is added (the Flutter `AgentSession` model does
 * not yet expose `mcpRole` at all — adding a UI badge would require touching
 * the Dart model + list view + side panel, out of proportion to an "and/or"
 * criterion that a log warning alone satisfies).
 *
 * Criteria covered:
 *   issue-842-c1 — unscoped sessions flagged (log warning) with their
 *     tool-surface total from #841.
 *   issue-842-c2 — generic profiles get a curated default scope covering
 *     common tasks; full surface remains available by explicit opt-in
 *     (omitting mcpRole entirely).
 *   issue-842-c3 — NO behavior change for existing roled agents; alignment
 *     guards green (verified by the existing mcp_names_alignment /
 *     agent_profile_sync suites still passing — see validation command).
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';

// ── issue-842-c1: unscoped session creation logs a visible warning ─────────

const { mockCreateSession } = vi.hoisted(() => {
  process.env.AGENT_LOCAL = 'true';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('path') as typeof import('path');
  process.env.MCP_ROLES_DIR = nodePath.resolve(__dirname, '..', '..', '..', '..', '..', '.mcp-roles');
  return {
    mockCreateSession: vi.fn().mockResolvedValue({ id: 'sdk-session-842-test' }),
  };
});

vi.mock('../../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    statusMessage: 'Opencode SDK ready',
    listAuthedProviders: vi.fn().mockResolvedValue([]),
    createSession: mockCreateSession,
    ensureReady: vi.fn().mockResolvedValue(true),
    setAuth: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    listMcp: vi.fn().mockResolvedValue({}),
    listSkills: vi.fn().mockResolvedValue([]),
  };
  return {
    opencodeClient: mockClient,
    opencodeSessionMap: new Map<string, string>(),
  };
});

vi.mock('../../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock('../../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
}));

import { createApp } from '../../app';
import { logger } from '../../utils/logger';
import { startTestServer } from '../../__tests__/helpers/real_server';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const BASE_PAYLOAD = {
  agentId: 'claude-code',
  cwd: os.homedir(),
  name: 'Test Session',
};

describe('POST /agent-sessions — issue-842-c1 unscoped-session flagging', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
    const { opencodeClient } = await import('../../services/opencode_engine');
    (opencodeClient as { isReady: boolean }).isReady = true;
  });

  it('issue-842-c1: creating a session with NO mcpRole logs a warning naming the session and its tool-surface total', async () => {
    // Bug this catches: unscoped sessions are created silently — nobody can
    // tell, from the logs, that a session has full unrestricted tool access,
    // defeating "unscoped is a visible deliberate exception."
    const warnSpy = vi.spyOn(logger, 'warn');

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASE_PAYLOAD), // no mcpRole
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.mcpRole).toBeNull();

    const unscopedWarnings = warnSpy.mock.calls.filter((call) => {
      const joined = call.map((a) => String(a)).join(' ');
      return joined.includes('unscoped') && joined.includes(String(body.id));
    });
    expect(unscopedWarnings).toHaveLength(1);
    // The warning must carry a tool-surface total (issue #841 integration) —
    // not just a bare "this session is unscoped" note with no cost signal.
    const loggedArgs = unscopedWarnings[0].map((a) => String(a)).join(' ');
    expect(loggedArgs).toMatch(/estimatedTokens|totalEstimatedTokens/);
  });

  it('issue-842-c1 (falsification guard): a ROLE-SCOPED session does NOT trigger the unscoped warning', async () => {
    // Bug this catches: the warning fires unconditionally, making it useless
    // noise that would drown out the genuinely-unscoped signal.
    const warnSpy = vi.spyOn(logger, 'warn');

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_PAYLOAD, mcpRole: 'church-admin' }),
    });
    expect(res.status).toBe(201);

    const unscopedWarnings = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes('unscoped'),
    );
    expect(unscopedWarnings).toHaveLength(0);
  });
});

// ── issue-842-c2: curated default scope for generic profiles ───────────────

describe('syncOpencodeAgentProfiles — issue-842-c2 curated default scope', () => {
  beforeEach(() => {
    // NOTE: deliberately no vi.resetModules() here — a reset would give
    // dynamically re-imported '../../database/db' a fresh module instance
    // (and thus a fresh, uninitialized `_db` singleton) disconnected from the
    // `setDb()` call below, which uses the already-loaded top-level import.
    setDb(makeDb());
  });

  it('issue-842-c2: a brand-new generic (non-roled) profile is backfilled with a curated MULTI-SERVER default, not just rhythm+obsidian', async () => {
    // Bug this catches: the "curated default scope covering common tasks"
    // criterion regresses to the OLD narrow rhythm-only (or rhythm+obsidian
    // only) default, leaving generic agents unable to do common tasks (e.g.
    // reading a PDF attachment) without falling back to full unscoped access.
    const { opencodeClient } = await import('../../services/opencode_engine');
    vi.mocked(opencodeClient.listMcp).mockResolvedValue({
      rhythm: { status: 'connected' },
      obsidian: { status: 'connected' },
      'pdf-tools': { status: 'connected' },
    });
    const { syncOpencodeAgentProfiles } = await import('../agent_profile_sync');
    const { AgentConfigsRepository } = await import('../../repositories/agent_configs_repository');

    await syncOpencodeAgentProfiles([
      { name: 'newcomer-842', mode: 'primary', builtIn: false } as unknown as import('@opencode-ai/sdk').SdkAgent,
    ]);

    const row = new AgentConfigsRepository().getById('newcomer-842')!;
    expect(row.allowedMcpsJson).not.toBeNull();
    const scope = JSON.parse(row.allowedMcpsJson!) as string[];
    // Curated + generous: at minimum still covers rhythm + obsidian (existing
    // behavior), PLUS at least one more commonly-needed server (pdf-tools,
    // per the roled-agent survey — 4 of 13 roles grant it).
    expect(scope).toContain('rhythm');
    expect(scope).toContain('obsidian');
    expect(scope.length).toBeGreaterThan(2);
  });

  it('issue-842-c2: full surface remains available via explicit opt-in (no mcpRole/override on session-create)', async () => {
    // Bug this catches: "scoped by default" is implemented as "scoped, full
    // stop" — removing the escape hatch that lets a user deliberately request
    // full unscoped access for a one-off task.
    const { createApp } = await import('../../app');
    const { startTestServer } = await import('../../__tests__/helpers/real_server');
    const { baseUrl, close } = await startTestServer(createApp());
    try {
      const res = await fetch(`${baseUrl}/agent-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(BASE_PAYLOAD), // no mcpRole → unrestricted, still permitted
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.mcpRole).toBeNull();
      expect(body.mcpAllowedToolsJson).toBeNull();
    } finally {
      await close();
    }
  });
});
