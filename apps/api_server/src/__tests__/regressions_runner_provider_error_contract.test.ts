import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateSession, mockPrompt, mockStreamSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockStreamSession: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    createSession: mockCreateSession,
    prompt: mockPrompt,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: { streamSession: mockStreamSession },
}));

import Database from 'better-sqlite3';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { run } from '../services/agent_runner';

describe('C3 runner provider error contract', () => {
  beforeEach(() => {
    setDb(new Database(':memory:'));
    runMigrations(getDb());
    vi.clearAllMocks();
    mockCreateSession.mockResolvedValue({ id: 'sdk-c3-provider-error' });
    mockStreamSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    getDb().close();
    vi.restoreAllMocks();
  });

  it('task-c3-c1: a completed assistant APIError is an observable failed run and root', async () => {
    mockPrompt.mockResolvedValue({
      info: {
        id: 'msg-c3-provider-error',
        sessionID: 'sdk-c3-provider-error',
        role: 'assistant',
        error: {
          name: 'APIError',
          data: {
            message: 'Synthetic provider unavailable: review model settings.',
            statusCode: 401,
            isRetryable: false,
            responseBody: 'SECRET_SHOULD_NOT_APPEAR',
            metadata: { url: 'http://127.0.0.1:54321/v1/messages' },
          },
        },
      },
      parts: [],
    });

    const result = await run({ prompt: 'Check the schedule' });
    const root = new AgentSessionsRepository().findById(result.sessionId);
    const output = new AgentSessionMessagesRepository()
      .listBySessionStructured(result.sessionId)
      .filter((message) => message.role === 'output');

    expect(result.status).toBe('error');
    expect(result.failureCategory).toBe('authentication');
    expect(result.error).toMatch(/401|authenticat/i);
    expect(result.error).not.toContain('SECRET_SHOULD_NOT_APPEAR');
    expect(root?.status).toBe('error');
    expect(root?.lastPreview).toMatch(/401|authenticat/i);
    expect(root?.lastPreview).not.toContain('SECRET_SHOULD_NOT_APPEAR');
    expect(output).toHaveLength(0);
  });

  it('task-c3-c3: an aborted assistant turn remains an interruption, not a provider failure', async () => {
    mockPrompt.mockResolvedValue({
      info: {
        id: 'msg-c3-aborted',
        sessionID: 'sdk-c3-provider-error',
        role: 'assistant',
        error: { name: 'MessageAbortedError', data: { message: 'Aborted' } },
      },
      parts: [],
    });

    const result = await run({ prompt: 'Interrupt this run' });
    const root = new AgentSessionsRepository().findById(result.sessionId);

    expect(result.status).toBe('error');
    expect(result.failureCategory).toBe('restart_interruption');
    expect(result.error).toMatch(/interrupted|aborted/i);
    expect(result.error).not.toMatch(/model provider/i);
    expect(root?.status).toBe('error');
  });

  it('task-c3-c4: an output-limit error remains a model turn failure, not a provider failure', async () => {
    mockPrompt.mockResolvedValue({
      info: {
        id: 'msg-c3-output-limit',
        sessionID: 'sdk-c3-provider-error',
        role: 'assistant',
        error: { name: 'MessageOutputLengthError', data: {} },
      },
      parts: [],
    });

    const result = await run({ prompt: 'Give a long reply' });
    const root = new AgentSessionsRepository().findById(result.sessionId);

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/output limit/i);
    expect(result.error).not.toMatch(/model provider/i);
    expect(root?.status).toBe('error');
  });
});
