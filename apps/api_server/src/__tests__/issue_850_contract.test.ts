/**
 * CONTRACT TEST for issue #850 (org-optimizer-16: live run-loop trigger tool)
 * — must fail before `org_optimizer_run_service.ts` exists, then pass once
 * `runOrgOptimizer()` is implemented. See docs/ai/contracts/issue-850.json
 * for the criterion mapping.
 *
 * `runOrgOptimizer` is the server-side orchestration the new
 * `rhythm_run_org_optimizer` MCP tool calls: build the audit snapshot -> run
 * the generators -> persist proposals (deduped) -> auto-apply low-risk ones
 * -> leave high-risk ones 'proposed' -> return a run summary.
 *
 * Covers:
 *  - issue-850-c1: one server-side op runs audit->generate->persist->auto-apply;
 *    a high-risk kind is never auto-applied (stays 'proposed').
 *  - issue-850-c2: per-run proposal cap is enforced — the loop stops creating
 *    new proposals once the cap is hit and reports the run as capped.
 *  - issue-850-c3: the #746 cold-start window skips the run entirely (no
 *    snapshot build, no proposals) rather than forcing a run against a cold
 *    engine.
 *  - issue-850-c4: the org-optimizer role file grants the new tool and a
 *    differently-scoped session's dispatch-guard check denies it (Layer 2 —
 *    mcp_dispatch_guard.isToolAllowed).
 *  - issue-850-c5: the returned summary reports counts by kind/risk/outcome.
 *  - issue-850-c6: every proposal created by one run shares that run's
 *    audit_run_id.
 *  - issue-850-c7: re-running against an unchanged snapshot does not create
 *    duplicate proposals (dedup_key idempotency, already enforced by the
 *    repository — this proves the run loop doesn't bypass it).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { isToolAllowed } from '../services/mcp_dispatch_guard';
import { resetProposalPluginsForTests } from '../services/org_proposal_apply_service';

// ── opencode_engine mock — controls isReady / listMcp / listSkills per test ──
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

// ── #746 cold-start mock — controls the engine-ready timestamp per test ─────
vi.mock('../services/skill_extractor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/skill_extractor')>();
  return { ...actual };
});

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
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

afterEach(() => {
  vi.restoreAllMocks();
});

/** Seeds a profile with one dead MCP scope name -> a deterministic prune-scope gap (low-risk). */
function seedDeadScopeProfile(id = 'secretary'): void {
  const configsRepo = new AgentConfigsRepository();
  configsRepo.insert({
    id,
    label: 'Secretary',
    icon: 'x',
    allowedMcpsJson: JSON.stringify(['rhythm', 'dead-server']),
  });
}

