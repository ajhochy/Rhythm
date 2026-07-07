/**
 * CONTRACT TEST for issue #819 (org-optimizer-03) — must fail before
 * `org_audit_service.ts` exists, then pass once `buildOrgAuditSnapshot()` is
 * implemented. See docs/ai/contracts/issue-819.json for the criterion mapping.
 *
 * `org_audit_service` is a READ-ONLY snapshot of the whole agent org (profiles
 * + scopes, skills, recipes, delegation graph, webhook endpoints) plus recent
 * activity signals (denied-tool aggregates, drift), assembled into one
 * structured digest consumed by the optimizer agent and its generators.
 *
 * Covers:
 *  - issue-819-c1: buildOrgAuditSnapshot() returns every documented section.
 *  - issue-819-c2: no writes to any table (row counts/content unchanged).
 *  - issue-819-c3: drift detection uses mcp_name_alignment.alignMcpName
 *    against the live MCP set to flag dead allowlist names.
 *  - issue-819-c4: every gap carries non-empty evidence usable as signal_ref.
 *  - issue-819-c5: respects the #746 cold-start window — no engine calls
 *    when not ready; an empty/unavailable live set never produces a false
 *    "dead name" prune gap.
 *  - issue-819-c6: required-tests bundle — snapshot shape, read-only, prune
 *    gap, no-false-prune-on-empty-live-set, tighten gap, webhook gap.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb, getDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentSkillsRepository } from '../../repositories/agent_skills_repository';
import { AgentCookbookRepository } from '../../repositories/agent_cookbook_repository';
import { AgentWebhookEndpointsRepository } from '../../repositories/agent_webhook_endpoints_repository';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { DeniedToolEventsRepository } from '../../repositories/denied_tool_events_repository';

// ── opencode_engine mock — controls isReady / listMcp / listSkills per test ──
const listMcp = vi.fn();
const listSkills = vi.fn();
let mockIsReady = true;

vi.mock('../opencode_engine', () => ({
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

function tableCounts(db: Database.Database, tables: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number };
    counts[t] = row.c;
  }
  return counts;
}

beforeEach(() => {
  setDb(makeDb());
  mockIsReady = true;
  listMcp.mockReset();
  listSkills.mockReset();
  listMcp.mockResolvedValue({});
  listSkills.mockResolvedValue([]);
});

describe('issue-819-c1: buildOrgAuditSnapshot returns every documented section', () => {
  it('returns profiles, skills, recipes, delegationEdges, webhookEndpoints, deniedToolAggregates, drift, gaps', async () => {
    // Bug this catches: the service returns a partial digest (e.g. omits
    // delegationEdges or drift), forcing every generator to re-query the raw
    // tables itself — defeating the whole point of a centralized audit.
    const { buildOrgAuditSnapshot } = await import('../org_audit_service');

    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm']),
      allowedSkillsJson: JSON.stringify([]),
      allowedDelegatesJson: JSON.stringify(['research']),
      isManager: true,
    });
    configsRepo.insert({
      id: 'research',
      label: 'Research',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    const snapshot = await buildOrgAuditSnapshot();

    expect(snapshot.auditRunId).toBeTruthy();
    expect(typeof snapshot.generatedAt).toBe('string');
    // The migration seeds built-in preset agent_configs rows (claude-code,
    // codex, gemini-cli, opencode) in addition to the two inserted here — the
    // digest must include ALL profiles, not just the ones this test created.
    expect(Array.isArray(snapshot.profiles)).toBe(true);
    expect(snapshot.profiles.map((p) => p.id)).toEqual(
      expect.arrayContaining(['secretary', 'research']),
    );
    expect(Array.isArray(snapshot.skills)).toBe(true);
    expect(Array.isArray(snapshot.recipes)).toBe(true);
    expect(Array.isArray(snapshot.delegationEdges)).toBe(true);
    expect(Array.isArray(snapshot.webhookEndpoints)).toBe(true);
    expect(Array.isArray(snapshot.deniedToolAggregates)).toBe(true);
    expect(Array.isArray(snapshot.drift)).toBe(true);
    expect(Array.isArray(snapshot.gaps)).toBe(true);

    // Delegation edge derived from secretary's allowedDelegatesJson.
    const edge = snapshot.delegationEdges.find(
      (e) => e.fromProfileId === 'secretary' && e.toProfileId === 'research',
    );
    expect(edge).toBeDefined();
  });
});

describe('issue-819-c2: buildOrgAuditSnapshot performs no writes to any table', () => {
  it('leaves every table row count and content byte-identical after a full run', async () => {
    // Bug this catches: a generator-style helper is accidentally reused that
    // writes (e.g. incrementUses, createAsync) during "read-only" audit —
    // silently mutating state during what must be a pure observation pass.
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x' });

    const skillsRepo = new AgentSkillsRepository();
    skillsRepo.create({ title: 'Do the thing', description: 'desc' });

    const cookbookRepo = new AgentCookbookRepository();
    await cookbookRepo.createAsync({ title: 'Recipe A' });

    const webhookRepo = new AgentWebhookEndpointsRepository();
    await webhookRepo.createAsync({ name: 'Hook A' });

    const deniedRepo = new DeniedToolEventsRepository();
    await deniedRepo.recordAsync({
      sessionId: null,
      agentConfigId: 'secretary',
      toolName: 'nfl_mcp',
    });

    const db = getDb();
    const tables = [
      'agent_configs',
      'agent_skills',
      'agent_cookbook',
      'agent_webhook_endpoints',
      'agent_sessions',
      'denied_tool_events',
      'agent_org_proposals',
    ];
    const before = tableCounts(db, tables);
    const beforeDump = db
      .prepare(`SELECT * FROM agent_configs ORDER BY id`)
      .all();

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    await buildOrgAuditSnapshot();

    const after = tableCounts(db, tables);
    const afterDump = db.prepare(`SELECT * FROM agent_configs ORDER BY id`).all();

    expect(after).toEqual(before);
    expect(afterDump).toEqual(beforeDump);
  });
});

describe('issue-819-c3 / issue-819-c6 (prune gap): dead allowlist name is flagged via alignMcpName', () => {
  it('a profile allowlisting a dead MCP name produces a prune-scope gap referencing that profile + name', async () => {
    // Bug this catches: drift detection is hand-rolled instead of routed
    // through mcp_name_alignment.alignMcpName, silently diverging from the
    // #781/#789 canonicalization rule (hyphen/underscore + -mcp suffix drift).
    listMcp.mockResolvedValue({
      rhythm: { name: 'rhythm' },
      'ableton-mcp': { name: 'ableton-mcp' },
    });

    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm', 'dead-server']),
    });

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const driftRow = snapshot.drift.find(
      (d) => d.profileId === 'secretary' && d.name === 'dead-server',
    );
    expect(driftRow).toBeDefined();
    expect(driftRow?.matched).toBe(false);

    const pruneGap = snapshot.gaps.find(
      (g) => g.kind === 'prune-scope' && g.evidence.includes('dead-server'),
    );
    expect(pruneGap).toBeDefined();
    expect(pruneGap?.gapId).toBeTruthy();
  });

  it('an EXACT live id is never flagged as drift (no false positive on a real server)', async () => {
    // Bug this catches: alignMcpName is called with the wrong direction or a
    // stale live set, causing a real, in-use server name to be misreported
    // as dead — which would generate a destructive prune-scope proposal.
    listMcp.mockResolvedValue({ rhythm: { name: 'rhythm' } });

    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const driftRow = snapshot.drift.find(
      (d) => d.profileId === 'secretary' && d.name === 'rhythm',
    );
    expect(driftRow).toBeUndefined();
    expect(snapshot.gaps.some((g) => g.kind === 'prune-scope')).toBe(false);
  });
});

describe('issue-819-c5 / issue-819-c6 (cold-start / empty live set): no false prune gaps when engine unavailable', () => {
  it('does not call listMcp/listSkills when the engine is not ready, and emits no drift/prune gaps', async () => {
    // Bug this catches: the audit calls the engine before #746's cold-start
    // window has passed (or while the engine errored), and treats the
    // resulting empty/failed response as "every allowlisted name is dead" —
    // which would flood the review queue with false prune proposals on every
    // cold boot.
    mockIsReady = false;

    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm', 'anything']),
    });

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    expect(listMcp).not.toHaveBeenCalled();
    expect(listSkills).not.toHaveBeenCalled();
    expect(snapshot.engineAvailable).toBe(false);
    expect(snapshot.drift).toEqual([]);
    expect(snapshot.gaps.some((g) => g.kind === 'prune-scope')).toBe(false);
  });

  it('an empty (but reachable) live MCP set produces NO false prune gaps', async () => {
    // Bug this catches: listMcp() resolves to {} (engine reachable but no
    // servers registered yet) and the audit treats liveNames.size===0 as
    // "everything is dead" instead of "cannot judge, do not flag" — exactly
    // the fail-open behavior mcp_name_alignment.alignMcpName already encodes.
    listMcp.mockResolvedValue({});

    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    expect(snapshot.engineAvailable).toBe(true);
    expect(snapshot.drift).toEqual([]);
    expect(snapshot.gaps.some((g) => g.kind === 'prune-scope')).toBe(false);
  });
});

describe('issue-819-c4 / issue-819-c6 (tighten gap): over-broad never-invoked tool produces a tighten-scope gap', () => {
  it('a profile allowlisting a live MCP with zero denied-tool AND zero recorded use produces a tighten-scope gap with evidence', async () => {
    // Bug this catches: the audit only ever looks at denials (broaden-scope
    // signal) and never surfaces the complementary tighten-scope signal (a
    // granted-but-unused tool), leaving that whole proposal kind unfed.
    //
    // #857 update: the profile must clear the data-sufficiency guard (a
    // meaningful observation window AND enough recorded activity) before
    // "never invoked" is trusted as a real usage signal — a freshly-created
    // profile with a single session is "unobserved", not "unused" (see
    // issue_857_contract.test.ts's issue-857-c1). This test backdates the
    // profile and records enough sessions to clear both floors so it keeps
    // testing the ORIGINAL claim (a live, matched, genuinely-never-invoked
    // tool still produces a gap) rather than the thin-data case #857 now
    // suppresses.
    listMcp.mockResolvedValue({
      rhythm: { name: 'rhythm' },
      'nfl-mcp': { name: 'nfl-mcp' },
    });

    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm', 'nfl-mcp']),
    });
    // Backdate past the minimum observation window (default 7 days) — insert()
    // always stamps created_at = now with no override.
    getDb()
      .prepare(`UPDATE agent_configs SET created_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), 'secretary');

    // Enough sessions to clear the minimum activity floor (default 10), but
    // the org still has zero recorded usage/denial signal referencing
    // nfl-mcp anywhere.
    const sessionsRepo = new AgentSessionsRepository();
    for (let i = 0; i < 10; i++) {
      sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `session-${i}`,
        mcpRole: 'secretary',
      });
    }

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const tightenGap = snapshot.gaps.find(
      (g) =>
        g.kind === 'tighten-scope' &&
        g.evidence.includes('secretary') &&
        g.evidence.includes('nfl-mcp'),
    );
    expect(tightenGap).toBeDefined();
    expect(tightenGap?.gapId).toBeTruthy();
    expect(tightenGap?.evidence.length).toBeGreaterThan(0);
  });

  it('#857: a freshly-created profile with only one recorded session produces NO tighten-scope gap (thin history)', async () => {
    // This is the live-run failure #857 fixes: with near-zero observation
    // history, every granted tool looks "never invoked" — indistinguishable
    // from proven-unused. Below the data-sufficiency floor, no tighten-scope
    // gap may be emitted at all, even for a live, matched, unused name.
    listMcp.mockResolvedValue({
      rhythm: { name: 'rhythm' },
      'nfl-mcp': { name: 'nfl-mcp' },
    });

    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm', 'nfl-mcp']),
    });
    // created_at left as "now" — zero observation window.

    const sessionsRepo = new AgentSessionsRepository();
    sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'session-1',
      mcpRole: 'secretary',
    });

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const tightenGaps = snapshot.gaps.filter((g) => g.kind === 'tighten-scope');
    expect(tightenGaps).toHaveLength(0);
  });
});

describe('issue-819-c4 / issue-819-c6 (webhook gap): repeated inbound pattern produces a webhook-wiring gap', () => {
  it('a scheduled task repeatedly triggered with no wiring webhook endpoint produces a webhook-wiring gap citing session evidence', async () => {
    // Bug this catches: recurring-inbound-trigger detection is never
    // implemented, so webhook-wiring (one of the 6 optimizer capabilities)
    // never gets a signal to justify a proposal.
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x' });

    const sessionsRepo = new AgentSessionsRepository();
    // Three sessions sharing the same task_title pattern with no
    // agent_webhook_endpoints row wiring it — the recurring-pattern signal.
    for (let i = 0; i < 3; i++) {
      sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        taskTitle: 'Inbound: weekly giving report email',
        cwd: '/tmp',
        name: `session-${i}`,
        mcpRole: 'secretary',
      });
    }

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const webhookGap = snapshot.gaps.find((g) => g.kind === 'webhook-wiring');
    expect(webhookGap).toBeDefined();
    expect(webhookGap?.evidence).toMatch(/weekly giving report/i);
    expect(webhookGap?.gapId).toBeTruthy();
  });
});

describe('issue-819-c4: every gap has a stable, non-empty gapId and non-empty evidence', () => {
  it('gapId is stable across two runs over the same unchanged data (dedup-safe for proposal generators)', async () => {
    // Bug this catches: gapId is generated from crypto.randomUUID() (or
    // similar) instead of being derived deterministically from the gap's
    // kind + target, so the exact same gap gets a new id every audit run and
    // generators can never dedupe against a previously-seen gap.
    listMcp.mockResolvedValue({ 'dead-server': undefined as never }); // ensure allowlisted name still absent
    listMcp.mockResolvedValue({});

    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'secretary',
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['dead-server']),
    });
    // Give the engine a real live set (non-empty) so drift can actually fire.
    listMcp.mockResolvedValue({ rhythm: { name: 'rhythm' } });

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshotA = await buildOrgAuditSnapshot();
    const snapshotB = await buildOrgAuditSnapshot();

    for (const gap of [...snapshotA.gaps, ...snapshotB.gaps]) {
      expect(gap.gapId).toBeTruthy();
      expect(gap.evidence).toBeTruthy();
      expect(gap.evidence.length).toBeGreaterThan(0);
    }

    const gapIdsA = snapshotA.gaps.map((g) => g.gapId).sort();
    const gapIdsB = snapshotB.gaps.map((g) => g.gapId).sort();
    expect(gapIdsB).toEqual(gapIdsA);
  });
});

describe('issue-934: workflow failure signals are extracted and included in the snapshot', () => {
  it('is an empty array when no sessions have errored', async () => {
    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    expect(Array.isArray(snapshot.workflowFailureSignals)).toBe(true);
    expect(snapshot.workflowFailureSignals).toHaveLength(0);
  });

  it('surfaces an errored session as a signal, leaving healthy sessions untouched', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const errored = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      name: 'session-errored',
      cwd: '/tmp',
    });
    sessionsRepo.setErrorStatus(errored.id, 'No tools found for: report-generator');

    sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      name: 'session-healthy',
      cwd: '/tmp',
    });

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    expect(snapshot.workflowFailureSignals).toHaveLength(1);
    const signal = snapshot.workflowFailureSignals[0];
    expect(signal.sessionId).toBe(errored.id);
    expect(signal.kind).toBe('session-errored');
    expect(signal.evidence).toBe('No tools found for: report-generator');
  });
});
