/**
 * Issue #765 — Secretary profile MCP scope must be ENFORCED at the initial
 * fork session creation, not merely handed to a mocked createSession.
 *
 * The prior contract test (the false-green this replaces) mocked
 * `opencodeClient.createSession` and asserted only that `mcpRoleConfig` was
 * passed and that `mcp_role` / `mcp_allowed_tools_json` were persisted. It
 * NEVER asserted that the resulting fork session actually excludes the
 * disallowed servers — so a broken wire produced a green test (postmortem
 * C2 + W5).
 *
 * This file closes that gap end-to-end:
 *   1. POST /agent-sessions (agentId='secretary') drives the REAL
 *      OpencodeClientService.createSession via the __setTestClient seam — the
 *      real expandMcpAllowlist runs and the real `body.mcpAllowlist` that
 *      would go on the wire is captured from the fake SDK transport.
 *   2. That captured allowlist is then fed into the FORK's own
 *      `filterMcpToolsByAllowlist` (the exact function prompt.ts:resolveTools
 *      uses to decide which MCP tool schemas are injected into model context)
 *      against a realistic multi-server tool catalog.
 *   3. We assert the RESOLVED TOOL SET excludes every disallowed server's
 *      tools and keeps only the Secretary-allowed ones.
 *
 * Regression caught: if the controller stops resolving the profile scope, or
 * createSession stops expanding/sending mcpAllowlist, the captured allowlist
 * goes back to "undefined" and filterMcpToolsByAllowlist passes ALL tools
 * through — the c1 assertion (gmail/pco tools absent) then fails. A
 * createSession-arg mock cannot catch that: it never exercises the filter that
 * actually gates the tools.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
// REAL singleton engine client — NOT mocked. We inject a fake SDK transport
// via __setTestClient so the real createSession body (and real
// expandMcpAllowlist) runs against an in-memory fake.
import { opencodeClient, opencodeSessionMap } from '../services/opencode_engine';
// The FORK's actual per-session tool gate. prompt.ts:resolveTools calls this
// exact function to decide which MCP tool schemas reach the model. We use a
// VENDORED verbatim copy (api_server's tsc rootDir forbids a cross-package
// import) and a runtime DRIFT GUARD (test below) asserting the vendored body
// matches the fork source — so this stays an end-to-end assertion against the
// real enforcement code, not a re-implementation that could silently drift.
import { filterMcpToolsByAllowlist } from './helpers/fork_mcp_allowlist_oracle';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Stream bridge is a pure side-effect we don't want in this test — stub it.
vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    dispose: vi.fn(),
  },
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ───────────────────────────────────────────────────────────────────────────
// A faithful fake fork session.
//
// The real fork: session.create(body) persists body.mcpAllowlist on the
// session row; later prompt.ts:resolveTools reads it and filters the live MCP
// tool catalog through filterMcpToolsByAllowlist before injecting schemas.
//
// This fake mirrors exactly that contract: session.create captures the
// allowlist on the created session record; resolveTools(catalog) applies the
// REAL filterMcpToolsByAllowlist with the SAME server-membership semantics the
// fork uses (servers[] = raw client name, tools[] = sanitized <server>_<tool>).
// Only the network boundary is faked; the scoping logic is the production one.
// ───────────────────────────────────────────────────────────────────────────

/** A realistic catalog spanning three MCP servers (composedKey → rawServer). */
const TOOL_CATALOG_KEY_TO_SERVER: Record<string, string> = {
  // rhythm (the only Secretary-allowed server)
  rhythm_rhythm_list_tasks: 'rhythm',
  rhythm_rhythm_create_task: 'rhythm',
  // gmail-personal (DISALLOWED for Secretary)
  'gmail-personal_send_email': 'gmail-personal',
  'gmail-personal_search_emails': 'gmail-personal',
  // pco-services (DISALLOWED for Secretary)
  'pco-services_get_plans': 'pco-services',
};

class FakeForkSession {
  /** The allowlist persisted on the most-recently-created session, if any. */
  lastMcpAllowlist: { servers: string[]; tools: string[] } | undefined;
  /** Captured raw body of the most recent session.create call. */
  lastBody: Record<string, unknown> | undefined;

