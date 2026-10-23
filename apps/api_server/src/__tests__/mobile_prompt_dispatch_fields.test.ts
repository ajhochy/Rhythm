import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { asOpenCodeAgentId } from '../models/agent_session';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { MobileOpenCodeOwnershipRepository } from '../repositories/mobile_opencode_ownership_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';

let db: Database.Database;
let previousDb: Database.Database | null;
let previousDbClient: 'sqlite' | 'postgres';
let scratchRoot: string;
let project: { id: string; root: string };
let userId: number;
let ownership: MobileOpenCodeOwnershipRepository;
let savedMemoryFlag: string | undefined;

const SDK_ID = 'sdk-dispatch-fields';

function seedSession(fields: { thinkingBudget?: number | null; fastMode?: boolean }) {
  const repo = new AgentSessionsRepository();
  const session = repo.reconcileMobileSession({
    sdkSessionId: SDK_ID,
    ownerUserId: userId,
    projectId: project.id,
    cwd: project.root,
    name: 'Dispatch fields',
    archivedAt: null,
    opencodeAgentId: asOpenCodeAgentId('claude-code'),
    providerId: 'anthropic',
    modelId: 'claude-test',
  });
  if (!session) throw new Error('session not created');
  repo.updateFields(session.id, { modelMode: 'fixed', ...fields });
  expect(ownership.claimResource('session', SDK_ID, userId, project.id)).toBe(true);
}

async function sendPrompt(extraBody: Record<string, unknown> = {}) {
  const bodies: Array<Record<string, unknown>> = [];
  const messages = new Map<string, unknown>();
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/session' && init?.method === 'GET') {
      return Response.json([{ id: SDK_ID, directory: project.root }]);
    }
    if (url.pathname.includes('/message/') && init?.method === 'GET') {
      const m = messages.get(decodeURIComponent(url.pathname.split('/').at(-1)!));
      return m ? Response.json(m) : Response.json({ error: 'missing' }, { status: 404 });
    }
    if (url.pathname.endsWith('/prompt_async') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      bodies.push(body);
      if (typeof body.messageID === 'string') {
        messages.set(body.messageID, {
          info: { id: body.messageID, sessionID: SDK_ID, role: 'user' },
          parts: [],
        });
      }
      return new Response(null, { status: 204 });
    }
    return Response.json(url.pathname === '/session/status' ? {} : []);
  });
  const proxy = new MobileOpenCodeProxy({
    baseUrl: 'http://engine.synthetic.invalid',
    fetchFn,
    ownershipRepository: ownership,
    preparePromptStream: vi.fn(async () => undefined),
  });
  const result = await proxy.forward({
    method: 'POST',
    path: `/session/${SDK_ID}/prompt_async`,
    query: new URLSearchParams(),
    body: {
      agent: 'claude-code',
      model: { providerID: 'anthropic', modelID: 'claude-test' },
      parts: [{ type: 'text', text: 'hello' }],
      ...extraBody,
    },
    project,
    userId,
  });
  expect(result.status).toBe(204);
  expect(bodies).toHaveLength(1);
  return bodies[0];
}

beforeEach(() => {
  savedMemoryFlag = process.env.AGENT_MEMORY_INJECTION_ENABLED;
  process.env.AGENT_MEMORY_INJECTION_ENABLED = 'false';
  scratchRoot = mkdtempSync(path.join(tmpdir(), 'mobile-dispatch-fields-'));
  previousDbClient = env.dbClient;
  (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = 'sqlite';
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  previousDb = setDb(db);
  userId = new UsersRepository().create({ name: 'Owner', email: 'o@example.invalid' }).id;
  const root = path.join(scratchRoot, 'project');
  mkdirSync(root, { recursive: true });
  const saved = new ProjectsRepository().insert({
    name: 'P',
    cwd: root,
    icon: null,
    vcs: { vcsRoot: null, vcsBranch: null, vcsDirty: false, vcsCheckedAt: null },
  });
  project = { id: saved.id, root: saved.cwd };
  ownership = new MobileOpenCodeOwnershipRepository(db);
});

afterEach(() => {
  vi.restoreAllMocks();
  setDb(previousDb);
  db.close();
  (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = previousDbClient;
  if (savedMemoryFlag === undefined) delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
  else process.env.AGENT_MEMORY_INJECTION_ENABLED = savedMemoryFlag;
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe('mobile prompt_async dispatch fields', () => {
  it('forwards persisted thinking budget and Fast mode to the engine', async () => {
    seedSession({ thinkingBudget: 2048, fastMode: true });
    const body = await sendPrompt();
    expect(body.reasoningConfig).toEqual({ type: 'enabled', budgetTokens: 2048 });
    expect(body.fastMode).toBe(true);
  });

  it('omits both fields when the session has none', async () => {
    seedSession({ thinkingBudget: 0, fastMode: false });
    const body = await sendPrompt();
    expect(body).not.toHaveProperty('reasoningConfig');
    expect(body).not.toHaveProperty('fastMode');
  });

  it('persisted values win over client-supplied fields', async () => {
    seedSession({ thinkingBudget: 2048, fastMode: true });
    const body = await sendPrompt({
      fastMode: false,
      reasoningConfig: { type: 'enabled', budgetTokens: 1 },
    });
    expect(body.fastMode).toBe(true);
    expect(body.reasoningConfig).toEqual({ type: 'enabled', budgetTokens: 2048 });
  });
});
