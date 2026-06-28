/**
 * OPC-M4-4 — Custom agent/mode selection.
 * Issue #703, criteria c1 and c2.
 *
 * c1 — GET /agent-sessions/agents returns the SDK-reported agent list for a
 *      cwd, via a vitest spy + real-shape fixture that includes a custom agent
 *      entry alongside the built-in build/plan agents.
 *
 * c2 — WS `session.input` carrying an `agent` field forwards it on the SDK
 *      promptAsync call (spy assert: 7th positional arg === 'plan').
 *
 * Route choice (c1): the agent list endpoint is registered at
 * GET /agent-sessions/agents (on the agent_sessions router, not a separate
 * router). This keeps all agent-session affordances under one router and
 * avoids creating a standalone file for a single GET. The path is documented
 * in apps/api_server/src/routes/agent_sessions_routes.ts.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_m4_4_agent_selection.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import os from 'os';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Shared mocks (hoisted so vi.mock factories can use them)
// ---------------------------------------------------------------------------

const {
  listAgentsSpy,
  promptAsyncSpy,
  sessionMap,
  wsSendMock,
} = vi.hoisted(() => ({
  listAgentsSpy: vi.fn(),
  promptAsyncSpy: vi.fn().mockResolvedValue(true),
  sessionMap: new Map<string, string>(),
  wsSendMock: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listAgents: listAgentsSpy,
    promptAsync: promptAsyncSpy,
    createSession: vi.fn().mockResolvedValue(null),
    getSession: vi.fn().mockResolvedValue(null),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    dispatchCommand: vi.fn().mockResolvedValue(null),
    statusMessage: 'ready',
    listCommands: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn(),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    getPendingPermission: vi.fn(),
    clearPendingPermission: vi.fn(),
  },
}));

vi.mock('../services/agent_model_resolver', () => ({
  resolveModelForSessionTurn: vi.fn().mockResolvedValue({
    providerID: 'anthropic',
    modelID: 'claude-sonnet-4-5',
  }),
}));

// auth middleware bypass
vi.mock('../config/env', () => ({
  env: {
    agentLocal: true,
    agentExecutionEnabled: true,
    role: 'local',
    corsAllowedOrigins: [],
    jwtSecret: 'test-secret',
  },
}));

import { createApp } from '../app';
import { handleInputFrame } from '../services/ws_gateway';

// ---------------------------------------------------------------------------
// Real-shape fixtures
// ---------------------------------------------------------------------------

/** Fixture: SDK-reported agents list including a custom agent. */
const AGENTS_FIXTURE = [
  {
    name: 'build',
    description: 'Default agent for coding tasks',
    mode: 'primary' as const,
    builtIn: true,
    permission: {
      edit: 'ask' as const,
      bash: {},
    },
  },
  {
    name: 'plan',
    description: 'Planning agent — read-only, no edits',
    mode: 'primary' as const,
    builtIn: true,
    permission: {
      edit: 'deny' as const,
      bash: {},
    },
  },
  {
    name: 'my-custom-agent',
    description: 'Custom agent defined in .opencode.json',
    mode: 'primary' as const,
    builtIn: false,
    permission: {
      edit: 'ask' as const,
      bash: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  return db;
}

function makeFakeWs() {
  return {
    send: wsSendMock,
    readyState: 1 /* OPEN */,
  } as unknown as import('ws').WebSocket;
}

// ---------------------------------------------------------------------------
// Tests — c1: agent list endpoint
// ---------------------------------------------------------------------------

describe('issue-703-c1: GET /agent-sessions/agents returns SDK-reported agent list including custom agent', () => {
  let baseUrl: string;
  let server: ReturnType<typeof import('http').createServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    makeDb();

    listAgentsSpy.mockResolvedValue(AGENTS_FIXTURE);

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://localhost:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('issue-703-c1: GET /agent-sessions/agents returns SDK-reported agent list including custom agent', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/agents`);
    expect(res.status).toBe(200);
    const body = await res.json() as { agents: Array<{ name: string; builtIn: boolean; description?: string }> };

    // Response must have an `agents` array
    expect(Array.isArray(body.agents)).toBe(true);

    // Must include built-in build and plan
    const names = body.agents.map((a) => a.name);
    expect(names).toContain('build');
    expect(names).toContain('plan');

    // Must include the custom agent from the fixture
    expect(names).toContain('my-custom-agent');

    // Custom agent must be marked as non-built-in
    const custom = body.agents.find((a) => a.name === 'my-custom-agent');
    expect(custom?.builtIn).toBe(false);

    // listAgents was called exactly once (the typed wrapper was invoked)
    expect(listAgentsSpy).toHaveBeenCalledOnce();
  });

  it('issue-703-c1b: GET /agent-sessions/agents returns built-ins only when no custom agents', async () => {
    listAgentsSpy.mockResolvedValue([
      AGENTS_FIXTURE[0]!,  // build
      AGENTS_FIXTURE[1]!,  // plan
    ]);

    const res = await fetch(`${baseUrl}/agent-sessions/agents`);
    expect(res.status).toBe(200);
    const body = await res.json() as { agents: Array<{ name: string }> };
    expect(body.agents).toHaveLength(2);
    const names = body.agents.map((a) => a.name);
    expect(names).toContain('build');
    expect(names).toContain('plan');
    expect(names).not.toContain('my-custom-agent');
  });
});

// ---------------------------------------------------------------------------
// Tests — c2: promptAsync receives the agent field from session.input WS frame
// ---------------------------------------------------------------------------

describe('issue-703-c2: session.input with agent field forwards agent to promptAsync', () => {
  let sessionsRepo: AgentSessionsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    makeDb();
    sessionsRepo = new AgentSessionsRepository();
  });

  it('issue-703-c2: session.input agent:plan is forwarded as opts.agent to promptAsync', async () => {
    const sdkId = 'sdk-m4-4-agent-fwd';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'AgentForwardTest',
    });
    sessionMap.set(session.id, sdkId);

    const ws = makeFakeWs();
    await handleInputFrame(ws, {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'plan this out\n',
      agent: 'plan',
    });

    // promptAsync must have been called
    expect(promptAsyncSpy).toHaveBeenCalledOnce();

    // The 5th arg (opts) must carry agent:'plan'
    const [, , , , opts] = promptAsyncSpy.mock.calls[0] as [
      string,
      string,
      unknown,
      unknown,
      Record<string, unknown> | undefined,
    ];

    expect(opts).toBeDefined();
    expect(opts!.agent).toBe('plan');
  });

  it('issue-703-c2b: session.input without agent field does not inject agent into opts', async () => {
    const sdkId = 'sdk-m4-4-no-agent';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'NoAgentTest',
    });
    sessionMap.set(session.id, sdkId);

    const ws = makeFakeWs();
    await handleInputFrame(ws, {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'hello\n',
    });

    expect(promptAsyncSpy).toHaveBeenCalledOnce();
    const [, , , , opts] = promptAsyncSpy.mock.calls[0] as [
      string,
      string,
      unknown,
      unknown,
      Record<string, unknown> | undefined,
    ];

    // opts may be undefined or may have thinking/fastMode keys but MUST NOT have 'agent'
    expect(opts?.agent).toBeUndefined();
  });
});
