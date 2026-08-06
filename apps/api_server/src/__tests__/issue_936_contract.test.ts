/**
 * CONTRACT TEST for issue #936 — dedup, per-run caps, and stale-fixed
 * safeguards for workflow-signal-driven Org Optimizer proposals.
 *
 * Most of the individual safeguards already exist by construction from
 * #933 (extractor-level stale-fixed checks + per-run signal cap) and #935
 * (stable dedup keys + reuse of the run loop's existing capped/dedup-aware
 * repo). This file proves those safeguards hold END-TO-END through the FULL
 * pipeline (extractor -> snapshot -> generator -> runOrgOptimizer), not just
 * in each module's own isolated unit tests.
 *
 * Covers:
 *  - issue-936-c1: running runOrgOptimizer twice over an UNCHANGED
 *    missing-scope pattern creates the proposal only once (dedup_key
 *    idempotency survives the full run loop, not just the generator).
 *  - issue-936-c2: the shared per-run proposal cap holds even when many
 *    distinct workflow-derived signals are seeded in one run.
 *  - issue-936-c3: a stale-fixed missing-scope signal (tool since granted)
 *    never reaches a proposal via the full run loop.
 *  - issue-936-c4: a stale-fixed stale-redo signal (issue since closed
 *    cleanly) never reaches a proposal via the full run loop.
 *  - issue-936-c5: unknown-confidence delegate evidence never creates a
 *    proposal, even across repeated runs as more ambiguous evidence
 *    accumulates.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { DeniedToolEventsRepository } from '../repositories/denied_tool_events_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { resetProposalPluginsForTests } from '../services/org_proposal_apply_service';

// ── opencode_engine mock — mirrors issue_850_contract.test.ts ──────────────
const listMcp = vi.fn();
const listSkills = vi.fn();
let mockIsReady = true;

vi.mock('../services/opencode_engine', () => ({
  get opencodeClient() {
    return {
      get isReady() {
        return mockIsReady;
      },
      listMcp: (...a: unknown[]) => listMcp(...a),
      listSkills: (...a: unknown[]) => listSkills(...a),
    };
  },
  opencodeSessionMap: new Map(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function rawUpdate(table: string, id: string, fields: Record<string, string>): void {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...Object.values(fields), id);
}

beforeEach(async () => {
  setDb(makeDb());
  resetProposalPluginsForTests();
  mockIsReady = true;
  listMcp.mockReset().mockResolvedValue({ rhythm: { name: 'rhythm' } });
  listSkills.mockReset().mockResolvedValue([]);
  const { _resetEngineReadyForTests } = await import('../services/skill_extractor');
  _resetEngineReadyForTests();
});

describe('issue-936-c1: re-running the full loop over an unchanged missing-scope pattern does not duplicate', () => {
  it('creates the broaden-scope proposal once across two runs', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x', allowedMcpsJson: JSON.stringify(['rhythm']) });

    const deniedRepo = new DeniedToolEventsRepository();
    await deniedRepo.recordAsync({ sessionId: 'sess-1', agentConfigId: 'secretary', toolName: 'nfl_mcp' });

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    const first = await runOrgOptimizer();
    expect(first.byKind['broaden-scope']).toBe(1);

    const second = await runOrgOptimizer();
    expect(second.byKind['broaden-scope'] ?? 0).toBe(0);

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    expect(proposed.filter((p) => p.kind === 'broaden-scope')).toHaveLength(1);
  });
});

describe('issue-936-c2: the shared per-run cap holds for workflow-derived proposals', () => {
  it('stops creating new proposals once maxProposalsPerRun is reached, even with many distinct denials seeded', async () => {
    const configsRepo = new AgentConfigsRepository();
    const deniedRepo = new DeniedToolEventsRepository();
    for (let i = 0; i < 8; i++) {
      const id = `profile-${i}`;
      // The profiles must be SCOPED for these denials to be real missing-scope
      // signals: an unrestricted profile (allowedMcpsJson=null) already reaches
      // every server, so "grant it nfl_mcp" is not a gap — and applying it would
      // REPLACE unrestricted access with `["nfl_mcp"]` alone. The optimizer now
      // refuses to file that (org_optimizer_scope_false_positives.test.ts).
      configsRepo.insert({ id, label: id, icon: 'x', allowedMcpsJson: JSON.stringify(['rhythm']) });
      await deniedRepo.recordAsync({ sessionId: `sess-${i}`, agentConfigId: id, toolName: 'nfl_mcp' });
    }

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    const result = await runOrgOptimizer({ maxProposalsPerRun: 3 });

    expect(result.proposalsCreated).toBeLessThanOrEqual(3);
    expect(result.capped).toBe(true);
  });
});

describe('issue-936-c3: a stale-fixed missing-scope signal never reaches a proposal via the full run loop', () => {
  it('no broaden-scope proposal is created once the tool is already granted', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm', 'nfl_mcp']), // already granted since the historical denial
    });

    const deniedRepo = new DeniedToolEventsRepository();
    await deniedRepo.recordAsync({ sessionId: 'sess-1', agentConfigId: 'secretary', toolName: 'nfl_mcp' });

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    await runOrgOptimizer();

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    expect(proposed.some((p) => p.kind === 'broaden-scope')).toBe(false);
  });
});

describe('issue-936-c4: a stale-fixed stale-redo signal never reaches a proposal via the full run loop', () => {
  it('no create-recipe proposal is created once the latest attempt at the issue reached a clean terminal status', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const s1 = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: 'Fix bug #77',
      cwd: '/tmp',
      name: 's1',
      mcpRole: 'secretary',
    });
    sessionsRepo.setErrorStatus(s1.id, 'broken');
    rawUpdate('agent_sessions', s1.id, { created_at: new Date(Date.now() - 60_000).toISOString() });

    const s2 = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: 'Fix bug #77 retry',
      cwd: '/tmp',
      name: 's2',
      mcpRole: 'secretary',
    });
    sessionsRepo.updateStatus(s2.id, 'closed'); // the redo ultimately succeeded — issue is now fixed

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    await runOrgOptimizer();

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    expect(
      proposed.some((p) => p.kind === 'create-recipe' && p.rationale?.includes('stale-redo')),
    ).toBe(false);
  });
});

describe('issue-936-c5: unknown-confidence delegate evidence never creates a persistent proposal', () => {
  it('produces no proposal across repeated runs, even as more ambiguous evidence accumulates', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const parent = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'parent' });

    for (let i = 0; i < 3; i++) {
      const child = sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `child-${i}`,
        mcpRole: 'research',
      });
      rawUpdate('agent_sessions', child.id, { parent_session_id: parent.id, status: 'working' });
      // Fresh (not stale) in-flight children -> delegateOutcome='unknown'.
    }

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    await runOrgOptimizer();
    await runOrgOptimizer();

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    expect(proposed.some((p) => p.rationale?.includes('delegate-result'))).toBe(false);
  });
});