describe('issue-850-c1: runOrgOptimizer executes audit->generate->persist->auto-apply; high-risk kinds never auto-apply', () => {
  it('W1: the auto-apply lane is still wired, and only ever sees low-risk work', async () => {
    // Coverage hole this closes: every other test in this describe asserts what
    // must NOT auto-apply. Once scope kinds became human-gated, no test drove a
    // proposal THROUGH the lane — deleting the autoApplyProposal call left the
    // suite green.
    //
    // Be honest about what this proves: the run below cannot drive anything
    // THROUGH the lane, because every kind this fixture generates is high-risk.
    // So the coverage is structural — it fails if the call is deleted, and
    // nothing more. A behavioural test needs a generator that emits a low-risk
    // kind, which this fixture has no way to produce.
    const apply = await import('../services/org_proposal_apply');
    const seen: Array<{ kind: string; risk: string }> = [];
    const spy = vi
      .spyOn(apply, 'applyProposal')
      .mockImplementation(async (proposal) => {
        seen.push({ kind: proposal.kind, risk: proposal.risk });
        return { status: 'applied-ok' as const };
      });
    seedDeadScopeProfile();

    try {
      const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
      await runOrgOptimizer();
    } finally {
      spy.mockRestore();
    }

    // Every kind this fixture can generate is high-risk, so `seen` is empty and
    // any assertion over it would be vacuous. Assert that fact directly instead
    // of dressing it up as behavioural coverage.
    expect(seen).toEqual([]);

    const runService = readFileSync(
      path.join(__dirname, '..', 'services', 'org_optimizer_run_service.ts'),
      'utf8',
    );
    expect(runService).toMatch(
      /const applyResult = await autoApplyProposal\(proposal, \{ proposalsRepo: realProposalsRepo \}\);/,
    );
    expect(runService).toMatch(/result\.byOutcome\.autoApplied \+= 1;/);
  });

  it('a prune-scope gap is persisted but stays proposed — scope removal is human-gated, never auto-applied (W1)', async () => {
    // Bug this catches: the run loop only builds the snapshot/generates but
    // never persists gaps, leaving every gap unactioned as if the loop were a
    // no-op read. Prior to the W1 self-improvement-engine-foundation review
    // this gap auto-applied past 'proposed' (risk='low'); tighten-scope/
    // prune-scope are now HIGH-risk, so the correct outcome is that the run
    // loop persists the gap and leaves it sitting in the human-gate queue.
    seedDeadScopeProfile();

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    const result = await runOrgOptimizer();

    const proposalsRepo = new AgentOrgProposalsRepository();
    const pruneProposal = (await proposalsRepo.listByStatusAsync('proposed')).find(
      (p) => p.kind === 'prune-scope',
    );

    expect(pruneProposal).toBeDefined();
    expect(pruneProposal?.risk).toBe('high');
    expect(result.auditRunId).toBeTruthy();

    // Never auto-applied: no scope-kind row exists in any auto-apply-lane status.
    const nonProposedStatuses = ['applied', 'measuring', 'active', 'reverted'];
    for (const status of nonProposedStatuses) {
      const rows = await proposalsRepo.listByStatusAsync(status);
      expect(rows.some((p) => p.kind === 'prune-scope')).toBe(false);
    }
  });

  it('a high-risk kind proposal generated THIS run (webhook-wiring) is NEVER auto-applied — it stays proposed', async () => {
    // Bug this catches: the run loop calls applyProposal (or an equivalent
    // auto-apply step) indiscriminately over every newly-created proposal
    // instead of gating on classifyProposalRisk, letting a HIGH-risk kind
    // slip through the auto-apply lane. Drives a REAL generator
    // (webhook_wiring_generator, invoked by runOrgOptimizer itself) rather
    // than pre-seeding a proposal out-of-band, so this proves the run loop's
    // OWN post-generation handling of a proposal it just created — a
    // regression here (e.g. auto-applying every row in `newlyCreated`
    // without checking risk) is what this test is designed to catch.
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x' });

    const sessionsRepo = new AgentSessionsRepository();
    for (let i = 0; i < 3; i++) {
      sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        taskTitle: 'Inbound: weekly giving report email',
        cwd: '/tmp',
        name: `session-${i}`,
      } as Parameters<typeof sessionsRepo.insert>[0]);
    }

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    await runOrgOptimizer();

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    const webhookProposal = proposed.find((p) => p.kind === 'webhook-wiring');
    expect(webhookProposal).toBeDefined();
    expect(webhookProposal?.risk).toBe('high');

    // The defining assertion: this high-risk proposal must NOT appear in any
    // auto-apply-lane status (applied/measuring/active/reverted).
    const nonProposedStatuses = ['applied', 'measuring', 'active', 'reverted'];
    for (const status of nonProposedStatuses) {
      const rows = await proposalsRepo.listByStatusAsync(status);
      expect(rows.some((p) => p.kind === 'webhook-wiring')).toBe(false);
    }
  });
});

describe('issue-850-c2: per-run proposal cap is enforced', () => {
  it('stops creating new proposals once maxProposalsPerRun is reached and reports the run as capped', async () => {
    // Bug this catches: the run loop has no cap, so a pathological snapshot
    // (many gaps) could write an unbounded number of proposals in one run,
    // violating the #830 per-run budget invariant.
    const configsRepo = new AgentConfigsRepository();
    for (let i = 0; i < 5; i++) {
      configsRepo.insert({
        id: `profile-${i}`,
        label: `Profile ${i}`,
        icon: 'x',
        allowedMcpsJson: JSON.stringify(['rhythm', `dead-server-${i}`]),
      });
    }

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    const result = await runOrgOptimizer({ maxProposalsPerRun: 2 });

    expect(result.proposalsCreated).toBeLessThanOrEqual(2);
    expect(result.capped).toBe(true);
  });
});

describe('issue-850-c3: #746 cold-start throttle is respected', () => {
  it('skips the run entirely (no proposals) while the engine is within its cold-start window', async () => {
    // Bug this catches: the run loop ignores the #746 cold-start guard and
    // forces a full audit+generate+apply pass immediately after engine init,
    // contending with the first interactive session's own engine calls.
    const { notifyEngineReady } = await import('../services/skill_extractor');
    notifyEngineReady(Date.now()); // engine just became ready -> inside the 90s window

    seedDeadScopeProfile();

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    const result = await runOrgOptimizer();

    expect(result.skippedReason).toMatch(/cold.?start/i);
    expect(result.proposalsCreated).toBe(0);

    const proposalsRepo = new AgentOrgProposalsRepository();
    const all = await proposalsRepo.listByStatusAsync('proposed');
    expect(all.length).toBe(0);
  });
});

