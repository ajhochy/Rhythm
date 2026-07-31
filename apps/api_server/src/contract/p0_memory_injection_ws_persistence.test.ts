/**
 * P0 acceptance contract — interactive owner resolution and persistence seam.
 *
 * Falsification target: prepended context in prompt text/parts would be stored
 * by OpenCodeStreamBridge and replayed as if the user authored it.
 */
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { promptAsyncSpy, sessionMap } = vi.hoisted(() => ({
  promptAsyncSpy: vi.fn().mockResolvedValue(true),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    promptAsync: promptAsyncSpy,
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-created' }),
    getSession: vi.fn().mockResolvedValue(null),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    dispatchCommand: vi.fn().mockResolvedValue(null),
    updateSessionAllowlist: vi.fn().mockResolvedValue(true),
    updateSessionSkillAllowlist: vi.fn().mockResolvedValue(true),
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

import { handleInputFrame } from '../services/ws_gateway';

const ORIGINAL = 'When should Worship Committee meetings be scheduled?';
let db: Database.Database;
let sessions: AgentSessionsRepository;

function fakeWs() {
  return { send: vi.fn(), readyState: 1 } as unknown as import('ws').WebSocket;
}

async function seedPreference(ownerUserId: number, text: string) {
  await new AgentMemoryRepository().createAsync({
    kind: 'preference',
    content: text,
    source: 'obsidian-memory',
    sourceId: `preference/${ownerUserId}.md`,
    ownerUserId,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMap.clear();
  process.env.AGENT_MEMORY_RETRIEVAL_MODE = 'fts';
  process.env.AGENT_MEMORY_INJECTION_ENABLED = 'true';
  process.env.AGENT_SKILLS_ENABLED = 'false';
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  db.prepare('INSERT INTO users (id, name, email) VALUES (1, ?, ?)')
    .run('Owner A', 'owner-a-p0@example.com');
  db.prepare('INSERT INTO users (id, name, email) VALUES (2, ?, ?)')
    .run('Owner B', 'owner-b-p0@example.com');
  sessions = new AgentSessionsRepository();
});

afterEach(() => {
  delete process.env.AGENT_MEMORY_RETRIEVAL_MODE;
  delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
  delete process.env.AGENT_SKILLS_ENABLED;
  db.close();
});

describe('P0 WebSocket memory context boundary', () => {
  it('issue-0-c16: interactive retrieval uses the session’s real owner_user_id', async () => {
    await seedPreference(1, 'Worship Committee meetings should be scheduled on Tuesdays.');
    await seedPreference(2, 'Worship Committee meetings should be scheduled on Fridays.');
    const session = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: os.homedir(),
      name: 'P0 owner resolution',
      ownerUserId: 1,
    });
    sessionMap.set(session.id, 'sdk-owner');

    await handleInputFrame(fakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: ORIGINAL,
    });

    const [, forwardedText, , , opts] = promptAsyncSpy.mock.calls[0] as [
      string,
      string,
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(forwardedText).toBe(ORIGINAL);
    expect(opts.system).toContain('Tuesdays');
    expect(opts.system).not.toContain('Fridays');
  });

  it('issue-0-c17: a null/unknown owner never retrieves user-owned context', async () => {
    await seedPreference(1, 'Worship Committee meetings should be scheduled on Tuesdays.');
    const session = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: os.homedir(),
      name: 'P0 null owner',
      ownerUserId: null,
    });
    sessionMap.set(session.id, 'sdk-null-owner');

    await handleInputFrame(fakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: ORIGINAL,
    });

    const [, forwardedText, , , opts] = promptAsyncSpy.mock.calls[0] as [
      string,
      string,
      unknown,
      unknown,
      Record<string, unknown> | undefined,
    ];
    expect(forwardedText).toBe(ORIGINAL);
    expect(JSON.stringify(opts ?? {})).not.toContain('Tuesdays');
  });

  it('issue-0-c18: persisted/displayed text and parts contain only the original user message', async () => {
    await seedPreference(1, 'Worship Committee meetings should be scheduled on Tuesdays.');
    const session = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: os.homedir(),
      name: 'P0 persistence',
      ownerUserId: 1,
    });
    sessionMap.set(session.id, 'sdk-persistence');

    await handleInputFrame(fakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      parts: [{ id: 'input-text', type: 'text', text: ORIGINAL }],
    });

    const [, forwardedText, , , , forwardedParts] = promptAsyncSpy.mock.calls[0] as [
      string,
      string,
      unknown,
      unknown,
      Record<string, unknown>,
      Array<Record<string, unknown>>,
    ];
    expect(forwardedText).toBe(ORIGINAL);
    expect(forwardedParts).toEqual([
      { id: 'input-text', type: 'text', text: ORIGINAL },
    ]);

    const messages = new AgentSessionMessagesRepository();
    messages.upsertPart(session.id, 'sdk-user-message', forwardedParts[0]);
    const persisted = messages.listBySessionStructured(session.id);
    expect(persisted[0].rawText).toBe(ORIGINAL);
    expect(JSON.stringify(persisted)).not.toContain('## Known context');
  });

  it('issue-0-c19: reconnect/session-detail/replay inputs expose no hidden preface', async () => {
    await seedPreference(1, 'Worship Committee meetings should be scheduled on Tuesdays.');
    const session = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: os.homedir(),
      name: 'P0 replay',
      ownerUserId: 1,
    });
    sessionMap.set(session.id, 'sdk-replay');

    await handleInputFrame(fakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: ORIGINAL,
    });
    const [, forwardedText] = promptAsyncSpy.mock.calls[0] as [string, string];
    const messages = new AgentSessionMessagesRepository();
    messages.upsertPart(session.id, 'sdk-replay-user', {
      id: 'replay-text',
      type: 'text',
      text: forwardedText,
    });

    const replay = messages.listBySessionStructured(session.id);
    expect(replay.map((message) => message.rawText)).toEqual([ORIGINAL]);
    expect(JSON.stringify(replay)).not.toContain('facts & preferences');
  });

  it('issue-0-c20: repeated turns cannot recursively amplify prior injected context', async () => {
    await seedPreference(1, 'Worship Committee meetings should be scheduled on Tuesdays.');
    const session = sessions.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: os.homedir(),
      name: 'P0 repeated turns',
      ownerUserId: 1,
    });
    sessionMap.set(session.id, 'sdk-repeat');

    await handleInputFrame(fakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: ORIGINAL,
    });
    await handleInputFrame(fakeWs(), {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: ORIGINAL,
    });

    expect(promptAsyncSpy).toHaveBeenCalledTimes(2);
    for (const call of promptAsyncSpy.mock.calls) {
      expect(call[1]).toBe(ORIGINAL);
      expect(call[1]).not.toContain('## Known context');
    }
  });
});
