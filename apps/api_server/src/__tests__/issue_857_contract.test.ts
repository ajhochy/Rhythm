/**
 * CONTRACT TEST for issue #857 — org-optimizer over-prunes on thin data.
 *
 * First live run auto-applied 16 tighten/prune proposals that stripped tools
 * agents actively use, because there was almost no usage history (only 3
 * denied_tool_events, ~1h uptime). The "never invoked" signal cannot
 * distinguish "proven unused over a meaningful window" from "no usage data
 * recorded yet" — with near-empty history every tool looks unused, so the
 * generator prunes everything.
 *
 * Covers:
 *  - issue-857-c1: a profile observed for LESS than the minimum window/
 *    activity threshold produces ZERO tighten-scope gaps, even when a live,
 *    matched MCP name has never been invoked.
 *  - issue-857-c2: a profile observed for AT LEAST the minimum window with
 *    sufficient activity, where a tool is genuinely never invoked, still
 *    produces a tighten-scope gap (the guard must not become a blanket
 *    suppression).
 *  - issue-857-c3: prune-scope (dead/drifted allowlist name) is emitted
 *    regardless of the observation window — it is a correctness prune, not a
 *    usage-based prune, so the new guard must never gate it.
 *  - issue-857-c4: the observation window + activity count are surfaced in
 *    the gap evidence (and thus the proposal rationale) so a reviewer can see
 *    the basis for a tighten-scope proposal.
 *  - issue-857-c5: revertProposal on an `active` proposal now succeeds,
 *    restores before_snapshot_json's live state, and sets status='reverted'
 *    (previously threw "Illegal status transition 'active' -> 'reverted'").
 *  - issue-857-c6: the repository state machine itself allows active ->
 *    reverted while every other previously-illegal transition stays illegal.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { createScopeDeltaV2Snapshot } from '../services/org_proposal_apply';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ── opencode_engine mock — controls isReady / listMcp per test ─────────────
import { vi } from 'vitest';
import { forceAppliedScopeFixture } from './helpers/force_applied_scope_fixture';

const mockListMcp = vi.fn();
let mockIsReady = true;

vi.mock('../services/opencode_engine', () => ({
  get opencodeClient() {
    return {
      get isReady() {
        return mockIsReady;
      },
      listMcp: (...a: unknown[]) => mockListMcp(...a),
      listSkills: async () => [],
    };
  },
  opencodeSessionMap: new Map(),
}));

beforeEach(() => {
  setDb(makeDb());
  mockIsReady = true;
  mockListMcp.mockReset();
  mockListMcp.mockResolvedValue({});
});

/** Insert an agent_configs row with a specific created_at timestamp (backdated in days). */
function insertProfileWithAge(
  configsRepo: AgentConfigsRepository,
  id: string,
  allowedMcpsJson: string,
  ageDays: number,
): void {
  configsRepo.insert({ id, label: id, icon: 'x', allowedMcpsJson });
  if (ageDays > 0) {
    const backdated = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
    setDbRawUpdate('agent_configs', id, backdated);
  }
}

function setDbRawUpdate(table: string, id: string, createdAt: string): void {
  // Direct write to back-date created_at — insert() always stamps "now" and
  // has no override, so tests that need an aged profile must reach past it.
  getDb().prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).run(createdAt, id);
}

describe('issue-857-c1: thin observation window/activity suppresses tighten-scope gaps entirely', () => {
  it('a freshly-created profile with minimal session activity produces NO tighten-scope gap even for a never-invoked live MCP', async () => {
    // Bug this catches: detectTightenGaps only required sessionCount > 0 with
    // no window/activity floor, so a profile observed for minutes with a
    // single session looked identical to one proven unused over weeks —
    // exactly the #857 live-run failure (16 proposals off ~1h uptime / 3
    // denied events).
    mockListMcp.mockResolvedValue({ rhythm: { name: 'rhythm' }, 'nfl-mcp': { name: 'nfl-mcp' } });

    const configsRepo = new AgentConfigsRepository();
    // Freshly created (age 0 days) — thin/no observation window.
    insertProfileWithAge(configsRepo, 'secretary', JSON.stringify(['rhythm', 'nfl-mcp']), 0);

    const sessionsRepo = new AgentSessionsRepository();
    sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'session-1',
      mcpRole: 'secretary',
    });

    const { buildOrgAuditSnapshot } = await import('../services/org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const tightenGaps = snapshot.gaps.filter((g) => g.kind === 'tighten-scope');
    expect(tightenGaps).toHaveLength(0);
  });
});

