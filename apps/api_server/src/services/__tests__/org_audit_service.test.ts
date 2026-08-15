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
import { AgentSessionMessagesRepository } from '../../repositories/agent_session_messages_repository';
import { AgentScheduledTasksRepository } from '../../repositories/agent_scheduled_tasks_repository';
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
    // obsidian is included because the seeded Config Doctor profile ships with
    // ["rhythm","obsidian"] scope — both are genuine live Rhythm MCP servers,
    // so neither must produce a prune-scope gap.
    listMcp.mockResolvedValue({
      rhythm: { name: 'rhythm' },
      obsidian: { name: 'obsidian' },
    });

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
  it('does not emit a gap when canonical successful-use telemetry shows the server was exercised', async () => {
    listMcp.mockResolvedValue({ gitnexus: { name: 'gitnexus' } });
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'research',
      label: 'Research',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['gitnexus']),
    });
    getDb()
      .prepare(`UPDATE agent_configs SET created_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), 'research');

    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();
    for (let i = 0; i < 10; i++) {
      const session = sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `research-${i}`,
        mcpRole: 'research',
      });
      sessionsRepo.updateStatus(session.id, 'idle');
      if (i === 0) {
        messagesRepo.upsertStructured(
          session.id,
          'gitnexus-use',
          'output',
          JSON.stringify([
            {
              type: 'tool',
              id: 'part-gitnexus-query',
              callID: 'call-gitnexus-query',
              tool: 'gitnexus_query',
              state: {
                status: 'completed',
                input: {},
                output: 'ok',
                title: 'gitnexus_query',
                metadata: {},
                time: { start: 0, end: 1 },
              },
            },
          ]),
          null,
          null,
        );
      }
    }

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();
    expect(
      snapshot.gaps.filter(
        (gap) => gap.kind === 'tighten-scope' && gap.evidence.includes('gitnexus'),
      ),
    ).toEqual([]);
  });

  it('canonicalizes denied callable names to the same server identity', async () => {
    listMcp.mockResolvedValue({ gitnexus: { name: 'gitnexus' } });
    new AgentConfigsRepository().insert({
      id: 'denied-research',
      label: 'Denied Research',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['gitnexus']),
    });
    getDb()
      .prepare(`UPDATE agent_configs SET created_at = ? WHERE id = ?`)
      .run(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        'denied-research',
      );
    const sessionsRepo = new AgentSessionsRepository();
    for (let i = 0; i < 10; i++) {
      const session = sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `denied-research-${i}`,
        mcpRole: 'denied-research',
      });
      sessionsRepo.updateStatus(session.id, 'idle');
    }
    await new DeniedToolEventsRepository().recordAsync({
      sessionId: null,
      agentConfigId: 'denied-research',
      toolName: 'gitnexus_query',
    });

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();
    expect(
      snapshot.gaps.filter(
        (gap) => gap.kind === 'tighten-scope' && gap.evidence.includes('gitnexus'),
      ),
    ).toEqual([]);
  });

  it('suppresses tightening only for the profile with unreadable telemetry, not for an unrelated well-covered profile', async () => {
    // W2 fix: a single profile's unreadable structured telemetry must not
    // blank out successful-use evidence for the whole org. This asserts BOTH
    // halves of the contract in one snapshot: 'unreadable-profile' (whose
    // only attributed session is unreadable) gets no tighten judgement at
    // all, while 'well-observed' (old/active, fully covered, genuine
    // zero-use) still gets its tighten-scope gap for the never-invoked
    // 'gitnexus' grant.
    listMcp.mockResolvedValue({ gitnexus: { name: 'gitnexus' } });
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'well-observed',
      label: 'Well Observed',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['gitnexus']),
    });
    configsRepo.insert({
      id: 'unreadable-profile',
      label: 'Unreadable Profile',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['gitnexus']),
    });
    getDb()
      .prepare(`UPDATE agent_configs SET created_at = ? WHERE id IN (?, ?)`)
      .run(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        'well-observed',
        'unreadable-profile',
      );

    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();
    for (let i = 0; i < 10; i++) {
      const session = sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `well-observed-${i}`,
        mcpRole: 'well-observed',
      });
      sessionsRepo.updateStatus(session.id, 'idle');
      // Every attributed session contributes a readable, genuinely-empty
      // structured row — proving structured telemetry actually covered this
      // profile's traffic and recorded no tool use (the W2 fail-closed
      // available-empty distinction), so this profile is NOT unavailable.
      messagesRepo.upsertStructured(session.id, `well-observed-${i}-msg`, 'output', '[]', null, null);
    }
    // 'unreadable-profile' ALSO clears the #857 activity/observation floor
    // (10 idle sessions, backdated 30 days) so its suppression below can only
    // be explained by the new per-profile unavailable-telemetry skip, not by
    // the pre-existing thin-data guard.
    for (let i = 0; i < 9; i++) {
      const session = sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `unreadable-${i}`,
        mcpRole: 'unreadable-profile',
      });
      sessionsRepo.updateStatus(session.id, 'idle');
    }
    const unreadableSession = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'unreadable',
      mcpRole: 'unreadable-profile',
    });
    sessionsRepo.updateStatus(unreadableSession.id, 'idle');
    messagesRepo.upsertStructured(
      unreadableSession.id,
      'unreadable-message',
      'output',
      '{not-json',
      null,
      null,
    );

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    expect(
      snapshot.gaps.filter(
        (gap) => gap.kind === 'tighten-scope' && gap.evidence.includes('unreadable-profile'),
      ),
    ).toEqual([]);
    expect(
      snapshot.gaps.find(
        (gap) =>
          gap.kind === 'tighten-scope' &&
          gap.evidence.includes('well-observed') &&
          gap.evidence.includes('gitnexus'),
      ),
    ).toBeDefined();
  });

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
    // nfl-mcp anywhere. Each session seeds a readable, genuinely-instrumented
    // empty parts_json row — proving structured telemetry actually covered
    // this traffic and recorded no tool use, as opposed to telemetry never
    // having captured it at all (the W2 fail-closed distinction).
    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();
    for (let i = 0; i < 10; i++) {
      const s = sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `session-${i}`,
        mcpRole: 'secretary',
      });
      // #1004: only EXECUTED sessions count toward the tighten-scope floor;
      // insert() stamps 'starting', so mark these as a real (idle) run.
      sessionsRepo.updateStatus(s.id, 'idle');
      messagesRepo.upsertStructured(s.id, `session-${i}-msg`, 'output', '[]', null, null);
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

  it('#1004: never-executed (starting) sessions do NOT count toward the tighten floor', async () => {
    // The #1002 failure mode produced many never-executed sessions. Counting
    // them let a never-run agent look "over-scoped", so the optimizer pruned
    // live MCPs. Only sessions that actually executed may clear the floor.
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
    getDb()
      .prepare(`UPDATE agent_configs SET created_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), 'secretary');

    // 12 sessions — well over the default activity floor of 10 — that never
    // executed (insert() leaves them 'starting').
    const sessionsRepo = new AgentSessionsRepository();
    for (let i = 0; i < 12; i++) {
      sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `stuck-${i}`,
        mcpRole: 'secretary',
      });
    }

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const tightenGaps = snapshot.gaps.filter(
      (g) => g.kind === 'tighten-scope' && g.evidence.includes('secretary'),
    );
    expect(tightenGaps).toHaveLength(0);
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

