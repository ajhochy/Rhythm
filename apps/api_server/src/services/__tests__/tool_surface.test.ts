/**
 * Acceptance-contract tests for issue #841 — Per-session tool-surface token report.
 *
 * These MUST fail on the unmodified codebase: `tool_surface_estimator.ts` and
 * `ToolSurfaceRepository` / `GET /agent-sessions/:id/tool-surface` do not exist yet.
 *
 * Criteria covered:
 *   issue-841-c1 — at session start or on demand, the local agent server
 *     records/exposes tool count + estimated schema tokens per server and a
 *     session total (chars/4 estimation fine).
 *   issue-841-c2 — queryable per session (GET /agent-sessions/:id/tool-surface)
 *     and logged as ONE structured line (no schema bodies in logs).
 *   issue-841-c3 — scoped vs unscoped sessions show materially different totals
 *     (role-scoped fixture test).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';

// ── issue-841-c1 / c3: pure estimator unit tests ────────────────────────────
import {
  estimateToolSurface,
  BUILTIN_TOOLS,
} from '../tool_surface_estimator';

const REAL_MCP_ROLES_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', '.mcp-roles');

describe('estimateToolSurface (issue-841 contract)', () => {
  it('issue-841-c1: reports a per-server tool count + estimated token cost, plus builtins, plus a session total', () => {
    // Bug this catches: the estimator omits per-server breakdown or fails to
    // sum to a total, leaving no visibility into which server dominates cost.
    const report = estimateToolSurface({
      mcpRole: 'secretary',
      mcpRolesDir: REAL_MCP_ROLES_DIR,
    });

    expect(report.servers.length).toBeGreaterThan(0);
    for (const server of report.servers) {
      expect(typeof server.name).toBe('string');
      expect(server.toolCount).toBeGreaterThan(0);
      expect(server.estimatedTokens).toBeGreaterThan(0);
    }
    expect(report.builtins.toolCount).toBeGreaterThan(0);
    expect(report.builtins.estimatedTokens).toBeGreaterThan(0);

    const sumOfParts =
      report.servers.reduce((acc, s) => acc + s.estimatedTokens, 0) +
      report.builtins.estimatedTokens;
    expect(report.totalEstimatedTokens).toBe(sumOfParts);
    expect(report.totalToolCount).toBe(
      report.servers.reduce((acc, s) => acc + s.toolCount, 0) + report.builtins.toolCount,
    );
  });

  it('issue-841-c1: chars/4 estimation — token estimate is derived from stringified schema length, not a magic constant', () => {
    // Bug this catches: a hardcoded per-tool token constant that doesn't scale
    // with the actual number/size of tools declared for a server — comparability
    // across roles would be meaningless.
    const smallRole = estimateToolSurface({
      mcpRole: 'secretary',
      mcpRolesDir: REAL_MCP_ROLES_DIR,
    });
    const devRole = estimateToolSurface({
      mcpRole: 'dev',
      mcpRolesDir: REAL_MCP_ROLES_DIR,
    });
    // dev.mcp.json grants "*" (all tools) on rhythm; secretary grants an
    // explicit 14-tool allowlist plus several other scoped servers. The two
    // shapes must not coincidentally produce the exact same estimate.
    expect(devRole.totalEstimatedTokens).not.toBe(smallRole.totalEstimatedTokens);
  });

  it('issue-841-c3: an unknown/unscoped role (mcpRole=null) reports a materially larger surface than a role-scoped session', () => {
    // Bug this catches: the estimator does not distinguish scoped from
    // unscoped sessions — e.g. it always reports the same fixed builtin-only
    // total regardless of mcpRole, which would defeat the entire point of
    // issue #841 (visibility into tool-surface cost) and issue #842 (showing
    // scoped-vs-unscoped savings).
    const unscoped = estimateToolSurface({
      mcpRole: null,
      mcpRolesDir: REAL_MCP_ROLES_DIR,
      // Simulates the full connected-server registry an unscoped session sees.
      connectedServerNames: [
        'rhythm',
        'obsidian',
        'pdf-tools',
        'gmail-work',
        'gmail-personal',
        'calendar',
      ],
    });
    const scoped = estimateToolSurface({
      mcpRole: 'secretary',
      mcpRolesDir: REAL_MCP_ROLES_DIR,
    });

    expect(unscoped.totalEstimatedTokens).toBeGreaterThan(scoped.totalEstimatedTokens);
    // "Materially different" — not just a few tokens off a rounding difference.
    expect(unscoped.totalEstimatedTokens).toBeGreaterThan(scoped.totalEstimatedTokens * 1.2);
    expect(unscoped.totalToolCount).toBeGreaterThan(scoped.totalToolCount);
  });

  it('issue-841-c1: builtins are counted even for a fully unscoped session with no MCP servers connected', () => {
    // Bug this catches: builtins silently disappear from the report when there
    // is no role file / no connected servers, undercounting the true floor cost.
    const report = estimateToolSurface({ mcpRole: null, mcpRolesDir: REAL_MCP_ROLES_DIR, connectedServerNames: [] });
    expect(report.servers).toHaveLength(0);
    expect(report.builtins.toolCount).toBe(BUILTIN_TOOLS.length);
    expect(report.totalEstimatedTokens).toBe(report.builtins.estimatedTokens);
  });
});

// ── issue-841-c2: HTTP route + structured single-line logging ──────────────
describe('GET /agent-sessions/:id/tool-surface (issue-841-c2 contract)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('issue-841-c2: returns the tool-surface report for a persisted session by id', async () => {
    // Bug this catches: no route exists (404), or the route recomputes from
    // request params instead of the session's actual persisted mcp_role /
    // mcp_allowed_tools_json — making the report not reflect the real session.
    process.env.AGENT_LOCAL = 'true';
    process.env.MCP_ROLES_DIR = REAL_MCP_ROLES_DIR;

    const Database = (await import('better-sqlite3')).default;
    const { runMigrations } = await import('../../database/migrations');
    const { setDb } = await import('../../database/db');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    const { AgentSessionsRepository } = await import(
      '../../repositories/agent_sessions_repository'
    );
    const repo = new AgentSessionsRepository();
    const session = repo.insert({
      agentKind: 'claude-code' as never,
      taskId: null,
      taskTitle: null,
      cwd: '/tmp/issue-841-fixture',
      name: 'tool-surface fixture',
      projectId: null,
      mcpRole: 'secretary',
      mcpAllowedToolsJson: JSON.stringify({
        rhythm: ['rhythm_ping', 'rhythm_list_tasks'],
      }),
    } as never);

    const { startTestServer } = await import('../../__tests__/helpers/real_server');
    const { createApp } = await import('../../app');
    const { baseUrl, close } = await startTestServer(createApp());
    try {
      const res = await fetch(`${baseUrl}/agent-sessions/${session.id}/tool-surface`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        sessionId: string;
        mcpRole: string | null;
        totalToolCount: number;
        totalEstimatedTokens: number;
        servers: Array<{ name: string; toolCount: number; estimatedTokens: number }>;
        builtins: { toolCount: number; estimatedTokens: number };
      };
      expect(body.sessionId).toBe(session.id);
      expect(body.mcpRole).toBe('secretary');
      expect(body.totalToolCount).toBeGreaterThan(0);
      expect(body.totalEstimatedTokens).toBeGreaterThan(0);
      expect(Array.isArray(body.servers)).toBe(true);
      expect(body.builtins.toolCount).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('issue-841-c2: unknown session id returns 404, not a synthesized report', async () => {
    // Bug this catches: the route falls back to computing an unscoped report
    // for a nonexistent session instead of failing with 404, hiding the fact
    // that no such session exists.
    process.env.AGENT_LOCAL = 'true';
    process.env.MCP_ROLES_DIR = REAL_MCP_ROLES_DIR;

    const Database = (await import('better-sqlite3')).default;
    const { runMigrations } = await import('../../database/migrations');
    const { setDb } = await import('../../database/db');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    const { startTestServer } = await import('../../__tests__/helpers/real_server');
    const { createApp } = await import('../../app');
    const { baseUrl, close } = await startTestServer(createApp());
    try {
      const res = await fetch(`${baseUrl}/agent-sessions/does-not-exist/tool-surface`);
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });

  it('issue-841-c2: logs exactly ONE structured line per report, with no raw schema bodies', async () => {
    // Bug this catches: the report handler either logs nothing (no audit
    // trail) or logs multiple lines / dumps full tool schema JSON into the
    // log (bloats logs with exactly the payload size problem #841 exists to
    // measure, and could leak tool descriptions into log aggregation).
    process.env.AGENT_LOCAL = 'true';
    process.env.MCP_ROLES_DIR = REAL_MCP_ROLES_DIR;

    const Database = (await import('better-sqlite3')).default;
    const { runMigrations } = await import('../../database/migrations');
    const { setDb } = await import('../../database/db');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    const { AgentSessionsRepository } = await import(
      '../../repositories/agent_sessions_repository'
    );
    const repo = new AgentSessionsRepository();
    const session = repo.insert({
      agentKind: 'claude-code' as never,
      taskId: null,
      taskTitle: null,
      cwd: '/tmp/issue-841-fixture-2',
      name: 'tool-surface log fixture',
      projectId: null,
      mcpRole: null,
      mcpAllowedToolsJson: null,
    } as never);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { startTestServer } = await import('../../__tests__/helpers/real_server');
      const { createApp } = await import('../../app');
      const { baseUrl, close } = await startTestServer(createApp());
      try {
        await fetch(`${baseUrl}/agent-sessions/${session.id}/tool-surface`);
      } finally {
        await close();
      }

      const toolSurfaceLines = logSpy.mock.calls.filter((call) =>
        String(call[0]).includes('[ToolSurface]'),
      );
      expect(toolSurfaceLines).toHaveLength(1);
      const logged = toolSurfaceLines[0].map((a) => String(a)).join(' ');
      // No schema bodies: description/schema keys must never appear in the log line.
      expect(logged).not.toMatch(/"description"/);
      expect(logged).not.toMatch(/"inputSchema"/);
      expect(logged).not.toMatch(/"parameters"/);
    } finally {
      logSpy.mockRestore();
    }
  });
});