describe('issue-857-c2: sufficient observation window + activity still yields a tighten-scope gap for a genuinely unused tool', () => {
  it('a profile observed well past the minimum window with several sessions and zero use of a live MCP produces a tighten-scope gap', async () => {
    // Bug this catches: an overly-blunt guard (e.g. "never emit tighten-scope
    // at all") would silently disable the entire feature instead of gating
    // only the thin-data case.
    mockListMcp.mockResolvedValue({ rhythm: { name: 'rhythm' }, 'nfl-mcp': { name: 'nfl-mcp' } });

    const configsRepo = new AgentConfigsRepository();
    // Well past the minimum observation window (30 days old).
    insertProfileWithAge(configsRepo, 'secretary', JSON.stringify(['rhythm', 'nfl-mcp']), 30);

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
      // Genuinely instrumented zero-use coverage: a readable empty
      // parts_json row proves structured telemetry actually captured this
      // session's traffic and recorded no tool use (W2 fail-closed
      // distinction — a session with zero readable rows is missing capture,
      // not proof of zero use).
      messagesRepo.upsertStructured(s.id, `session-${i}-msg`, 'output', '[]', null, null);
    }

    const { buildOrgAuditSnapshot } = await import('../services/org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const tightenGap = snapshot.gaps.find(
      (g) => g.kind === 'tighten-scope' && g.evidence.includes('secretary') && g.evidence.includes('nfl-mcp'),
    );
    expect(tightenGap).toBeDefined();
  });
});

describe('issue-857-c3: prune-scope (dead/drifted name) fires regardless of observation window', () => {
  it('a brand-new profile with a dead/unresolved allowlist name still produces a prune-scope gap', async () => {
    // Bug this catches: the new data-sufficiency guard is applied blanket
    // across both gap kinds instead of being scoped ONLY to the usage-based
    // tighten-scope signal — prune-scope is a correctness fix (the name does
    // not resolve to any live engine id), not a usage judgement, and must
    // never be held back by a thin-history window.
    mockListMcp.mockResolvedValue({ rhythm: { name: 'rhythm' } });

    const configsRepo = new AgentConfigsRepository();
    // Freshly created — zero observation window.
    insertProfileWithAge(configsRepo, 'worship-planning', JSON.stringify(['rhythm', 'context7']), 0);

    const { buildOrgAuditSnapshot } = await import('../services/org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const pruneGap = snapshot.gaps.find(
      (g) => g.kind === 'prune-scope' && g.evidence.includes('worship-planning') && g.evidence.includes('context7'),
    );
    expect(pruneGap).toBeDefined();
  });
});

describe('issue-857-c4: tighten-scope gap evidence surfaces the observation basis for a reviewer', () => {
  it('evidence includes the observation window (days) alongside the session/activity count', async () => {
    // Bug this catches: the guard exists but its basis is invisible to a
    // human reviewing the resulting proposal's rationale — the issue
    // explicitly requires "Log the observation window + counts into the
    // proposal rationale so a reviewer sees the basis."
    mockListMcp.mockResolvedValue({ rhythm: { name: 'rhythm' }, 'nfl-mcp': { name: 'nfl-mcp' } });

    const configsRepo = new AgentConfigsRepository();
    insertProfileWithAge(configsRepo, 'secretary', JSON.stringify(['rhythm', 'nfl-mcp']), 30);

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
      // Genuinely instrumented zero-use coverage: a readable empty
      // parts_json row proves structured telemetry actually captured this
      // session's traffic and recorded no tool use (W2 fail-closed
      // distinction — a session with zero readable rows is missing capture,
      // not proof of zero use).
      messagesRepo.upsertStructured(s.id, `session-${i}-msg`, 'output', '[]', null, null);
    }

    const { buildOrgAuditSnapshot } = await import('../services/org_audit_service');
    const snapshot = await buildOrgAuditSnapshot();

    const tightenGap = snapshot.gaps.find((g) => g.kind === 'tighten-scope' && g.evidence.includes('nfl-mcp'));
    expect(tightenGap).toBeDefined();
    expect(tightenGap?.evidence).toMatch(/observationDays=\d+/);
    expect(tightenGap?.evidence).toMatch(/sessionCount=\d+/);
  });
});