describe('issue-934-c1: buildOrgAuditSnapshot includes workflowFailureSignals (#933 extractor wiring)', () => {
  it('is an empty array (not omitted, not an error) when no workflow failure evidence exists', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x' });

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    expect(Array.isArray(snapshot.workflowFailureSignals)).toBe(true);
    expect(snapshot.workflowFailureSignals).toEqual([]);
  });

  it('surfaces a real workflow failure signal (missing-scope, via denied_tool_events) in the snapshot', async () => {
    // Bug this catches: the extractor is imported but never actually called
    // (or its result is dropped), leaving workflowFailureSignals permanently
    // empty even when real evidence exists.
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x', allowedMcpsJson: JSON.stringify(['rhythm']) });

    const deniedRepo = new DeniedToolEventsRepository();
    await deniedRepo.recordAsync({ sessionId: 'sess-1', agentConfigId: 'secretary', toolName: 'nfl_mcp' });

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const signal = snapshot.workflowFailureSignals.find((s) => s.category === 'missing-scope');
    expect(signal).toBeDefined();
    expect(signal?.agentConfigId).toBe('secretary');
  });
});

describe('issue-934-c2: buildOrgAuditSnapshot stays read-only with workflow signals wired in', () => {
  it('leaves every table row count unchanged, including agent_session_messages/denied_tool_events', async () => {
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({ id: 'secretary', label: 'Secretary', icon: 'x' });

    const sessionsRepo = new AgentSessionsRepository();
    const session = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 's', mcpRole: 'secretary' });

    const { AgentSessionMessagesRepository } = await import('../../repositories/agent_session_messages_repository');
    const messagesRepo = new AgentSessionMessagesRepository();
    messagesRepo.append(session.id, 'output', 'Retrying. Retrying. Retrying. Retrying.', 'Retrying. Retrying. Retrying. Retrying.');

    const deniedRepo = new DeniedToolEventsRepository();
    await deniedRepo.recordAsync({ sessionId: null, agentConfigId: 'secretary', toolName: 'nfl_mcp' });

    const db = getDb();
    const tables = ['agent_configs', 'agent_sessions', 'agent_session_messages', 'denied_tool_events', 'agent_org_proposals'];
    const before: Record<string, number> = {};
    for (const t of tables) before[t] = (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    await buildOrgAuditSnapshot();

    const after: Record<string, number> = {};
    for (const t of tables) after[t] = (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;

    expect(after).toEqual(before);
  });
});

