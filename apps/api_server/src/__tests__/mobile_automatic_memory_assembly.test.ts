import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env, resolveMemoryDirPath } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { asOpenCodeAgentId } from '../models/agent_session';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { AgentSessionMemoryProvenanceRepository } from '../repositories/agent_session_memory_provenance_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { MobileOpenCodeOwnershipRepository } from '../repositories/mobile_opencode_ownership_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import { EngraphHttpClient } from '../services/engraph_client';
import { engraphManager } from '../services/engraph_manager';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';

const MEMORY_ENV_KEYS = [
  'HOME',
  'MEMORY_VAULT_PATH',
  'MEMORY_VAULT_SUBDIR',
  'ENGRAPH_MEMORY_VAULT_ROOT',
  'AGENT_MEMORY_INJECTION_ENABLED',
  'AGENT_MEMORY_RETRIEVAL_MODE',
  'AGENT_MEMORY_LINK_EXPANSION_ENABLED',
  'AGENT_DECISION_MEMORY_RANKING',
] as const;

const CANONICAL_CONTENT =
  'For church announcements, reuse verified clips when details remain incomplete. Confirm every posted time before sharing.';
const FOREIGN_CONTENT =
  'Foreign owner material must never be injected for another authenticated mobile caller in this synthetic regression.';
const GENERIC_ANNOUNCEMENT_QUERY = (
  'Read this church announcement request safely and provide only a concise summary of approved sharing preferences; do not make edits, send messages, or contact anyone. '
).repeat(3).slice(0, 324);
const CLIENT_SYSTEM = 'Use the caller selected concise response style.';

let db: Database.Database;
let previousDb: Database.Database | null;
let previousDbClient: 'sqlite' | 'postgres';
let scratchRoot: string;
let project: { id: string; root: string };
let ownerOne: number;
let ownerTwo: number;
let ownership: MobileOpenCodeOwnershipRepository;
let memoryRepo: AgentMemoryRepository;
let savedEnv: Record<(typeof MEMORY_ENV_KEYS)[number], string | undefined>;

function writeCanonicalMemory(sourceId: string, content: string): void {
  const file = path.join(resolveMemoryDirPath(), sourceId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `---\nkind: preference\nstatus: stable\ninjectable: true\n---\n${content}\n`,
  );
}

async function seedMemory(input: {
  sourceId: string;
  content: string;
  ownerUserId?: number;
}) {
  const row = {
    kind: 'preference',
    content: input.content,
    source: 'obsidian-memory',
    sourceId: input.sourceId,
    autoInjectable: true,
  };
  return input.ownerUserId === undefined
    ? memoryRepo.createAsync(row)
    : memoryRepo.createAsync({ ...row, ownerUserId: input.ownerUserId });
}

function reconcileMobileSession(
  sdkSessionId: string,
  ownerUserId = ownerOne,
) {
  const session = new AgentSessionsRepository().reconcileMobileSession({
    sdkSessionId,
    ownerUserId,
    projectId: project.id,
    cwd: project.root,
    name: 'Synthetic mobile chat',
    archivedAt: null,
    opencodeAgentId: asOpenCodeAgentId('claude-code'),
    providerId: 'anthropic',
    modelId: 'claude-test',
  });
  if (!session) throw new Error('synthetic mobile session was not created');
  new AgentSessionsRepository().updateFields(session.id, { modelMode: 'fixed' });
  return new AgentSessionsRepository().findById(session.id)!;
}

function claimSession(sdkSessionId: string, ownerUserId = ownerOne): void {
  expect(ownership.claimResource('session', sdkSessionId, ownerUserId, project.id)).toBe(true);
}

function makeNativeClient(results: unknown[], requests: unknown[]) {
  const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? '{}')));
    return Response.json({ results });
  });
  return new EngraphHttpClient('http://127.0.0.1:7777', fetchImpl);
}

