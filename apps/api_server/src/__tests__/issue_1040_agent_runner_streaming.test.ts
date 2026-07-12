/**
 * #1040 — Headless AgentRunner sessions use the interactive stream bridge.
 *
 * These contract tests mock the engine and bridge boundaries; no server or
 * opencode process is started.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateSession,
  mockPrompt,
  mockAbortSession,
  mockStreamSession,
  mockOpencodeSessionMap,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockAbortSession: vi.fn(),
  mockStreamSession: vi.fn(),
  mockOpencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    createSession: mockCreateSession,
    prompt: mockPrompt,
    abortSession: mockAbortSession,
  },
  opencodeSessionMap: mockOpencodeSessionMap,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: mockStreamSession,
  },
}));

import Database from 'better-sqlite3';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { run } from '../services/agent_runner';

const assistantResponse = {
  info: {
    id: 'msg-assistant-1040',
    sessionID: 'sdk-session-1040',
    role: 'assistant',
  },
  parts: [
    {
      id: 'part-assistant-1040',
      messageID: 'msg-assistant-1040',
      sessionID: 'sdk-session-1040',
      type: 'text',
      text: 'Streamed answer',
    },
  ],
};

describe('#1040 — AgentRunner headless streaming', () => {
  beforeEach(() => {
    setDb(new Database(':memory:'));
    runMigrations(getDb());
    vi.clearAllMocks();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-1040' });
    mockPrompt.mockResolvedValue(assistantResponse);
    mockAbortSession.mockResolvedValue(true);
    mockStreamSession.mockResolvedValue(undefined);
    mockOpencodeSessionMap.clear();
  });

  afterEach(() => {
    getDb().close();
    vi.restoreAllMocks();
  });

  it('issue-1040-c1: subscribes a headless run to the shared stream bridge with effectiveCwd', async () => {
    // Regression caught: AgentRunner creates and prompts an engine session but
    // never attaches the SSE consumer, leaving the open transcript blank.
    const cwd = '/tmp/rhythm-issue-1040';

    const result = await run({ prompt: 'Research this', cwd });

    expect(result.status).toBe('done');
    expect(mockStreamSession).toHaveBeenCalledOnce();
    expect(mockStreamSession).toHaveBeenCalledWith(
      result.sessionId,
      'sdk-session-1040',
      cwd,
    );
    expect(mockOpencodeSessionMap.get(result.sessionId)).toBe('sdk-session-1040');
  });

  it('issue-1040-c2: completion upsert does not duplicate an assistant message already persisted by the bridge', async () => {
    // Regression caught: the bridge persists the structured assistant message,
    // then AgentRunner appends the same final text as a second legacy row.
    let localSessionId: string | undefined;
    mockStreamSession.mockImplementation((sessionId: string) => {
      localSessionId = sessionId;
      return Promise.resolve();
    });
    mockPrompt.mockImplementation(async () => {
      if (localSessionId) {
        new AgentSessionMessagesRepository().upsertStructured(
          localSessionId,
          'msg-assistant-1040',
          'output',
          JSON.stringify(assistantResponse.parts),
          null,
          null,
        );
      }
      return assistantResponse;
    });

    const result = await run({ prompt: 'Research this' });

    expect(result.status).toBe('done');
    const assistantMessages = new AgentSessionMessagesRepository()
      .listBySessionStructured(result.sessionId)
      .filter((message) => message.role === 'output');
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.sdkMessageId).toBe('msg-assistant-1040');
    expect(assistantMessages[0]?.rawText).toBe('Streamed answer');
  });
});
