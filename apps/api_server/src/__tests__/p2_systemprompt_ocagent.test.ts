/**
 * P2 — system_prompt + ocAgent forwarding on both paths (runner + WS)
 *
 * Strategy per docs/ai/decisions/2026-06-24-sdk-per-session-system-prompt.md:
 *   SDK @opencode-ai/sdk 1.14.49 has no per-session system prompt at creation.
 *   Both fields are forwarded via the PER-PROMPT body (session.prompt / promptAsync):
 *     - systemPrompt → `system` key in the prompt opts/body
 *     - ocAgent      → `agent` key in the prompt opts/body
 *
 * Precedence on WS path for `agent`:
 *   per-turn agent override  >  profile ocAgent  >  none
 *
 * GUARDRAIL (#738): `agent_runner.ts` must NOT pass the provider kind ('claude-code' /
 * 'codex') as `agent`. Only the profile's ocAgent (opencode mode 'build'/'plan'/etc.)
 * is forwarded; when ocAgent is null no `agent` field is sent.
 *
 * All tests mock opencode_engine so no real model is hit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';

// ── Hoist mocks ─────────────────────────────────────────────────────────────────

const { mockCreateSession, mockPrompt, mockPromptAsync, mockAbortSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockPromptAsync: vi.fn(),
  mockAbortSession: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    createSession: mockCreateSession,
    prompt: mockPrompt,
    promptAsync: mockPromptAsync,
    abortSession: mockAbortSession,
    listMessages: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

// ── DB helpers ──────────────────────────────────────────────────────────────────

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
    try { activeDb.close(); } catch { /* ignore */ }
    activeDb = null;
  }
}

// ── Runner path tests ───────────────────────────────────────────────────────────

describe('P2 — runner path: system_prompt + ocAgent forwarded in prompt body', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENT_SKILLS_ENABLED;
    delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
    makeDb();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-p2' });
    mockPrompt.mockResolvedValue({
      info: { sessionID: 'sdk-session-p2' },
      parts: [{ type: 'text', text: 'Done' }],
    });
    mockAbortSession.mockResolvedValue(true);
  });

  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
    delete process.env.AGENT_SKILLS_ENABLED;
    delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
  });

  async function freshRun() {
    const { run } = await import('../services/agent_runner');
    return run;
  }

  it('runner path: resolved systemPrompt forwarded as system in prompt body', async () => {
    // Mock resolveProfileScope to return a systemPrompt
    const scopeModule = await import('../services/agent_profile_scope');
    vi.spyOn(scopeModule, 'resolveProfileScope').mockResolvedValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: 'You are a helpful church assistant.',
      ocAgent: null,
      modelTierHint: null,
    });

    const run = await freshRun();
    await run({ prompt: 'Hello' });

    expect(mockPrompt).toHaveBeenCalledOnce();
    const opts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;
    expect(opts).toMatchObject({ system: 'You are a helpful church assistant.' });
  });

  it('runner path: profile ocAgent forwarded as agent in prompt body', async () => {
    const scopeModule = await import('../services/agent_profile_scope');
    vi.spyOn(scopeModule, 'resolveProfileScope').mockResolvedValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: null,
      ocAgent: 'build',
      modelTierHint: null,
    });

    const run = await freshRun();
    await run({ prompt: 'Hello' });

    expect(mockPrompt).toHaveBeenCalledOnce();
    const opts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;
    expect(opts).toMatchObject({ agent: 'build' });
  });

  it('runner path: null ocAgent → NO agent field in prompt body (#738 guardrail)', async () => {
    const scopeModule = await import('../services/agent_profile_scope');
    vi.spyOn(scopeModule, 'resolveProfileScope').mockResolvedValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: null,
      ocAgent: null,
      modelTierHint: null,
    });

    const run = await freshRun();
    await run({ prompt: 'Hello' });

    expect(mockPrompt).toHaveBeenCalledOnce();
    const opts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;
    // No `agent` key — preserving #738 behavior exactly
    expect(Object.prototype.hasOwnProperty.call(opts, 'agent')).toBe(false);
  });

  it('runner path: null systemPrompt → NO system field in prompt body', async () => {
    const scopeModule = await import('../services/agent_profile_scope');
    vi.spyOn(scopeModule, 'resolveProfileScope').mockResolvedValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: null,
      ocAgent: null,
      modelTierHint: null,
    });

    const run = await freshRun();
    await run({ prompt: 'Hello' });

    expect(mockPrompt).toHaveBeenCalledOnce();
    const opts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(opts, 'system')).toBe(false);
  });
});