function makeEngine(sessionIds: string[]) {
  const messages = new Map<string, unknown>();
  const forwardedBodies: Array<Record<string, unknown>> = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/session' && init?.method === 'GET') {
      return Response.json(sessionIds.map((id) => ({ id, directory: project.root })));
    }
    if (url.pathname.includes('/message/') && init?.method === 'GET') {
      const messageId = decodeURIComponent(url.pathname.split('/').at(-1)!);
      const message = messages.get(messageId);
      return message
        ? Response.json(message)
        : Response.json({ error: 'missing' }, { status: 404 });
    }
    if (url.pathname === '/session/status' && init?.method === 'GET') {
      return Response.json({});
    }
    if (url.pathname.endsWith('/prompt_async') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      forwardedBodies.push(body);
      const messageId = typeof body.messageID === 'string' ? body.messageID : null;
      if (messageId) {
        const sessionId = decodeURIComponent(url.pathname.split('/').at(-2)!);
        messages.set(messageId, {
          info: { id: messageId, sessionID: sessionId, role: 'user' },
          parts: [],
        });
      }
      return new Response(null, { status: 204 });
    }
    return Response.json([]);
  });
  const preparePromptStream = vi.fn(async () => undefined);
  return {
    fetchFn,
    forwardedBodies,
    messages,
    preparePromptStream,
    proxy: new MobileOpenCodeProxy({
      baseUrl: 'http://engine.synthetic.invalid',
      fetchFn,
      ownershipRepository: ownership,
      preparePromptStream,
    }),
  };
}

function promptInput(sdkSessionId: string, extraBody: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    path: `/session/${sdkSessionId}/prompt_async`,
    query: new URLSearchParams(),
    body: {
      agent: 'claude-code',
      model: { providerID: 'anthropic', modelID: 'claude-test' },
      system: CLIENT_SYSTEM,
      parts: [
        { type: 'text', text: GENERIC_ANNOUNCEMENT_QUERY },
        { type: 'text', text: 'Synthetic non-user text must not affect retrieval.', synthetic: true },
        { type: 'file', mime: 'text/plain', filename: 'synthetic.txt', url: 'data:text/plain;base64,c3ludGhldGlj' },
      ],
      ...extraBody,
    },
    project,
    userId: ownerOne,
  };
}

function memorySystem(body: Record<string, unknown>): string {
  expect(body.system).toEqual(expect.any(String));
  return body.system as string;
}