describe('issue-857-c5: revertProposal succeeds on an active proposal', () => {
  it('restores before_snapshot_json to the live agent_configs value and sets status=reverted', async () => {
    // Bug this catches: revertProposal calls updateStatusAsync(id, 'reverted')
    // unconditionally, but the repository state machine only permitted
    // measuring -> reverted, so calling revert on an already-active proposal
    // threw "Illegal status transition 'active' -> 'reverted'" — the exact
    // failure the maintainer hit hand-reverting the 16 live proposals.
    //
    // W1 (self-improvement-engine-foundation review) replaced the legacy
    // whole-field snapshot ({allowedMcpsJson: prior}) with a versioned,
    // entry-level scope-delta-v2 snapshot — replaying the OLD legacy shape is
    // now refused (unsafe-legacy-scope) because it cannot distinguish a safe
    // rollback from clobbering a later operator edit. This test now drives
    // the same active-proposal-revert scenario through the V2 snapshot the
    // real apply step actually writes.
    const { revertProposal } = await import('../services/org_proposal_apply');

    const configsRepo = new AgentConfigsRepository();
    const priorMcps = JSON.stringify(['rhythm', 'nfl-mcp']);
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'mail',
      allowedMcpsJson: priorMcps,
    });

    const exactChangeJson = JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['nfl-mcp'] });
    const snapshot = createScopeDeltaV2Snapshot(config.id, 'allowedMcpsJson', priorMcps, ['nfl-mcp'], 'tighten-scope', exactChangeJson);

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'tighten-scope',
      risk: 'high',
      title: 'Tighten unused mcp scope nfl-mcp from secretary',
      changeJson: exactChangeJson,
      beforeSnapshotJson: JSON.stringify(snapshot),
      dedupKey: 'issue-857-c5:active-revert',
    });

    // Drive the row all the way to 'active' (applied -> measuring -> active),
    // simulating a proposal that already passed measurement and was kept —
    // exactly the state the maintainer needed to revert by hand.
    forceAppliedScopeFixture(proposal.id);
    await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
    const active = await proposalsRepo.updateStatusAsync(proposal.id, 'active');
    expect(active?.status).toBe('active');

    // Mutate the live config to the exact post-apply value, as the real
    // apply step would have already done before this row reached 'active'.
    configsRepo.update(config.id, { allowedMcpsJson: snapshot.expectedAppliedValue });

    const outcome = await revertProposal(active!);
    expect(outcome).toBe('reverted');

    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('reverted');
    expect(finalRow?.beforeSnapshotJson).toBe(proposal.beforeSnapshotJson);

    const restoredConfig = configsRepo.getById(config.id);
    const restoredList = JSON.parse(restoredConfig?.allowedMcpsJson ?? '[]');
    expect(restoredList.sort()).toEqual(['nfl-mcp', 'rhythm'].sort());
  });
});

describe('issue-857-c6: repository state machine permits active -> reverted, nothing else new', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('allows active -> reverted', async () => {
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'tighten-scope',
      risk: 'low',
      title: 'A',
      dedupKey: 'issue-857-c6:active-reverted',
    });
    forceAppliedScopeFixture(p.id);
    await repo.updateStatusAsync(p.id, 'measuring');
    await repo.updateStatusAsync(p.id, 'active');
    const updated = await repo.updateStatusAsync(p.id, 'reverted');
    expect(updated?.status).toBe('reverted');
  });

  it('still rejects active -> approved (regression guard on the pre-existing #817 invariant)', async () => {
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'tighten-scope',
      risk: 'low',
      title: 'A',
      dedupKey: 'issue-857-c6:active-approved-still-illegal',
    });
    forceAppliedScopeFixture(p.id);
    await repo.updateStatusAsync(p.id, 'measuring');
    await repo.updateStatusAsync(p.id, 'active');
    await expect(repo.updateStatusAsync(p.id, 'approved')).rejects.toThrow();
  });

  it('still rejects reverted -> active (reverted stays terminal in the forward direction)', async () => {
    const repo = new AgentOrgProposalsRepository();
    const p = await repo.createAsync({
      kind: 'tighten-scope',
      risk: 'low',
      title: 'A',
      dedupKey: 'issue-857-c6:reverted-terminal',
    });
    forceAppliedScopeFixture(p.id);
    await repo.updateStatusAsync(p.id, 'measuring');
    await repo.updateStatusAsync(p.id, 'active');
    await repo.updateStatusAsync(p.id, 'reverted');
    await expect(repo.updateStatusAsync(p.id, 'active')).rejects.toThrow();
  });
});
