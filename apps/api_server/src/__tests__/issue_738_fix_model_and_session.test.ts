/**
 * #738-fix — AgentRunner model resolution + session recording
 *
 * Tests that:
 * 1. prompt() is called WITH a resolved model (never undefined).
 * 2. run() records an agent_sessions row (spy the repository insert).
 * 3. resolveRunModel falls back to hardcoded default when DB is unavailable.
 * 4. run() with prompt() returning null returns error status quickly.
 * 5. New agent_configs model columns present in SQLite schema.
 * 6. agent_sessions.scheduled_task_id column present in SQLite schema.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoist mock fns ────────────────────────────────────────────────────────────

const {
  mockCreateSession,
  mockPrompt,
  mockAbortSession,
  mockInsertSession,
  mockGetById,
  mockFindMostRecentlyUsedModel,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockAbortSession: vi.fn(),
  mockInsertSession: vi.fn(),
  mockGetById: vi.fn(),
  mockFindMostRecentlyUsedModel: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    createSession: mockCreateSession,
    prompt: mockPrompt,
    abortSession: mockAbortSession,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../repositories/agent_sessions_repository', () => ({
  AgentSessionsRepository: class {
    insert = mockInsertSession;
    findMostRecentlyUsedModel = mockFindMostRecentlyUsedModel;
    resetStaleRunning = vi.fn().mockReturnValue(0);
  },
}));

vi.mock('../repositories/agent_configs_repository', () => ({
  AgentConfigsRepository: class {
    getById = mockGetById;
  },
}));

import { run, resolveRunModel } from '../services/agent_runner';
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from '../database/migrations';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A minimal prompt() response with one text part. */
function makePromptResponse(text: string): { info: Record<string, unknown>; parts: { type: string; text: string }[] } {
  return {
    info: { sessionID: 'sess-1' },
    parts: [{ type: 'text', text }],
  };
}