function count(value: string, token: string): number {
  return value.split(token).length - 1;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(
    MEMORY_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof MEMORY_ENV_KEYS)[number], string | undefined>;
  scratchRoot = mkdtempSync(path.join(tmpdir(), 'mobile-memory-assembly-'));
  process.env.HOME = path.join(scratchRoot, 'home');
  mkdirSync(process.env.HOME, { recursive: true });
  delete process.env.MEMORY_VAULT_PATH;
  delete process.env.MEMORY_VAULT_SUBDIR;
  delete process.env.ENGRAPH_MEMORY_VAULT_ROOT;
  process.env.AGENT_MEMORY_INJECTION_ENABLED = 'true';
  process.env.AGENT_MEMORY_RETRIEVAL_MODE = 'hybrid';
  process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED = 'false';
  process.env.AGENT_DECISION_MEMORY_RANKING = 'off';

  previousDbClient = env.dbClient;
  (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = 'sqlite';
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  previousDb = setDb(db);
  ownerOne = new UsersRepository().create({
    name: 'Synthetic mobile owner',
    email: 'mobile-owner@example.invalid',
  }).id;
  ownerTwo = new UsersRepository().create({
    name: 'Synthetic other owner',
    email: 'mobile-other@example.invalid',
  }).id;
  const projectRoot = path.join(scratchRoot, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const savedProject = new ProjectsRepository().insert({
    name: 'Synthetic mobile project',
    cwd: projectRoot,
    icon: null,
    vcs: { vcsRoot: null, vcsBranch: null, vcsDirty: false, vcsCheckedAt: null },
  });
  project = { id: savedProject.id, root: savedProject.cwd };
  ownership = new MobileOpenCodeOwnershipRepository(db);
  memoryRepo = new AgentMemoryRepository();
});

afterEach(() => {
  vi.restoreAllMocks();
  setDb(previousDb);
  db.close();
  (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = previousDbClient;
  for (const key of MEMORY_ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe('mobile automatic memory assembly', () => {
  it('adds one bounded, canonical own/global preface only to fresh forwarded async prompts', async () => {
    expect(CANONICAL_CONTENT).toHaveLength(120);
    expect(GENERIC_ANNOUNCEMENT_QUERY).toHaveLength(324);
    const sdkSessionId = 'sdk-mobile-memory';
    const localSession = reconcileMobileSession(sdkSessionId);
    claimSession(sdkSessionId);

    const sourceId = 'preference/announcement slides/verified clips with spaces.md';
    const foreignSourceId = 'preference/foreign owner.md';
    const global = await seedMemory({ sourceId, content: CANONICAL_CONTENT });
    await seedMemory({
      sourceId: foreignSourceId,
      content: FOREIGN_CONTENT,
      ownerUserId: ownerTwo,
    });
    writeCanonicalMemory(sourceId, CANONICAL_CONTENT);
    writeCanonicalMemory(foreignSourceId, FOREIGN_CONTENT);

    const nativeRequests: unknown[] = [];
    vi.spyOn(engraphManager, 'getRetrievalClient').mockReturnValue(makeNativeClient([
      { file_path: 'preference/heading-only.md', snippet: '# Announcement preference' },
      { file_path: sourceId, snippet: `## Announcement guidance\n${CANONICAL_CONTENT} ...` },
      { file_path: foreignSourceId, snippet: FOREIGN_CONTENT },
    ], nativeRequests) as never);
    const engine = makeEngine([sdkSessionId]);
    const input = promptInput(sdkSessionId);
    const originalBody = structuredClone(input.body);
    const originalQuery = input.query.toString();

    expect((await engine.proxy.forward(input)).status).toBe(204);
    expect((await engine.proxy.forward(input)).status).toBe(204);

    expect(input.body).toEqual(originalBody);
    expect(input.query.toString()).toBe(originalQuery);
    expect(engine.preparePromptStream).toHaveBeenCalledTimes(2);
    expect(engine.forwardedBodies).toHaveLength(2);
    for (const body of engine.forwardedBodies) {
      expect(body.agent).toBe('claude-code');
      expect(body.model).toEqual({ providerID: 'anthropic', modelID: 'claude-test' });
      expect(body.parts).toEqual(input.body.parts);
      const system = memorySystem(body);
      expect(system).toContain(CLIENT_SYSTEM);
      expect(system).toContain('<<<UNTRUSTED_EXTERNAL_CONTENT>>>');
      expect(system).toContain('<<<END_UNTRUSTED_EXTERNAL_CONTENT>>>');
      expect(system).toContain(`[${sourceId}]`);
      expect(system).not.toContain(FOREIGN_CONTENT);
      expect(count(system, '<<<UNTRUSTED_EXTERNAL_CONTENT>>>')).toBe(1);
    }
    expect(nativeRequests).toHaveLength(2);
    for (const request of nativeRequests) {
      expect(request).toMatchObject({ top_n: 20 });
      const nativeQuery = (request as { query?: unknown }).query;
      expect(nativeQuery).toEqual(expect.any(String));
      expect((nativeQuery as string).length).toBe(97);
      expect((nativeQuery as string).length).toBeLessThanOrEqual(128);
      expect(nativeQuery).toContain('church');
      expect(nativeQuery).toContain('announcement');
      expect(nativeQuery).not.toBe(GENERIC_ANNOUNCEMENT_QUERY);
    }
    const provenance = new AgentSessionMemoryProvenanceRepository().getLatest(localSession.id);
    expect(provenance).toMatchObject({
      sessionId: localSession.id,
      memoryIds: [global.id],
      notePaths: [sourceId],
      semanticStatus: 'used',
    });
    expect(JSON.stringify(provenance)).not.toContain(CANONICAL_CONTENT);
  });

  it('suppresses duplicate accepted messages before retrieval, provenance, stream attachment, or hidden-system append', async () => {
    const sdkSessionId = 'sdk-mobile-duplicate';
    const localSession = reconcileMobileSession(sdkSessionId);
    claimSession(sdkSessionId);
    const sourceId = 'preference/duplicate.md';
    await seedMemory({ sourceId, content: CANONICAL_CONTENT });
    writeCanonicalMemory(sourceId, CANONICAL_CONTENT);

    const nativeRequests: unknown[] = [];
    vi.spyOn(engraphManager, 'getRetrievalClient').mockReturnValue(makeNativeClient([
      { file_path: sourceId, snippet: CANONICAL_CONTENT },
    ], nativeRequests) as never);
    const engine = makeEngine([sdkSessionId]);
    const input = promptInput(sdkSessionId, { messageID: 'client-duplicate' });
    const originalBody = structuredClone(input.body);
    const originalQuery = input.query.toString();

    expect((await engine.proxy.forward(input)).status).toBe(204);
    const firstProvenance = new AgentSessionMemoryProvenanceRepository().getLatest(localSession.id);
    expect((await engine.proxy.forward(input)).status).toBe(204);

    expect(input.body).toEqual(originalBody);
    expect(input.query.toString()).toBe(originalQuery);
    expect(engine.forwardedBodies).toHaveLength(1);
    expect(engine.preparePromptStream).toHaveBeenCalledTimes(1);
    expect(nativeRequests).toHaveLength(1);
    expect(new AgentSessionMemoryProvenanceRepository().getLatest(localSession.id)).toEqual(firstProvenance);
    expect(count(memorySystem(engine.forwardedBodies[0]), '<<<UNTRUSTED_EXTERNAL_CONTENT>>>')).toBe(1);
  });

  it('skips memory-only assembly for foreign, null-owner, and unknown local catalog rows without changing authorized transport', async () => {
    const sourceId = 'preference/global.md';
    await seedMemory({ sourceId, content: CANONICAL_CONTENT });
    writeCanonicalMemory(sourceId, CANONICAL_CONTENT);
    const nativeRequests: unknown[] = [];
    vi.spyOn(engraphManager, 'getRetrievalClient').mockReturnValue(makeNativeClient([
      { file_path: sourceId, snippet: CANONICAL_CONTENT },
    ], nativeRequests) as never);

    const foreignSdkSessionId = 'sdk-mobile-foreign';
    const foreignSession = reconcileMobileSession(foreignSdkSessionId, ownerTwo);
    db.prepare(`INSERT INTO mobile_opencode_resource_owners
      (resource_kind, resource_id, owner_user_id, project_id, created_at)
      VALUES ('session', ?, ?, ?, ?)`).run(
      foreignSdkSessionId,
      ownerOne,
      project.id,
      '2026-10-04T00:00:00.000Z',
    );

    const nullOwnerSdkSessionId = 'sdk-mobile-null-owner';
    db.prepare(`INSERT INTO agent_sessions
      (id, agent_kind, status, cwd, name, owner_user_id, project_id, sdk_session_id,
       category, is_system, created_at, updated_at)
      VALUES ('local-null-owner', 'claude-code', 'idle', ?, 'Null owner', NULL, ?, ?,
       'chat', 0, ?, ?)`)
      .run(
        project.root,
        project.id,
        nullOwnerSdkSessionId,
        '2026-10-04T00:00:00.000Z',
        '2026-10-04T00:00:00.000Z',
      );
    db.prepare(`INSERT INTO mobile_opencode_resource_owners
      (resource_kind, resource_id, owner_user_id, project_id, created_at)
      VALUES ('session', ?, ?, ?, ?)`).run(
      nullOwnerSdkSessionId,
      ownerOne,
      project.id,
      '2026-10-04T00:00:00.000Z',
    );

    const unknownSdkSessionId = 'sdk-mobile-unknown';
    claimSession(unknownSdkSessionId);
    const engine = makeEngine([
      foreignSdkSessionId,
      nullOwnerSdkSessionId,
      unknownSdkSessionId,
    ]);

    expect((await engine.proxy.forward(promptInput(foreignSdkSessionId, { ownerUserId: ownerOne }))).status).toBe(204);
    expect((await engine.proxy.forward(promptInput(nullOwnerSdkSessionId, { ownerUserId: ownerOne }))).status).toBe(204);
    expect((await engine.proxy.forward(promptInput(unknownSdkSessionId, { ownerUserId: ownerOne }))).status).toBe(204);

    expect(nativeRequests).toEqual([]);
    expect(engine.forwardedBodies).toHaveLength(3);
    for (const body of engine.forwardedBodies) {
      expect(memorySystem(body)).toBe(CLIENT_SYSTEM);
    }
    expect(new AgentSessionMemoryProvenanceRepository().getLatest(foreignSession.id)).toBeNull();
    expect(new AgentSessionMemoryProvenanceRepository().getLatest('local-null-owner')).toBeNull();
  });

  it('keeps flag-off and retrieval-failure prompt forwarding and stream attachment fail-open', async () => {
    const sdkSessionId = 'sdk-mobile-fail-open';
    const localSession = reconcileMobileSession(sdkSessionId);
    claimSession(sdkSessionId);
    const engine = makeEngine([sdkSessionId]);

    process.env.AGENT_MEMORY_INJECTION_ENABLED = 'false';
    const disabledRequests: unknown[] = [];
    vi.spyOn(engraphManager, 'getRetrievalClient').mockReturnValue(makeNativeClient([], disabledRequests) as never);
    expect((await engine.proxy.forward(promptInput(sdkSessionId))).status).toBe(204);
    expect(disabledRequests).toEqual([]);
    expect(memorySystem(engine.forwardedBodies[0])).toBe(CLIENT_SYSTEM);
    expect(new AgentSessionMemoryProvenanceRepository().getLatest(localSession.id)).toBeNull();

    process.env.AGENT_MEMORY_INJECTION_ENABLED = 'true';
    const failedFetch = vi.fn(async () => new Response('', { status: 503 }));
    vi.spyOn(engraphManager, 'getRetrievalClient').mockReturnValue(
      new EngraphHttpClient('http://127.0.0.1:7777', failedFetch) as never,
    );
    expect((await engine.proxy.forward(promptInput(sdkSessionId))).status).toBe(204);
    expect(engine.preparePromptStream).toHaveBeenCalledTimes(2);
    expect(memorySystem(engine.forwardedBodies[1])).toBe(CLIENT_SYSTEM);
    expect(new AgentSessionMemoryProvenanceRepository().getLatest(localSession.id))
      .toMatchObject({ memoryIds: [], semanticStatus: 'http_error' });
  });

  it('keeps manifest, authorization, busy, and managed-history rejections ahead of memory assembly', async () => {
    const sdkSessionId = 'sdk-mobile-rejected';
    const localSession = reconcileMobileSession(sdkSessionId);
    const sourceId = 'preference/rejected.md';
    await seedMemory({ sourceId, content: CANONICAL_CONTENT });
    writeCanonicalMemory(sourceId, CANONICAL_CONTENT);
    const nativeRequests: unknown[] = [];
    vi.spyOn(engraphManager, 'getRetrievalClient').mockReturnValue(makeNativeClient([
      { file_path: sourceId, snippet: CANONICAL_CONTENT },
    ], nativeRequests) as never);
    const engine = makeEngine([sdkSessionId]);

    await expect(engine.proxy.forward({
      ...promptInput(sdkSessionId),
      path: `/session/${sdkSessionId}/prompt`,
    })).rejects.toMatchObject({ code: 'OPERATION_NOT_ALLOWED' });
    await expect(engine.proxy.forward(promptInput('sdk-mobile-denied'))).rejects.toMatchObject({ statusCode: 404 });

    claimSession(sdkSessionId);
    const busyEngine = makeEngine([sdkSessionId]);
    const busyFetch = busyEngine.fetchFn.getMockImplementation()!;
    busyEngine.fetchFn.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/session/status' && init?.method === 'GET') {
        return Response.json({ [sdkSessionId]: { type: 'busy' } });
      }
      return busyFetch(input, init);
    });
    await expect(busyEngine.proxy.forward({
      ...promptInput(sdkSessionId),
      remoteAttachDesktop: true,
    })).resolves.toMatchObject({ status: 409 });

    const now = '2026-10-04T00:00:00.000Z';
    db.prepare(`INSERT INTO agent_turn_dispatches (
      id, session_id, sdk_session_id, sdk_user_message_id, origin,
      requested_source, route_authed, outcome, created_at, updated_at,
      managed_context_schema_version, managed_context_sdk_session_id
    ) VALUES (?, ?, ?, 'synthetic-message', 'prompt_api',
      'caller', 1, 'accepted', ?, ?, 1, ?)`)
      .run('managed-before-mobile-memory', localSession.id, sdkSessionId, now, now, sdkSessionId);
    await expect(engine.proxy.forward(promptInput(sdkSessionId))).rejects.toMatchObject({
      code: 'RECONCILIATION_REQUIRED',
    });

    expect(nativeRequests).toEqual([]);
    expect(engine.forwardedBodies).toEqual([]);
    expect(busyEngine.forwardedBodies).toEqual([]);
  });
});
