/**
 * USO B5 (#1032) — skill_extractor's default (real) LLM path must route the
 * distill turn through AgentRunner.run({ category: 'self_improvement' }) rather
 * than a bespoke opencodeClient.createSession + prompt.
 *
 * The other B5 "targets" have NOTHING to migrate and so have no routing test:
 *   • harvested_skill_evaluator.ts delegates its LLM calls to
 *     skill_refiner.scoreSkillBody / rewriteSkillBody (a separate file/agent).
 *   • skill_consolidation_drafter.ts / memory_consolidation_drafter.ts are
 *     deliberately mechanical string merges with no LLM call at all.
 * See the audit comment block at the top of skill_extractor.ts's defaultLlmCall.
 *
 * This test mocks ./agent_runner so no live model/engine is touched: it asserts
 * the exact run() options the migration is required to pass. The isTestEnv()
 * guard is lifted (VITEST cleared) so distillFromSession runs its real path and
 * actually reaches defaultLlmCall (no injected llmCall).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { distillFromSession } from '../services/skill_extractor';

const { runSpy } = vi.hoisted(() => ({ runSpy: vi.fn() }));

vi.mock('../services/agent_runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/agent_runner')>();
  return {
    ...actual,
    run: runSpy,
    resolveRunModel: () => ({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' }),
  };
});

const SESSION_ID = 'sess-routing-1';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedSession(id: string): void {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name)
       VALUES (?, 'claude-code', 'idle', '/tmp', 'routing-test')`,
    )
    .run(id);
}

function seedRounds(sessionId: string, rounds: number): void {
  const msgRepo = new AgentSessionMessagesRepository();
  for (let i = 0; i < rounds; i++) {
    msgRepo.append(sessionId, 'input', `user turn ${i}`, `user turn ${i}`);
    msgRepo.append(sessionId, 'output', `assistant turn ${i}`, `assistant turn ${i}`);
  }
}

describe('skill_extractor — USO B5 routes the distill loop through AgentRunner.run', () => {
  let savedVitest: string | undefined;
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    setDb(makeDb());
    seedSession(SESSION_ID);
    runSpy.mockReset();
    // Decline (bare 'null') so distillFromSession returns early — this test only
    // cares about HOW the LLM was invoked, not the downstream draft-write path.
    runSpy.mockResolvedValue({ sessionId: 'oc-1', result: 'null', status: 'done' });
    savedVitest = process.env.VITEST;
    savedNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    if (savedVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = savedVitest;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  it('invokes run() with category self_improvement, a zero-MCP/zero-skill scope, cheap tier, and the distill prompt', async () => {
    seedRounds(SESSION_ID, 2);

    // No injected llmCall — the real defaultLlmCall (→ run()) is exercised.
    const result = await distillFromSession(SESSION_ID);

    expect(result).toBeNull(); // 'null' response → declined
    expect(runSpy).toHaveBeenCalledTimes(1);

    const opts = runSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.category).toBe('self_improvement');
    expect(opts.sessionName).toBe('skill-extract');
    expect(opts.mcpRole).toBe('skill-extract');
    expect(opts.allowedMcpsJson).toBe('{}');
    // #1110 — deny-all skills so the engine's system prompt carries no
    // ~104-skill listing (mirrors the existing allowedMcpsJson: '{}').
    expect(opts.allowedSkillsJson).toBe('[]');
    // agentConfigId is intentionally NOT passed (keeps the zero-tool config).
    expect(opts.agentConfigId).toBeUndefined();
    // The distill prompt (system + transcript) is forwarded verbatim.
    expect(String(opts.prompt)).toContain('Conversation:');
    expect(String(opts.prompt)).toContain("Extract a reusable 'skill'");
    // #1110 — cheap tier via taskKind, NOT the extracting session's own
    // (potentially frontier) model. No modelOverride is forced anymore.
    expect(opts.taskKind).toBe('summarization');
    expect(opts.modelOverride).toBeUndefined();
  });

  it('maps a run() error to the empty-string decline path (no draft, no throw)', async () => {
    seedRounds(SESSION_ID, 2);
    runSpy.mockResolvedValue({ sessionId: '', result: '', status: 'error', error: 'boom' });

    const result = await distillFromSession(SESSION_ID);

    expect(result).toBeNull();
    expect(runSpy).toHaveBeenCalledTimes(1);
  });
});