  readonly session = {
    create: (opts: { body: Record<string, unknown>; query?: { directory?: string } }) => {
      this.lastBody = opts.body;
      // Mirror the fork: persist body.mcpAllowlist onto the session record.
      this.lastMcpAllowlist = opts.body.mcpAllowlist as
        | { servers: string[]; tools: string[] }
        | undefined;
      return Promise.resolve({ data: { id: 'sdk-secretary-scope' } });
    },
  };

  /**
   * Resolve the MCP tool set the model would actually be offered for the
   * created session — exactly as prompt.ts:resolveTools does: filter the live
   * catalog through the REAL filterMcpToolsByAllowlist using the persisted
   * allowlist.
   */
  resolveToolSet(): string[] {
    return filterMcpToolsByAllowlist(
      Object.keys(TOOL_CATALOG_KEY_TO_SERVER),
      TOOL_CATALOG_KEY_TO_SERVER,
      this.lastMcpAllowlist,
    );
  }
}

describe('issue-765: Secretary profile MCP scope enforced at fork session creation', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;
  let fakeFork: FakeForkSession;

  beforeEach(async () => {
    setDb(makeDb());
    opencodeSessionMap.clear();

    // Inject the faithful fake fork transport into the REAL engine client so
    // createSession runs its real body (expandMcpAllowlist → body.mcpAllowlist).
    fakeFork = new FakeForkSession();
    opencodeClient.__setTestClient(fakeFork as unknown as Parameters<typeof opencodeClient.__setTestClient>[0]);

    const user = new UsersRepository().create({
      name: 'Secretary Scope Test',
      email: 'secretary-scope@example.com',
    });
    const authSession = await new SessionsRepository().createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${authSession.token}`,
      'Content-Type': 'application/json',
    };

    // Secretary profile: allowed to use ONLY the rhythm MCP server.
    new AgentConfigsRepository().insert({
      id: 'secretary',
      label: 'Secretary',
      icon: '🗂️',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });
    // A second profile with NO allowlist (for c2 — unrestricted).
    new AgentConfigsRepository().insert({
      id: 'unrestricted',
      label: 'Unrestricted',
      icon: '🛠️',
      allowedMcpsJson: null,
    });

    const server = createApp().listen(0);
    server.maxRequestsPerSocket = 1;
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  async function createSession(body: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
    });
    return response;
  }

  it('issue-765-c1: the resolved MCP tool set of the created Secretary session EXCLUDES disallowed servers', async () => {
    const response = await createSession({
      agentId: 'secretary',
      cwd: os.homedir(),
      name: 'Secretary scope contract',
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };

    // ── End-to-end assertion: the RESOLVED tool set, not a createSession arg ──
    const resolved = fakeFork.resolveToolSet();

    // The Secretary-allowed server's tools survive.
    expect(resolved).toContain('rhythm_rhythm_list_tasks');
    expect(resolved).toContain('rhythm_rhythm_create_task');

    // Every disallowed server's tools are ABSENT from the live session.
    expect(resolved).not.toContain('gmail-personal_send_email');
    expect(resolved).not.toContain('gmail-personal_search_emails');
    expect(resolved).not.toContain('pco-services_get_plans');

    // Stronger: no resolved tool belongs to a non-allowed server.
    for (const key of resolved) {
      expect(TOOL_CATALOG_KEY_TO_SERVER[key]).toBe('rhythm');
    }

    // And the wire genuinely carried an allowlist (guards against the
    // "undefined allowlist → everything passes" back-compat path masking a
    // non-enforcement regression as a green test).
    expect(fakeFork.lastMcpAllowlist).toBeDefined();
    expect(fakeFork.lastMcpAllowlist?.servers).toContain('rhythm');
    expect(fakeFork.lastMcpAllowlist?.servers).not.toContain('gmail-personal');
    expect(fakeFork.lastMcpAllowlist?.servers).not.toContain('pco-services');

    // Persistence (kept from the original contract — still required by AC).
    const persisted = new AgentSessionsRepository().findById(created.id);
    expect(persisted?.mcpRole).toBe('secretary');
    expect(persisted?.mcpAllowedToolsJson).toBe(JSON.stringify(['rhythm']));
  });

  it('issue-765-drift-guard: vendored filter body is byte-identical to the fork source', () => {
    // If the fork's enforcement function ever changes, the vendored oracle this
    // end-to-end test relies on must change too — otherwise the test would be
    // asserting against stale logic. Read the fork source and the vendored copy,
    // extract each function body, and require an exact match.
    const repoRoot = join(__dirname, '..', '..', '..', '..');
    const forkSrc = readFileSync(
      join(
        repoRoot,
        'apps/opencode_fork/packages/opencode/src/session/mcp_allowlist.ts',
      ),
      'utf8',
    );
    const vendoredSrc = readFileSync(
      join(__dirname, 'helpers', 'fork_mcp_allowlist_oracle.ts'),
      'utf8',
    );

    const extractBody = (src: string): string => {
      const start = src.indexOf('export function filterMcpToolsByAllowlist');
      expect(start).toBeGreaterThanOrEqual(0);
      const open = src.indexOf('{', start);
      // Walk braces to find the matching close of the function body.
      let depth = 0;
      let end = -1;
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      expect(end).toBeGreaterThan(open);
      // Normalize whitespace so formatting (tabs vs spaces, trailing) is not
      // what's under test — the LOGIC is.
      return src.slice(open + 1, end).replace(/\s+/g, ' ').trim();
    };

    expect(extractBody(vendoredSrc)).toBe(extractBody(forkSrc));
  });

  it('issue-765-c2: a profile with no allowed_mcps_json stays unrestricted — all servers resolve', async () => {
    const response = await createSession({
      agentId: 'unrestricted',
      cwd: os.homedir(),
      name: 'Unrestricted scope contract',
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };

    // No allowlist on the wire → fork passes the full catalog through.
    expect(fakeFork.lastMcpAllowlist).toBeUndefined();
    const resolved = fakeFork.resolveToolSet();
    expect(resolved).toEqual(Object.keys(TOOL_CATALOG_KEY_TO_SERVER));
    // Disallowed-for-secretary servers are present here (proves no invented scope).
    expect(resolved).toContain('gmail-personal_send_email');
    expect(resolved).toContain('pco-services_get_plans');

    // And no MCP role / allowlist invented on the persisted row.
    const persisted = new AgentSessionsRepository().findById(created.id);
    expect(persisted?.mcpRole).toBeNull();
    expect(persisted?.mcpAllowedToolsJson).toBeNull();
  });

  it('issue-765-c3: an explicit mcpRole in the request overrides the profile allowlist', async () => {
    // The Secretary profile allows only the rhythm server (all tools). An
    // explicit mcpRole='email-assistant' grants rhythm but ONLY a specific
    // subset of rhythm tools (an allowedTools list). Precedence is proven two
    // ways: (1) the persisted mcp_role is 'email-assistant', not 'secretary';
    // (2) the resolved tool set reflects the EXPLICIT role's exact tool grants,
    // which differ from the secretary profile's "all rhythm tools".
    //
    // The controller resolves .mcp-roles/<slug>.mcp.json relative to __dirname
    // (repo root), independent of the test's cwd. Skip only if the role file is
    // genuinely absent from this checkout.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const repoRoot = path.join(__dirname, '..', '..', '..', '..');
    const explicitSlug = 'email-assistant';
    const roleFilePath = path.join(repoRoot, '.mcp-roles', `${explicitSlug}.mcp.json`);
    expect(fs.existsSync(roleFilePath)).toBe(true); // guard: role file must exist

    const response = await createSession({
      agentId: 'secretary',
      cwd: os.homedir(),
      name: 'Explicit role overrides profile',
      mcpRole: explicitSlug,
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };

    // Precedence at the persisted layer: the EXPLICIT role wins over 'secretary'.
    const persisted = new AgentSessionsRepository().findById(created.id);
    expect(persisted?.mcpRole).toBe(explicitSlug);
    expect(persisted?.mcpRole).not.toBe('secretary');

    // Precedence on the wire: the allowlist sent to the fork is the explicit
    // role's tool-grant list (tools[]), not the secretary profile's
    // "rhythm server, all tools" (servers[] contains 'rhythm').
    const allowlist = fakeFork.lastMcpAllowlist;
    expect(allowlist).toBeDefined();
    // email-assistant uses an allowedTools list → composed tool ids in tools[],
    // and 'rhythm' is NOT a blanket server grant (that would be the secretary
    // profile's shape).
    expect(allowlist?.tools).toContain('rhythm_rhythm_search_gmail');
    expect(allowlist?.servers).not.toContain('rhythm');
  });
});
