import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';

const ownership = {
  isResourceOwnedBy: () => true,
  claimResource: () => true,
  releaseResource: () => true,
};

let db: Database.Database;
let previousDb: Database.Database | null;
let projectRoot: string;

function recordManagedHistory(id: string, sdkSessionId = 'sdk-managed'): void {
  const now = '2026-10-03T00:00:00.000Z';
  db.prepare(`INSERT INTO agent_turn_dispatches (
    id, session_id, sdk_session_id, sdk_user_message_id, origin,
    requested_source, route_authed, outcome, created_at, updated_at,
    managed_context_schema_version, managed_context_sdk_session_id
  ) VALUES (?, 'local-session', ?, 'user-message', 'prompt_api',
    'caller', 1, 'accepted', ?, ?, 1, ?)`).run(
    id,
    sdkSessionId,
    now,
    now,
    sdkSessionId,
  );
}

function sessionOperationInput(path: string, body: Record<string, unknown>) {
  return {
    method: 'POST',
    path,
    query: new URLSearchParams(),
    body,
    project: { id: 'project-1', root: projectRoot },
    userId: 41,
  };
}

function promptInput() {
  return sessionOperationInput('/session/sdk-managed/prompt_async', {
    parts: [{ type: 'text', text: 'ordinary mobile follow-up' }],
  });
}

function upstreamWithoutPrompt() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/session' && init?.method === 'GET') {
      return new Response(JSON.stringify([{
        id: 'sdk-managed',
        directory: projectRoot,
      }]), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/session/status' && init?.method === 'GET') {
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected upstream call: ${url.pathname}`);
  });
}

function ordinaryHistoryUpstream() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === 'GET' && url.pathname === '/session') {
      return new Response(JSON.stringify([{
        id: 'sdk-managed',
        directory: projectRoot,
      }]), { headers: { 'Content-Type': 'application/json' } });
    }
    if (init?.method === 'POST' && url.pathname.startsWith('/session/sdk-managed/')) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected upstream call: ${init?.method ?? 'GET'} ${url.pathname}`);
  });
}