describe('#738-fix — AgentRunner model resolution + session recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-1' });
    mockPrompt.mockResolvedValue(makePromptResponse('Done'));
    mockAbortSession.mockResolvedValue(true);
    mockInsertSession.mockReturnValue({ id: 'rhythm-session-abc', status: 'starting' });
    mockGetById.mockReturnValue(null);
    mockFindMostRecentlyUsedModel.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.AGENT_RUN_TIMEOUT_MS;
    delete process.env.MAX_CONCURRENT_AGENT_RUNS;
  });

  // ── 1a. Hardcoded default model when no config/MRU ────────────────────────

  it('calls prompt with hardcoded default model when no config or MRU', async () => {
    mockPrompt.mockResolvedValue(makePromptResponse('Done'));

    await run({ prompt: 'Hello' });

    expect(mockPrompt).toHaveBeenCalledOnce();
    const [, , modelArg] = mockPrompt.mock.calls[0];
    expect(modelArg).toMatchObject({ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' });
  });

  // ── 1b. Agent config model takes priority ─────────────────────────────────

  it('calls prompt with agent config model when config has model_provider + model_id', async () => {
    mockGetById.mockReturnValue({
      id: 'claude-code', label: 'Claude Code', icon: '🤖', enabled: true, isAgent: true,
      isManager: false, systemPrompt: null, allowedMcpsJson: null, allowedSkillsJson: null,
      presetId: null, sortOrder: 0, createdAt: '', updatedAt: '',
      modelProvider: 'anthropic',
      modelId: 'claude-opus-4-5',
    });

    mockPrompt.mockResolvedValue(makePromptResponse('Done'));

    await run({ prompt: 'Hello', agentConfigId: 'claude-code' });

    const [, , modelArg] = mockPrompt.mock.calls[0];
    expect(modelArg).toMatchObject({ providerID: 'anthropic', modelID: 'claude-opus-4-5' });
  });

  // ── 1c. MRU model fallback ────────────────────────────────────────────────

  it('calls prompt with MRU model when config has no model but sessions do', async () => {
    mockGetById.mockReturnValue({
      id: 'claude-code', label: 'Claude Code', icon: '🤖', enabled: true, isAgent: true,
      isManager: false, systemPrompt: null, allowedMcpsJson: null, allowedSkillsJson: null,
      presetId: null, sortOrder: 0, createdAt: '', updatedAt: '',
      modelProvider: null,
      modelId: null,
    });
    mockFindMostRecentlyUsedModel.mockReturnValue({
      providerID: 'openrouter',
      modelID: 'meta-llama/llama-3.1-8b',
    });

    mockPrompt.mockResolvedValue(makePromptResponse('Done'));

    await run({ prompt: 'Hello', agentConfigId: 'claude-code' });

    const [, , modelArg] = mockPrompt.mock.calls[0];
    expect(modelArg).toMatchObject({ providerID: 'openrouter', modelID: 'meta-llama/llama-3.1-8b' });
  });

  // ── 2. Session is recorded ────────────────────────────────────────────────

  it('records an agent_sessions row on every run', async () => {
    mockPrompt.mockResolvedValue(makePromptResponse('Done'));

    await run({ prompt: 'Hello', agentKind: 'claude-code', sessionName: 'Test run' });

    expect(mockInsertSession).toHaveBeenCalledOnce();
    const insertArg = mockInsertSession.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      agentKind: 'claude-code',
      name: 'Test run',
    });
  });

  it('passes scheduledTaskId to the recorded session', async () => {
    mockPrompt.mockResolvedValue(makePromptResponse('Done'));

    await run({
      prompt: 'Hello',
      agentKind: 'claude-code',
      sessionName: 'Scheduled: Morning sync',
      scheduledTaskId: 'task-uuid-1',
    });

    const insertArg = mockInsertSession.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      name: 'Scheduled: Morning sync',
      scheduledTaskId: 'task-uuid-1',
    });
  });

  it('result.sessionId is the Rhythm session id from the repository', async () => {
    mockInsertSession.mockReturnValue({ id: 'rhythm-session-xyz', status: 'starting' });
    mockPrompt.mockResolvedValue(makePromptResponse('Done'));

    const result = await run({ prompt: 'Hello' });

    // rhythmSessionId comes from _recordSession which calls mockInsertSession
    expect(result.sessionId).toBe('rhythm-session-xyz');
    expect(result.status).toBe('done');
  });

  // ── 3. resolveRunModel never returns undefined ────────────────────────────

  it('resolveRunModel returns hardcoded default when both config and MRU lookups throw', () => {
    mockGetById.mockImplementation(() => { throw new Error('DB gone'); });
    mockFindMostRecentlyUsedModel.mockImplementation(() => { throw new Error('DB gone'); });

    const model = resolveRunModel('any-agent-id');
    expect(model).toMatchObject({ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' });
  });

  // ── 4. prompt returns null → fast error, not 600s hang ───────────────────

  it('returns error immediately when prompt returns null (model produced no output)', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '60000'; // 60s — we should never reach it
    mockPrompt.mockResolvedValue(null);

    const start = Date.now();
    const result = await run({ prompt: 'Hello' });
    const elapsed = Date.now() - start;

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/no output/i);
    // Must finish well within the 60s timeout — prompt resolves immediately with null
    expect(elapsed).toBeLessThan(2000);
    delete process.env.AGENT_RUN_TIMEOUT_MS;
  });
});

// ── Schema tests (in-process SQLite) ─────────────────────────────────────────

describe('#738-fix — schema: new columns in SQLite migrations', () => {
  it('agent_configs has model_provider and model_id columns', () => {
    const db = new BetterSqlite3(':memory:');
    runMigrations(db);

    const cols = (db.pragma('table_info(agent_configs)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('model_provider');
    expect(cols).toContain('model_id');

    // SELECT must work without error; columns return null for existing rows
    const rows = db
      .prepare('SELECT id, model_provider, model_id FROM agent_configs')
      .all() as Array<{ id: string; model_provider: string | null; model_id: string | null }>;
    for (const row of rows) {
      // seed rows may have null or a value set; the column must exist
      expect(row).toHaveProperty('model_provider');
      expect(row).toHaveProperty('model_id');
    }
    db.close();
  });

  it('agent_sessions has scheduled_task_id column', () => {
    const db = new BetterSqlite3(':memory:');
    runMigrations(db);

    const cols = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('scheduled_task_id');
    db.close();
  });
});