// ── WS path tests ───────────────────────────────────────────────────────────────

// The WS path is tested by spying on resolveProfileScope and calling handleInputFrame
// via the exported test helper. Since ws_gateway doesn't export handleInputFrame,
// we test it indirectly by mocking resolveProfileScope and asserting on promptAsync.

describe('P2 — WS path: system_prompt + ocAgent forwarded in promptAsync body', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENT_SKILLS_ENABLED;
    delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
    makeDb();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-ws-p2' });
    mockPromptAsync.mockResolvedValue(true);
    mockAbortSession.mockResolvedValue(true);
  });

  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
    delete process.env.AGENT_SKILLS_ENABLED;
    delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
  });

  /**
   * Simulate a WS session.input frame arriving for a session that is already
   * mapped in opencodeSessionMap (no auto-resume needed).
   */
  async function sendWsInput(
    sessionId: string,
    opencodeId: string,
    data: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const { opencodeSessionMap } = await import('../services/opencode_engine');
    (opencodeSessionMap as Map<string, string>).set(sessionId, opencodeId);

    const { handleInputFrame } = await import('../services/ws_gateway');
    const fakeWs = {
      send: vi.fn(),
      readyState: 1, // OPEN
    } as unknown as import('ws').WebSocket;

    const frame: Record<string, unknown> = {
      type: 'session.input',
      id: sessionId,
      data,
      ...extra,
    };

    await handleInputFrame(fakeWs, frame);
  }

  it('WS path: resolved systemPrompt forwarded as system in promptAsync opts', async () => {
    const scopeModule = await import('../services/agent_profile_scope');
    vi.spyOn(scopeModule, 'resolveProfileScope').mockResolvedValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: 'You are a worship planning assistant.',
      ocAgent: null,
      modelTierHint: null,
    });

    await sendWsInput('sess-p2-ws-1', 'sdk-p2-ws-1', 'Plan Sunday worship');

    expect(mockPromptAsync).toHaveBeenCalledOnce();
    const opts = mockPromptAsync.mock.calls[0][4] as Record<string, unknown>;
    expect(opts).toMatchObject({ system: 'You are a worship planning assistant.' });
  });

  it('WS path: profile ocAgent forwarded as agent when no per-turn override', async () => {
    const scopeModule = await import('../services/agent_profile_scope');
    vi.spyOn(scopeModule, 'resolveProfileScope').mockResolvedValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: null,
      ocAgent: 'plan',
      modelTierHint: null,
    });

    // No per-turn agent override in the frame
    await sendWsInput('sess-p2-ws-2', 'sdk-p2-ws-2', 'Plan the service');

    expect(mockPromptAsync).toHaveBeenCalledOnce();
    const opts = mockPromptAsync.mock.calls[0][4] as Record<string, unknown>;
    expect(opts).toMatchObject({ agent: 'plan' });
  });

  it('WS path: per-turn agent override takes precedence over profile ocAgent', async () => {
    const scopeModule = await import('../services/agent_profile_scope');
    vi.spyOn(scopeModule, 'resolveProfileScope').mockResolvedValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: null,
      ocAgent: 'plan',
      modelTierHint: null,
    });

    // Per-turn override 'build' should win over profile 'plan'
    await sendWsInput('sess-p2-ws-3', 'sdk-p2-ws-3', 'Build something', { agent: 'build' });

    expect(mockPromptAsync).toHaveBeenCalledOnce();
    const opts = mockPromptAsync.mock.calls[0][4] as Record<string, unknown>;
    expect(opts).toMatchObject({ agent: 'build' });
  });

  it('WS path: null profile ocAgent + no per-turn override → NO agent field', async () => {
    const scopeModule = await import('../services/agent_profile_scope');
    vi.spyOn(scopeModule, 'resolveProfileScope').mockResolvedValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      mcpRoleConfig: null,
      allowedSkillsJson: null,
      systemPrompt: null,
      ocAgent: null,
      modelTierHint: null,
    });

    await sendWsInput('sess-p2-ws-4', 'sdk-p2-ws-4', 'Hello');

    expect(mockPromptAsync).toHaveBeenCalledOnce();
    const opts = mockPromptAsync.mock.calls[0][4] as Record<string, unknown> | undefined;
    // Neither per-turn nor profile agent + no systemPrompt → sdkOpts is undefined OR
    // an object with no `agent` key — either way, `agent` must not be present.
    const hasAgent = opts != null && Object.prototype.hasOwnProperty.call(opts, 'agent');
    expect(hasAgent).toBe(false);
  });
});