describe('mobile managed SDK-session inference boundary', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    previousDb = setDb(db);
    projectRoot = mkdtempSync(join(tmpdir(), 'rhythm-s3-mobile-prompt-'));
    db.prepare(`INSERT INTO users (id, name, email)
      VALUES (41, 'Owner', 'owner@example.test')`).run();
    db.prepare(`INSERT INTO projects (id, name, cwd, created_at)
      VALUES ('project-1', 'Project', ?, '2026-10-03T00:00:00.000Z')`)
      .run(projectRoot);
    db.prepare(`INSERT INTO agent_sessions (
      id, agent_kind, status, cwd, name, owner_user_id, project_id, sdk_session_id
    ) VALUES ('local-session', 'build', 'running', ?, 'Managed worker',
      41, 'project-1', 'sdk-managed')`).run(projectRoot);
  });

  afterEach(() => {
    setDb(previousDb);
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('refuses the supported ordinary mobile prompt for an SDK session with historic managed enrollment', async () => {
    recordManagedHistory('managed-before-mobile-prompt');
    const upstream = upstreamWithoutPrompt();
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      fetchFn: upstream,
      ownershipRepository: ownership,
    });

    await expect(proxy.forward(promptInput())).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECONCILIATION_REQUIRED',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('withholds mobile inference when the local managed ledger is unreadable despite a sticky nonreuse marker', async () => {
    db.prepare(`UPDATE agent_sessions
      SET managed_context_nonreuse_code='binding_ambiguous',
          managed_context_nonreuse_at='2026-10-03T00:00:00.000Z'
      WHERE id='local-session'`).run();
    db.exec('DROP TABLE agent_turn_dispatches');
    const upstream = upstreamWithoutPrompt();
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      fetchFn: upstream,
      ownershipRepository: ownership,
    });

    await expect(proxy.forward(promptInput())).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECONCILIATION_REQUIRED',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    {
      operation: 'session.command',
      path: '/session/sdk-managed/command',
      body: { command: '/help', arguments: '' },
    },
    {
      operation: 'session.summarize',
      path: '/session/sdk-managed/summarize',
      body: { providerID: 'provider', modelID: 'model' },
    },
    {
      operation: 'session.fork',
      path: '/session/sdk-managed/fork',
      body: {},
    },
    {
      operation: 'session.init',
      path: '/session/sdk-managed/init',
      body: { providerID: 'provider', modelID: 'model', messageID: 'message-1' },
    },
    {
      operation: 'session.shell',
      path: '/session/sdk-managed/shell',
      body: { command: 'pwd', agent: 'worker' },
    },
  ])('refuses supported mobile $operation before the history-bearing forward', async ({ path, body }) => {
    recordManagedHistory(`managed-before-${path}`);
    const upstream = upstreamWithoutPrompt();
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      fetchFn: upstream,
      ownershipRepository: ownership,
    });

    await expect(proxy.forward(sessionOperationInput(path, body))).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECONCILIATION_REQUIRED',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    {
      operation: 'session.prompt_async',
      path: '/session/sdk-managed/prompt_async',
      input: () => promptInput(),
    },
    {
      operation: 'session.command',
      path: '/session/sdk-managed/command',
      input: () => sessionOperationInput('/session/sdk-managed/command', {
        command: '/help', arguments: '',
      }),
    },
    {
      operation: 'session.summarize',
      path: '/session/sdk-managed/summarize',
      input: () => sessionOperationInput('/session/sdk-managed/summarize', {
        providerID: 'provider', modelID: 'model',
      }),
    },
    {
      operation: 'session.fork',
      path: '/session/sdk-managed/fork',
      input: () => sessionOperationInput('/session/sdk-managed/fork', {}),
    },
    {
      operation: 'session.init',
      path: '/session/sdk-managed/init',
      input: () => sessionOperationInput('/session/sdk-managed/init', {
        providerID: 'provider', modelID: 'model', messageID: 'message-1',
      }),
    },
    {
      operation: 'session.shell',
      path: '/session/sdk-managed/shell',
      input: () => sessionOperationInput('/session/sdk-managed/shell', {
        command: 'pwd', agent: 'worker',
      }),
    },
  ])('R3: forwards ordinary PostgreSQL mobile $operation through existing authorization without a local-ledger classification', async ({ path, input }) => {
    const upstream = ordinaryHistoryUpstream();
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      fetchFn: upstream,
      ownershipRepository: ownership,
      preparePromptStream: async () => undefined,
    });
    const mutableEnv = env as { dbClient: 'sqlite' | 'postgres'; workstreamsEnabled: boolean };
    const previousDbClient = mutableEnv.dbClient;
    const previousWorkstreamsEnabled = mutableEnv.workstreamsEnabled;
    mutableEnv.dbClient = 'postgres';
    mutableEnv.workstreamsEnabled = false;
    try {
      await expect(proxy.forward(input())).resolves.toMatchObject({ status: 204 });
    } finally {
      mutableEnv.dbClient = previousDbClient;
      mutableEnv.workstreamsEnabled = previousWorkstreamsEnabled;
    }

    expect(upstream.mock.calls.some(([request, init]) =>
      init?.method === 'POST' && new URL(String(request)).pathname === path)).toBe(true);
  });

  it('rechecks after awaited mobile preparation before forwarding inference', async () => {
    const upstream = upstreamWithoutPrompt();
    const preparePromptStream = vi.fn(async () => {
      recordManagedHistory('managed-during-mobile-preparation');
    });
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4897',
      fetchFn: upstream,
      ownershipRepository: ownership,
      preparePromptStream,
    });

    await expect(proxy.forward(promptInput())).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECONCILIATION_REQUIRED',
    });
    expect(preparePromptStream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls.some(([input]) =>
      new URL(String(input)).pathname.endsWith('/prompt_async'))).toBe(false);
  });

});