describe('issue-850-c4: rhythm_run_org_optimizer is scoped to the org-optimizer role', () => {
  it('the org-optimizer .mcp-roles file grants rhythm_run_org_optimizer', () => {
    // Bug this catches: the tool is implemented but never added to the role
    // file's allowedTools, so the optimizer agent itself could never call it.
    const roleFilePath = path.join(__dirname, '..', '..', '..', '..', '.mcp-roles', 'org-optimizer.mcp.json');
    const roleFile = JSON.parse(readFileSync(roleFilePath, 'utf8'));
    expect(roleFile.mcpServers.rhythm.allowedTools).toContain('rhythm_run_org_optimizer');
  });

  it('a session scoped to the org-optimizer allowlist is allowed to dispatch the tool', () => {
    // Mirrors the REAL persisted shape built by agent_sessions_controller.ts's
    // create-session path: { [serverName]: string[] } (a bare per-server tool
    // array), NOT the raw .mcp-roles nested { inherit, allowedTools } shape.
    const roleFilePath = path.join(__dirname, '..', '..', '..', '..', '.mcp-roles', 'org-optimizer.mcp.json');
    const roleFile = JSON.parse(readFileSync(roleFilePath, 'utf8'));
    const allowedToolsJson = JSON.stringify({
      rhythm: roleFile.mcpServers.rhythm.allowedTools,
    });
    expect(isToolAllowed('rhythm_run_org_optimizer', allowedToolsJson)).toBe(true);
    expect(isToolAllowed('mcp__rhythm__rhythm_run_org_optimizer', allowedToolsJson)).toBe(true);
  });

  it('a non-optimizer session (e.g. secretary scope) calling the tool is denied by the dispatch guard', () => {
    // Bug this catches: the tool is granted broadly (e.g. via an inherit-all
    // array form) instead of being scoped ONLY to the org-optimizer role, so
    // any roled session could trigger a full org-optimizer run.
    const secretaryAllowlist = JSON.stringify({
      rhythm: ['rhythm_list_tasks', 'rhythm_create_task', 'rhythm_send_message'],
    });
    expect(isToolAllowed('rhythm_run_org_optimizer', secretaryAllowlist)).toBe(false);
    expect(isToolAllowed('mcp__rhythm__rhythm_run_org_optimizer', secretaryAllowlist)).toBe(false);
  });
});

describe('issue-850-c5: run summary reports counts by kind/risk/outcome', () => {
  it('the summary breaks down proposals by kind, risk, and outcome', async () => {
    // Bug this catches: the loop runs successfully but returns only a bare
    // success flag, giving the calling agent (and a human reading the audit
    // trail) no visibility into what actually happened this run.
    seedDeadScopeProfile();

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    const result = await runOrgOptimizer();

    expect(result.byKind).toBeDefined();
    expect(result.byRisk).toBeDefined();
    expect(result.byOutcome).toBeDefined();
    expect(typeof result.proposalsCreated).toBe('number');
    expect(result.byRisk.low + result.byRisk.high).toBe(result.proposalsCreated);
  });
});

describe('issue-850-c6: every proposal from one run shares its audit_run_id', () => {
  it('proposals created during the run are all tagged with the returned auditRunId', async () => {
    // Bug this catches: the run loop calls each generator without passing
    // through (or persisting) a shared auditRunId, breaking the audit-trail
    // link between a run summary and the rows it produced.
    seedDeadScopeProfile('secretary-a');
    seedDeadScopeProfile('secretary-b');

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    const result = await runOrgOptimizer();

    const proposalsRepo = new AgentOrgProposalsRepository();
    const created = [
      ...(await proposalsRepo.listByStatusAsync('proposed')),
      ...(await proposalsRepo.listByStatusAsync('applied')),
      ...(await proposalsRepo.listByStatusAsync('measuring')),
      ...(await proposalsRepo.listByStatusAsync('active')),
    ];

    expect(created.length).toBeGreaterThan(0);
    for (const p of created) {
      expect(p.auditRunId).toBe(result.auditRunId);
    }
  });
});

describe('issue-850-c7: idempotent re-runs dedup unchanged gaps', () => {
  it('running the loop twice against the same unchanged snapshot creates no duplicate proposals', async () => {
    // Bug this catches: the run loop (or a generator it calls) skips the
    // existing dedup_key check and re-creates a proposal for a gap already
    // seen on a prior run, spamming the queue every time the optimizer fires.
    seedDeadScopeProfile();

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    const first = await runOrgOptimizer();
    expect(first.proposalsCreated).toBeGreaterThan(0);

    const second = await runOrgOptimizer();
    expect(second.proposalsCreated).toBe(0);

    const proposalsRepo = new AgentOrgProposalsRepository();
    const all = [
      ...(await proposalsRepo.listByStatusAsync('proposed')),
      ...(await proposalsRepo.listByStatusAsync('applied')),
      ...(await proposalsRepo.listByStatusAsync('measuring')),
      ...(await proposalsRepo.listByStatusAsync('active')),
      ...(await proposalsRepo.listByStatusAsync('reverted')),
    ];
    const pruneRows = all.filter((p) => p.kind === 'prune-scope' && p.targetRef?.includes('secretary'));
    expect(pruneRows.length).toBe(1);
  });
});
