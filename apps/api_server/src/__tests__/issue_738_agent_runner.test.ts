/**
 * #738 — AgentRunner service tests
 *
 * All tests mock opencode_engine so nothing real launches.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoist mocks so they're available when vi.mock factory runs ────────────────

const {
  mockCreateSession,
  mockPrompt,
  mockAbortSession,
  mockListMcp,
  mockCreateWorktree,
  mockEnsureReady,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockAbortSession: vi.fn(),
  mockListMcp: vi.fn(),
  mockCreateWorktree: vi.fn(),
  mockEnsureReady: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    createSession: mockCreateSession,
    prompt: mockPrompt,
    abortSession: mockAbortSession,
    listMcp: mockListMcp,
    createWorktree: mockCreateWorktree,
    ensureReady: mockEnsureReady,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

// ── Import after mock ─────────────────────────────────────────────────────────

import { run, _activeRunCount } from '../services/agent_runner';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A minimal prompt() response with one text part. */
function makePromptResponse(text: string): { info: Record<string, unknown>; parts: { type: string; text: string }[] } {
  return {
    info: { sessionID: 'sess-1' },
    parts: [{ type: 'text', text }],
  };
}

describe('#738 — AgentRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: session creates fine, prompt resolves with a text reply
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-1' });
    mockPrompt.mockResolvedValue(makePromptResponse('Hello from agent'));
    mockAbortSession.mockResolvedValue(true);
    mockCreateWorktree.mockResolvedValue({
      name: 'scheduled-isolated',
      branch: 'agent/scheduled-isolated',
      directory: '/repo/.worktrees/scheduled-isolated',
    });
    mockEnsureReady.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── A. Successful run ─────────────────────────────────────────────────────

  it('returns done status and result text when assistant replies', async () => {
    mockPrompt.mockResolvedValue(makePromptResponse('Hello from agent'));

    const result = await run({ prompt: 'Say hello' });

    expect(result.status).toBe('done');
    expect(result.result).toBe('Hello from agent');
    // sessionId is now the Rhythm session id (from _recordSession); it may differ
    // from the opencode session id since the DB is not initialized in this test.
    expect(typeof result.sessionId).toBe('string');
    expect(mockCreateSession).toHaveBeenCalledOnce();
    // #738-fix: prompt must be called WITH a resolved model (not undefined).
    // The DB is not initialized in this test so MRU lookup falls back to the
    // hardcoded default: anthropic / claude-sonnet-4-6.
    // #1002: post-creation calls are directory-scoped to effectiveCwd
    // (cwd ?? process.cwd()); with no cwd passed, that resolves to process.cwd().
    expect(mockPrompt).toHaveBeenCalledWith(
      'sdk-session-1',
      'Say hello',
      { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
      process.cwd(),
      expect.objectContaining({ permissionMode: 'bypassPermissions' }),
    );
  });

  it('#1058: creates an isolated worktree before a background engine session and persists it', async () => {
    setDb(new Database(':memory:'));
    runMigrations(getDb());

    const result = await run({
      prompt: 'Run in isolation',
      cwd: '/repo',
      isolateWorktree: true,
      worktreeName: 'scheduled-isolated',
    });

    expect(result.status).toBe('done');
    expect(mockCreateWorktree).toHaveBeenCalledWith('/repo', {
      name: 'scheduled-isolated',
    });
    expect(mockCreateWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateSession.mock.invocationCallOrder[0],
    );
    expect(mockCreateSession).toHaveBeenCalledWith(
      'Run in isolation',
      '/repo/.worktrees/scheduled-isolated',
      undefined,
      undefined,
      'anthropic',
    );
    expect(new AgentSessionsRepository().findById(result.sessionId)).toMatchObject({
      cwd: '/repo/.worktrees/scheduled-isolated',
      worktreeName: 'scheduled-isolated',
      worktreePath: '/repo/.worktrees/scheduled-isolated',
      worktreeBranch: 'agent/scheduled-isolated',
    });
  });

  // ── B. Short-timeout + prompt never resolves ──────────────────────────────
  //
  // When AGENT_RUN_TIMEOUT_MS is very short, the timeoutPromise in Promise.race
  // resolves first (returning null), which triggers the 'run timed out' error.
  // The run returns an error and abortSession is called.

  it('calls abortSession and returns error when timeout expires with no messages', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '50';

    // prompt never resolves — timeout fires via Promise.race
    mockPrompt.mockReturnValue(new Promise(() => {}));

    const result = await run({ prompt: 'Timeout test' });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/run timed out/i);
    // #1002: abort is directory-scoped to effectiveCwd (process.cwd() here).
    expect(mockAbortSession).toHaveBeenCalledWith('sdk-session-1', process.cwd());

    delete process.env.AGENT_RUN_TIMEOUT_MS;
  });

  it('returns an error when the MCP readiness preflight exceeds the run timeout', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '50';
    mockListMcp.mockReturnValue(new Promise(() => {}));

    const result = await run({
      prompt: 'Check staffing',
      mcpRole: 'worship-planning',
      allowedMcpsJson: '{"pco-services":["get_plans"]}',
    });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/MCP readiness preflight/i);
    expect(mockCreateSession).not.toHaveBeenCalled();

    delete process.env.AGENT_RUN_TIMEOUT_MS;
  });

  it('returns an error when session creation exceeds the run timeout', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '50';
    mockCreateSession.mockReturnValue(new Promise(() => {}));

    const result = await run({ prompt: 'Start a tool-heavy task' });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/session creation/i);
    expect(mockPrompt).not.toHaveBeenCalled();

    delete process.env.AGENT_RUN_TIMEOUT_MS;
  });

  // ── C. Slot released after successful run ─────────────────────────────────

  it('releases the concurrency slot after a successful run', async () => {
    mockPrompt.mockResolvedValue(makePromptResponse('Done'));

    const beforeCount = _activeRunCount();
    await run({ prompt: 'Slot release test' });
    const afterCount = _activeRunCount();

    expect(afterCount).toBe(beforeCount);
  });

  it('releases the concurrency slot after a failed run (timeout)', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '50';
    mockPrompt.mockReturnValue(new Promise(() => {}));

    const beforeCount = _activeRunCount();
    await run({ prompt: 'Error release test' });
    const afterCount = _activeRunCount();

    expect(afterCount).toBe(beforeCount);

    delete process.env.AGENT_RUN_TIMEOUT_MS;
  });

  // ── D. Session creation failure ───────────────────────────────────────────

  it('returns error when createSession returns null', async () => {
    mockCreateSession.mockResolvedValue(null);

    const result = await run({ prompt: 'No session' });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/failed to create/i);
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  // #1222 — the real cause createSession reports (opencode_client_service.ts)
  // must be forwarded verbatim, not collapsed into the fixed generic string
  // above. This is the root-cause fix: the discarded error is now the
  // reported error.
  it('#1222: forwards the REAL cause from createSession({ error }) instead of the generic message', async () => {
    mockCreateSession.mockResolvedValue({
      error: 'Opencode session.create returned an error: {"message":"provider unauthenticated"}',
    });

    const result = await run({ prompt: 'No session, real cause' });

    expect(result.status).toBe('error');
    expect(result.error).toContain('provider unauthenticated');
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  // #1222 — this failure branch used to skip _markSessionError entirely, so a
  // scheduled/headless run's agent_sessions row never durably recorded WHY it
  // failed (only the return value did, and only the scheduler's caller — not
  // the CHATS-list-visible session row — persisted anything).
  it('#1222: durably marks the recorded session row as error with the real reason', async () => {
    setDb(new Database(':memory:'));
    runMigrations(getDb());
    mockCreateSession.mockResolvedValue({ error: 'Opencode session.create threw: ECONNRESET' });

    const result = await run({ prompt: 'Durability check' });

    expect(result.status).toBe('error');
    const recorded = new AgentSessionsRepository().findById(result.sessionId);
    expect(recorded?.status).toBe('error');
    expect(recorded?.lastPreview).toContain('ECONNRESET');
  });

  it('issue-1135-c5: rejects a security-locked profile before engine/session work', async () => {
    setDb(new Database(':memory:'));
    runMigrations(getDb());
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'locked-runner-profile',
      label: 'Locked Runner Profile',
      icon: '',
    });
    configsRepo.lockForSecurity(
      'locked-runner-profile',
      'security review required',
      'reviewer',
    );
    getDb()
      .prepare(`UPDATE agent_configs SET enabled = 1 WHERE id = 'locked-runner-profile'`)
      .run();

    const result = await run({
      prompt: 'Must not execute',
      agentConfigId: 'locked-runner-profile',
    });

    expect(result).toMatchObject({
      status: 'error',
      errorCode: 'profile_unavailable',
      error: expect.stringContaining('security-locked'),
    });
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  // ── E. prompt returns null → no output error ──────────────────────────────

  it('returns error when prompt returns null (model produced no output)', async () => {
    mockPrompt.mockResolvedValue(null);

    const result = await run({ prompt: 'Bad prompt' });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/no output/i);
  });

  // ── G. prompt returns null → fast error (replaces no-progress fast-fail) ──

  it('errors fast when model produces no output (prompt returns null)', async () => {
    // prompt() resolves immediately with null — model returned nothing.
    mockPrompt.mockResolvedValue(null);

    const result = await run({ prompt: 'No output test' });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/no output/i);
    // abortSession should NOT be called for a null response (only for timeout)
    expect(mockAbortSession).not.toHaveBeenCalled();
  });

  // ── USO B1 (#1028): category option threaded to the recorded session ──────

  it('records the run session with the caller-supplied category (self_improvement stays is_system=1)', async () => {
    setDb(new Database(':memory:'));
    runMigrations(getDb());
    mockPrompt.mockResolvedValue(makePromptResponse('Done'));

    const result = await run({ prompt: 'Improve a skill', category: 'self_improvement' });
    expect(result.status).toBe('done');

    const recorded = new AgentSessionsRepository().findById(result.sessionId);
    expect(recorded?.category).toBe('self_improvement');
    expect(recorded?.isSystem).toBe(true);
  });

  it('defaults a plain run to category chat', async () => {
    setDb(new Database(':memory:'));
    runMigrations(getDb());
    mockPrompt.mockResolvedValue(makePromptResponse('Done'));

    const result = await run({ prompt: 'Just chat' });
    const recorded = new AgentSessionsRepository().findById(result.sessionId);
    expect(recorded?.category).toBe('chat');
  });

  it('issue-1348-c2: synchronous delegated runs persist their parent link and depth', async () => {
    // Regression caught: delegateToAgent derived depth but AgentRunner inserted
    // a root row, so the sync child survived Chats filtering and could not nest.
    setDb(new Database(':memory:'));
    runMigrations(getDb());
    mockPrompt.mockResolvedValue(makePromptResponse('Delegated result'));
    const parent = new AgentSessionsRepository().insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'Parent chat',
    });

    const result = await run({
      prompt: 'Do delegated work',
      parentSessionId: parent.id,
      delegationDepth: 1,
    });

    const child = new AgentSessionsRepository().findById(result.sessionId);
    expect(child?.parentSessionId).toBe(parent.id);
    expect(child?.delegationDepth).toBe(1);
  });

  // ── dev-dashboard-refresh incident (2026-07-22): a scheduled/headless run
  // hung on a live "Allow?" card for `glob` even though the prompt() call was
  // given permissionMode: 'bypassPermissions'. Root cause: that value was
  // only ever a per-prompt SDK option — it was never persisted onto the
  // session row, and opencode_stream_bridge.ts's auto-accept gate reads the
  // session's own `permission_mode` column (DB default: 'default'), not the
  // per-prompt option. Assert the actual observable fix: the recorded
  // session's persisted permissionMode, not just that some function fired.

  it('persists permissionMode=bypassPermissions on the session row so the stream bridge auto-accepts tool asks', async () => {
    setDb(new Database(':memory:'));
    runMigrations(getDb());
    mockPrompt.mockResolvedValue(makePromptResponse('Done'));

    const result = await run({ prompt: 'Run the daily morning briefing' });

    const recorded = new AgentSessionsRepository().findById(result.sessionId);
    expect(recorded?.permissionMode).toBe('bypassPermissions');
  });

  // ── F. Concurrency cap rejects (N+1)th run ────────────────────────────────

  it('rejects the (N+1)th run when concurrency cap is reached', async () => {
    // Use a very short timeout so the first run completes (times out) promptly
    process.env.AGENT_RUN_TIMEOUT_MS = '100';
    process.env.MAX_CONCURRENT_AGENT_RUNS = '1';

    // First run: prompt never resolves during the run window (times out)
    let firstRunResolve!: (v: null) => void;
    const firstRunPromise_mock = new Promise<null>((resolve) => {
      firstRunResolve = resolve;
    });
    mockPrompt.mockReturnValue(firstRunPromise_mock);

    // Start first run — don't await yet; let it acquire the slot
    const firstRunPromise = run({ prompt: 'First' });

    // Give the first run 20ms to acquire its slot (before timeout fires at 100ms)
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // Second run should be rejected immediately (cap = 1, slot taken)
    const secondResult = await run({ prompt: 'Second' });

    expect(secondResult.status).toBe('error');
    expect(secondResult.error).toMatch(/concurrency cap/i);
    expect(secondResult.errorCode).toBe('capacity');

    // Unblock and await first run (it will time out at 100ms and release slot)
    firstRunResolve(null); // return null so it just times out cleanly
    const firstResult = await firstRunPromise;
    expect(firstResult.status).toBe('error'); // timed out

    // Slot should be released now — a new run should be accepted
    mockPrompt.mockResolvedValue(makePromptResponse('Done'));
    const thirdResult = await run({
      prompt: 'Third (after slot released)',
    });
    // Third run succeeds now that slot is free — no concurrency error
    expect(thirdResult.error ?? '').not.toMatch(/concurrency cap/i);
    expect(thirdResult.status).toBe('done');

    delete process.env.AGENT_RUN_TIMEOUT_MS;
    delete process.env.MAX_CONCURRENT_AGENT_RUNS;
  }, 10_000); // extend test timeout to 10s

  // #1099 — default concurrency cap raised 3 → 8. With no env override, a 4th
  // concurrent run must NOT be capacity-rejected (it would have been under the
  // old default of 3). Asserts the default rose above the old ceiling.
  it('accepts a 4th concurrent run when MAX_CONCURRENT_AGENT_RUNS is unset (default 8)', async () => {
    process.env.AGENT_RUN_TIMEOUT_MS = '200';
    delete process.env.MAX_CONCURRENT_AGENT_RUNS; // fall back to default (8)

    setDb(new Database(':memory:'));
    runMigrations(getDb());

    // Hold 3 runs open so their slots stay taken (never resolve during window).
    const holdResolvers: ((v: null) => void)[] = [];
    mockPrompt.mockImplementation(
      () => new Promise<null>((resolve) => holdResolvers.push(resolve)),
    );
    const held = [run({ prompt: 'A' }), run({ prompt: 'B' }), run({ prompt: 'C' })];
    await new Promise<void>((resolve) => setTimeout(resolve, 30)); // let slots acquire

    // 4th run under the OLD default (3) would be capacity-rejected; under the
    // new default (8) it acquires a slot and instead times out at 200ms.
    const fourth = await run({ prompt: 'D' });
    expect(fourth.errorCode).not.toBe('capacity');
    expect(fourth.error ?? '').not.toMatch(/concurrency cap/i);

    holdResolvers.forEach((r) => r(null)); // release held runs
    await Promise.all(held);

    delete process.env.AGENT_RUN_TIMEOUT_MS;
  }, 10_000);
});
