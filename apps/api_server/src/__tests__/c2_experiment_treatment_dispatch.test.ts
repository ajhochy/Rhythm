/**
 * C2 — wire the system-prompt-v1 treatment adapter into the real prompt
 * dispatch boundary (contract docs/ai/contracts/issue-causal-runtime-v2.json,
 * phase C2, next slice after the closed adapter registry).
 *
 * Required behavior under test: "At prompt dispatch, baseline passes the
 * exact baseline system prompt as an explicit run-scoped system override;
 * candidate passes the exact candidate system prompt. This override must
 * work even when the OpenCode agent name equals the target profile; do not
 * omit it as a duplicate."
 *
 * Mirrors the mocking pattern in p2_systemprompt_ocagent.test.ts — no real
 * model/engine is hit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { env } from '../config/env';

const { mockCreateSession, mockPrompt, mockAbortSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockAbortSession: vi.fn(),
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

const SPEC = {
  agentConfigId: 'agent-1',
  field: 'system_prompt' as const,
  priorValue: 'original prompt',
  currentValue: 'you are a helpful assistant',
  candidateValue: 'you are a careful, precise assistant',
  evidenceTarget: { ref: 'agent_configs/agent-1', hash: 'sha256:abc' },
};

let originalTreatmentV2Enabled: boolean;

describe('C2 — experiment treatment wired into the prompt dispatch boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeDb();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-c2' });
    mockPrompt.mockResolvedValue({
      info: { sessionID: 'sdk-session-c2' },
      parts: [{ type: 'text', text: 'Done' }],
    });
    mockAbortSession.mockResolvedValue(true);
    // C6 item 1 — the opts.experimentTreatment fallback this suite exercises
    // now applies only when treatment-v2 is enabled.
    originalTreatmentV2Enabled = env.treatmentV2Enabled;
    env.treatmentV2Enabled = true;
  });

  afterEach(() => {
    env.treatmentV2Enabled = originalTreatmentV2Enabled;
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

  it('baseline cohort forwards the exact currentValue as the system override', async () => {
    await mockScope();
    const run = await freshRun();
    await run({
      prompt: 'Hello',
      experimentTreatment: { adapter: 'system-prompt-v1', cohort: 'baseline', spec: SPEC },
    } as never);

    const opts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;
    expect(opts.system).toBe(SPEC.currentValue);
  });

  it('candidate cohort forwards the exact candidateValue as the system override', async () => {
    await mockScope();
    const run = await freshRun();
    await run({
      prompt: 'Hello',
      experimentTreatment: { adapter: 'system-prompt-v1', cohort: 'candidate', spec: SPEC },
    } as never);

    const opts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;
    expect(opts.system).toBe(SPEC.candidateValue);
  });

  it('baseline and candidate produce distinct effective system prompts for the same run shape', async () => {
    await mockScope();
    const run = await freshRun();

    await run({
      prompt: 'Hello',
      experimentTreatment: { adapter: 'system-prompt-v1', cohort: 'baseline', spec: SPEC },
    } as never);
    const baselineOpts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;

    mockPrompt.mockClear();
    await run({
      prompt: 'Hello',
      experimentTreatment: { adapter: 'system-prompt-v1', cohort: 'candidate', spec: SPEC },
    } as never);
    const candidateOpts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;

    expect(baselineOpts.system).not.toBe(candidateOpts.system);
  });

  it('the override is not omitted even when the OpenCode agent name equals the target profile', async () => {
    // #1039 Cause B normally SUPPRESSES the system override when
    // ocAgent === agentConfigId (the .md body already carries the prompt).
    // A treatment override must win anyway — it is not "a duplicate", it is
    // the bound experimental treatment.
    await mockScope({ ocAgent: 'agent-1', systemPrompt: 'you are a helpful assistant' });
    const run = await freshRun();
    await run({
      prompt: 'Hello',
      agentConfigId: 'agent-1',
      experimentTreatment: { adapter: 'system-prompt-v1', cohort: 'candidate', spec: SPEC },
    } as never);

    const opts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;
    expect(opts.system).toBe(SPEC.candidateValue);
  });

  it('C6 item 1 — the override never applies when treatment-v2 is disabled; dispatch is ordinary and untreated', async () => {
    env.treatmentV2Enabled = false;
    await mockScope();
    const run = await freshRun();
    await run({
      prompt: 'Hello',
      experimentTreatment: { adapter: 'system-prompt-v1', cohort: 'candidate', spec: SPEC },
    } as never);

    const opts = mockPrompt.mock.calls[0][4] as Record<string, unknown>;
    // Bug this catches: a disabled flag that still forwarded the
    // caller-supplied fallback spec as if it were a real experiment.
    expect(opts.system).not.toBe(SPEC.candidateValue);
    expect(opts.system).not.toBe(SPEC.currentValue);
  });
});
