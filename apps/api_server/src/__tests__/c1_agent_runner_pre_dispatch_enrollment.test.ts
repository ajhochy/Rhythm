/**
 * C1 — pre-dispatch experiment enrollment ordering contract.
 *
 * Required behavior: AgentRunner must call reserveRunEnrollment() before
 * opencodeClient.prompt() so a stable runEpisodeId is reserved before any
 * model dispatch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

const { mockCreateSession, mockPrompt, mockAbortSession, mockReserveRunEnrollment } =
  vi.hoisted(() => ({
    mockCreateSession: vi.fn(),
    mockPrompt: vi.fn(),
    mockAbortSession: vi.fn(),
    mockReserveRunEnrollment: vi.fn(),
  }));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    createSession: mockCreateSession,
    prompt: mockPrompt,
    promptAsync: vi.fn(),
    abortSession: mockAbortSession,
    listMessages: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../services/org_proposal_experiment_service', () => ({
  reserveRunEnrollment: mockReserveRunEnrollment,
}));

let activeDb: Database.Database | null = null;
function makeDb(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  activeDb = db;
}

function teardownDb(): void {
  if (activeDb) {
    try {
      activeDb.close();
    } catch {
      // Ignore.
    }
    activeDb = null;
  }
}

describe('C1 — pre-dispatch enrollment is ordered before prompt dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeDb();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-c1' });
    mockPrompt.mockResolvedValue({
      info: { sessionID: 'sdk-session-c1' },
      parts: [{ type: 'text', text: 'Done' }],
    });
    mockAbortSession.mockResolvedValue(true);
  });

  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
  });

  async function freshRun() {
    const { run } = await import('../services/agent_runner');
    return run;
  }

  async function mockScope(overrides: Record<string, unknown> = {}) {
    const scopeModule = await import('../services/agent_profile_scope');
    vi.spyOn(scopeModule, 'resolveProfileScope').mockResolvedValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: null,
      ocAgent: null,
      modelTierHint: null,
      ...overrides,
    } as never);
  }

  it('calls reserveRunEnrollment before opencodeClient.prompt', async () => {
    await mockScope();
    let sessionId = '';
    const run = await freshRun();

    await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      onSessionCreated: (id) => {
        sessionId = id;
      },
    });

    expect(mockReserveRunEnrollment).toHaveBeenCalledTimes(1);
    expect(mockReserveRunEnrollment).toHaveBeenCalledWith(sessionId, 'agent-1');
    expect(mockReserveRunEnrollment.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrompt.mock.invocationCallOrder[0],
    );
  });

  it('preserves explicit runEpisodeId (scheduled/occurrence-style IDs)', async () => {
    await mockScope();
    const run = await freshRun();
    const scheduledOccurrenceId = 'scheduled-occurrence-2026-08-17';

    await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      runEpisodeId: scheduledOccurrenceId,
    });

    expect(mockReserveRunEnrollment).toHaveBeenCalledTimes(1);
    expect(mockReserveRunEnrollment).toHaveBeenCalledWith(
      scheduledOccurrenceId,
      'agent-1',
    );
  });
});