describe('W2 P1-2: scheduled ownership beats mcp_role for session-count/telemetry attribution', () => {
  it('ten sessions scheduled for owner-a but carrying interactive-target mcp_role contribute activity/telemetry only to owner-a', async () => {
    // Bug this catches: sessionCountByProfile counted every session under its
    // (possibly stale/conflicting) mcp_role regardless of a stronger
    // scheduled-task ownership tie, so a batch of sessions genuinely
    // scheduled for one profile could inflate a DIFFERENT profile's
    // observation floor / cross-contaminate its usage telemetry purely via a
    // mismatched mcp_role column.
    listMcp.mockResolvedValue({ gitnexus: { name: 'gitnexus' } });

    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: 'owner-a',
      label: 'Owner A',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['gitnexus']),
    });
    configsRepo.insert({
      id: 'interactive-target',
      label: 'Interactive Target',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['gitnexus']),
    });
    getDb()
      .prepare(`UPDATE agent_configs SET created_at = ? WHERE id IN (?, ?)`)
      .run(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        'owner-a',
        'interactive-target',
      );

    const schedRepo = new AgentScheduledTasksRepository();
    const task = await schedRepo.createAsync({
      name: 'Owner A Daily Run',
      scheduleType: 'daily',
      prompt: 'do owner-a things',
      agentConfigId: 'owner-a',
    });

    const sessionsRepo = new AgentSessionsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();
    for (let i = 0; i < 10; i++) {
      const session = sessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: '/tmp',
        name: `scheduled-for-a-${i}`,
        scheduledTaskId: task.id,
        // Conflicting/stale mcp_role naming the OTHER profile.
        mcpRole: 'interactive-target',
        // A legacy/inconsistent row: category says 'chat' (visible to this
        // listAll(1000, {includeArchived:true}) call, no scope override)
        // despite scheduledTaskId being set — exactly the "stale/conflicting"
        // data shape the module doc's migration note describes.
        category: 'chat',
      });
      sessionsRepo.updateStatus(session.id, 'idle');
      // A readable, genuinely-empty structured row — proves structured
      // telemetry actually covered this session's traffic (the W2 fail-closed
      // available-empty distinction), so owner-a's telemetry is 'available'.
      messagesRepo.upsertStructured(session.id, `scheduled-for-a-${i}-msg`, 'output', '[]', null, null);
    }

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    // owner-a cleared the activity/observation floor via the scheduled
    // sessions it actually owns, and never used gitnexus -> tighten-scope gap.
    const ownerAGap = snapshot.gaps.find(
      (g) => g.kind === 'tighten-scope' && g.evidence.includes('owner-a') && g.evidence.includes('gitnexus'),
    );
    expect(ownerAGap).toBeDefined();
    expect(ownerAGap?.evidence).toMatch(/sessionCount=10/);

    // interactive-target got NONE of that activity (no gap at all — it
    // never clears the floor, and it must not look like a judged
    // "available-empty" profile either).
    expect(
      snapshot.gaps.filter((g) => g.kind === 'tighten-scope' && g.evidence.includes('interactive-target')),
    ).toEqual([]);
  });
});

describe('issue-934-c3: delegate-result outcome distinction survives the snapshot wiring', () => {
  it('a delegated child session in error status surfaces as delegateOutcome=failed in the snapshot', async () => {
    const sessionsRepo = new AgentSessionsRepository();
    const parent = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'parent' });
    const child = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'child', mcpRole: 'research' });
    getDb().prepare(`UPDATE agent_sessions SET parent_session_id = ? WHERE id = ?`).run(parent.id, child.id);
    sessionsRepo.setErrorStatus(child.id, 'boom');

    const { buildOrgAuditSnapshot } = await import('../org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const signal = snapshot.workflowFailureSignals.find(
      (s) => s.category === 'delegate-result' && s.sessionIds.includes(child.id),
    );
    expect(signal).toBeDefined();
    expect(signal?.delegateOutcome).toBe('failed');
  });
});
