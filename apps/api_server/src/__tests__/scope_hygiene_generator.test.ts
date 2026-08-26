/**
 * CONTRACT TEST for issue #822 (org-optimizer-06) — must fail before
 * implementation, then pass once
 * apps/api_server/src/services/generators/scope_hygiene_generator.ts exists.
 * See docs/ai/contracts/issue-822.json for the criterion mapping.
 *
 * Covers:
 *  - issue-822-c1: a prune-scope drift gap -> one prune-scope proposal.
 *  - issue-822-c2: a tighten-scope gap -> one tighten-scope proposal.
 *  - issue-822-c3: 2+ overlapping skills -> one consolidate-skill proposal.
 *  - issue-822-c4: an exercised tool/server is never proposed for removal.
 *  - issue-822-c5: a user-authored scope entry is never silently auto-pruned.
 *  - issue-822-c6: every emitted proposal classifies 'low' via the real
 *    classifyProposalRisk.
 *  - issue-822-c7: dedup_key collisions (existsByDedupKeyAsync) are skipped.
 */

import { describe, expect, it, vi } from 'vitest';

import { classifyProposalRisk } from '../services/org_risk_classifier';
import type { OrgAuditSnapshot, OrgAuditGap, SkillOverlapCandidate } from '../services/org_audit_service';
import type { AgentOrgProposalInput } from '../models/agent_org_proposal';

function baseSnapshot(overrides: Partial<OrgAuditSnapshot> = {}): OrgAuditSnapshot {
  return {
    auditRunId: 'run-1',
    generatedAt: new Date().toISOString(),
    engineAvailable: true,
    profiles: [],
    skills: [],
    skillOverlapCandidates: [],
    recipes: [],
    delegationEdges: [],
    webhookEndpoints: [],
    deniedToolAggregates: [],
    drift: [],
    gaps: [],
    workflowFailureSignals: [],
    ...overrides,
  };
}

/** Minimal fake repo matching the two methods the generator is allowed to call. */
function makeFakeProposalsRepo(existingDedupKeys: Set<string> = new Set()) {
  const created: AgentOrgProposalInput[] = [];
  return {
    created,
    existsByDedupKeyAsync: vi.fn(async (key: string) => existingDedupKeys.has(key)),
    createAsync: vi.fn(async (input: AgentOrgProposalInput) => {
      created.push(input);
      return {
        id: `id-${created.length}`,
        auditRunId: input.auditRunId ?? null,
        kind: input.kind,
        risk: input.risk,
        external: input.external ?? 0,
        status: input.status ?? 'proposed',
        title: input.title,
        rationale: input.rationale ?? null,
        signalRef: input.signalRef ?? null,
        targetRef: input.targetRef ?? null,
        changeJson: input.changeJson ?? null,
        beforeSnapshotJson: input.beforeSnapshotJson ?? null,
        provenanceJson: input.provenanceJson ?? null,
        dedupKey: input.dedupKey ?? null,
        baselineScore: input.baselineScore ?? null,
        postScore: input.postScore ?? null,
        measureReason: input.measureReason ?? null,
        decidedByUserId: input.decidedByUserId ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }),
  };
}

describe('issue-822-c1: prune-scope gap produces exactly one prune-scope proposal with the correct target_ref/change_json/signal_ref', () => {
  it('reads the OrgAuditSnapshot prune-scope gap and writes one matching proposal', async () => {
    // Bug this catches: the generator fails to translate a drift gap's
    // evidence string into a well-formed AgentConfigScopeChange payload, so
    // the #821 auto-apply path (which expects exactly
    // {agentConfigId, field, remove}) silently no-ops on a real gap.
    const { generateScopeHygieneProposals } = await import('../services/generators/scope_hygiene_generator');

    const gap: OrgAuditGap = {
      gapId: 'prune-scope:abc123',
      kind: 'prune-scope',
      evidence: 'profile=secretary scopeKind=mcp deadName=nfl-mcp',
    };
    const snapshot = baseSnapshot({ gaps: [gap] });
    const repo = makeFakeProposalsRepo();

    await generateScopeHygieneProposals(snapshot, { proposalsRepo: repo as any });

    const pruneProposals = repo.created.filter((p) => p.kind === 'prune-scope');
    expect(pruneProposals).toHaveLength(1);

    const proposal = pruneProposals[0];
    expect(proposal.signalRef).toBe(gap.gapId);
    expect(proposal.targetRef).toContain('secretary');
    expect(proposal.targetRef).toContain('nfl-mcp');

    const change = JSON.parse(proposal.changeJson!);
    expect(change.agentConfigId).toBe('secretary');
    expect(change.field).toBe('allowedMcpsJson');
    expect(change.remove).toEqual(['nfl-mcp']);
  });
});

describe('issue-1479-c2: tool-granular prune evidence reaches scope hygiene', () => {
  it('does not silently drop an mcp-tool drift gap', async () => {
    // Regression caught: parsePruneEvidence accepted only mcp|skill, so the
    // audit's real mcp-tool evidence never reached the proposal generator.
    const { generateScopeHygieneProposals } = await import('../services/generators/scope_hygiene_generator');
    const gap: OrgAuditGap = {
      gapId: 'prune-scope:phantom-tool',
      kind: 'prune-scope',
      evidence: 'profile=theologian scopeKind=mcp-tool serverName=obsidian deadName=obsidian_get_file',
    };
    const repo = makeFakeProposalsRepo();

    await generateScopeHygieneProposals(baseSnapshot({ gaps: [gap] }), {
      proposalsRepo: repo as any,
    });

    expect(repo.created).toHaveLength(1);
    expect(repo.created[0]).toMatchObject({
      kind: 'prune-scope',
      signalRef: gap.gapId,
      targetRef: 'agent_config:theologian:mcp-tool:obsidian_get_file',
    });
    expect(JSON.parse(repo.created[0].changeJson!)).toEqual({
      agentConfigId: 'theologian',
      field: 'allowedMcpsJson',
      remove: ['obsidian_get_file'],
    });
  });
});

describe('issue-822-c2: tighten-scope gap produces exactly one tighten-scope proposal removing the never-invoked tool', () => {
  it('reads the OrgAuditSnapshot tighten-scope gap and writes one matching proposal', async () => {
    // Bug this catches: the generator conflates tighten-scope with
    // prune-scope handling (or drops the sessionCount evidence), producing
    // the wrong proposal kind or an unremovable change payload.
    const { generateScopeHygieneProposals } = await import('../services/generators/scope_hygiene_generator');

    const gap: OrgAuditGap = {
      gapId: 'tighten-scope:def456',
      kind: 'tighten-scope',
      evidence: 'profile=librarian neverInvokedTool=obsidian sessionCount=12',
    };
    const snapshot = baseSnapshot({ gaps: [gap] });
    const repo = makeFakeProposalsRepo();

    await generateScopeHygieneProposals(snapshot, { proposalsRepo: repo as any });

    const tightenProposals = repo.created.filter((p) => p.kind === 'tighten-scope');
    expect(tightenProposals).toHaveLength(1);

    const proposal = tightenProposals[0];
    expect(proposal.signalRef).toBe(gap.gapId);
    expect(proposal.targetRef).toContain('librarian');
    expect(proposal.targetRef).toContain('obsidian');

    const change = JSON.parse(proposal.changeJson!);
    expect(change.agentConfigId).toBe('librarian');
    expect(change.field).toBe('allowedMcpsJson');
    expect(change.remove).toEqual(['obsidian']);
  });
});

describe('issue-822-c3: skillOverlapCandidates above threshold produce one consolidate-skill proposal referencing both skill ids', () => {
  it('writes one consolidate-skill proposal naming both overlapping skill ids', async () => {
    // Bug this catches: the generator ignores skillOverlapCandidates
    // entirely, or emits a proposal that only references one of the two
    // skill ids, making the consolidation ambiguous for a human/LLM reviewer.
    const { generateScopeHygieneProposals } = await import('../services/generators/scope_hygiene_generator');

    const overlap: SkillOverlapCandidate = {
      skillIdA: 'skill-a',
      skillIdB: 'skill-b',
      titleA: 'Send weekly digest',
      titleB: 'Send weekly summary',
      similarity: 0.75,
    };
    const snapshot = baseSnapshot({ skillOverlapCandidates: [overlap] });
    const repo = makeFakeProposalsRepo();

    await generateScopeHygieneProposals(snapshot, { proposalsRepo: repo as any });

    const consolidateProposals = repo.created.filter((p) => p.kind === 'consolidate-skill');
    expect(consolidateProposals).toHaveLength(1);

    const proposal = consolidateProposals[0];
    const combined = `${proposal.targetRef ?? ''} ${proposal.changeJson ?? ''}`;
    expect(combined).toContain('skill-a');
    expect(combined).toContain('skill-b');
  });
});

describe('issue-822-c4: a live, matched, exercised MCP name (no tighten-scope gap for it) is never proposed for removal', () => {
  it('does not invent a tighten-scope/prune-scope proposal for a name that has no corresponding gap in the snapshot', async () => {
    // Bug this catches: the generator re-derives its own "unused" candidates
    // from profiles[].allowedMcps instead of strictly consuming
    // snapshot.gaps, so a tool the profile actually uses (no gap emitted by
    // org_audit_service for it) gets proposed for removal anyway.
    const { generateScopeHygieneProposals } = await import('../services/generators/scope_hygiene_generator');

    const snapshot = baseSnapshot({
      profiles: [
        {
          id: 'secretary',
          label: 'Secretary',
          isManager: false,
          enabled: true,
          allowedMcps: ['gmail-work', 'rhythm'],
          mcpScopeShape: 'servers',
          allowedMcpTools: { 'gmail-work': [], rhythm: [] },
          allowedSkills: [],
          allowedDelegates: [],
        },
      ],
      // No gaps at all -> gmail-work and rhythm are both presumed exercised /
      // live-matched; the generator must not propose removing either.
      gaps: [],
    });
    const repo = makeFakeProposalsRepo();

    await generateScopeHygieneProposals(snapshot, { proposalsRepo: repo as any });

    const scopeProposals = repo.created.filter(
      (p) => p.kind === 'tighten-scope' || p.kind === 'prune-scope',
    );
    expect(scopeProposals).toHaveLength(0);
  });
});

describe('issue-822-c5: a prune-scope gap flagged user-authored via deps is never emitted as an auto-apply low-risk prune', () => {
  it('skips generating an auto-apply prune-scope proposal for a name the caller marks user-authored', async () => {
    // Bug this catches: the generator blindly turns every prune-scope gap
    // into a low-risk auto-apply proposal, silently deleting a scope entry
    // the human explicitly configured (#785 overlay preservation) instead of
    // routing it to the human-gate queue or skipping it outright.
    const { generateScopeHygieneProposals } = await import('../services/generators/scope_hygiene_generator');

    const gap: OrgAuditGap = {
      gapId: 'prune-scope:userowned',
      kind: 'prune-scope',
      evidence: 'profile=worship-planning scopeKind=mcp deadName=propresenter',
    };
    const snapshot = baseSnapshot({ gaps: [gap] });
    const repo = makeFakeProposalsRepo();

    await generateScopeHygieneProposals(snapshot, {
      proposalsRepo: repo as any,
      isUserAuthoredScopeEntry: (profileId: string, _scopeKind: string, name: string) =>
        profileId === 'worship-planning' && name === 'propresenter',
    });

    // Either no proposal at all, or a proposal that is NOT low-risk
    // auto-apply for this specific target — the invariant is "never silently
    // pruned via the low-risk auto lane".
    const matching = repo.created.filter(
      (p) => p.kind === 'prune-scope' && (p.targetRef ?? '').includes('propresenter'),
    );
    for (const p of matching) {
      expect(p.risk).not.toBe('low');
    }
  });
});

describe('issue-822-c6: every emitted proposal risk matches the real classifyProposalRisk (never hardcoded)', () => {
  it('the generator never stamps a risk the actual predicate disagrees with', async () => {
    // Bug this catches: the generator hardcodes risk: 'low' on the row
    // without the payload actually satisfying classifyProposalRisk (e.g. it
    // accidentally includes an `add` key, or the predicate's classification
    // for this kind changes), producing a proposal whose stored `risk`
    // column disagrees with what org_proposal_apply's own re-check would
    // decide — the row would then CLAIM one risk level while the load-bearing
    // guard enforces another. As of the W1 self-improvement-engine-foundation
    // review, tighten-scope/prune-scope classify 'high' (scope removal is
    // human-gated); consolidate-skill still classifies 'low'.
    const { generateScopeHygieneProposals } = await import('../services/generators/scope_hygiene_generator');

    const pruneGap: OrgAuditGap = {
      gapId: 'prune-scope:g1',
      kind: 'prune-scope',
      evidence: 'profile=secretary scopeKind=mcp deadName=nfl-mcp',
    };
    const tightenGap: OrgAuditGap = {
      gapId: 'tighten-scope:g2',
      kind: 'tighten-scope',
      evidence: 'profile=librarian neverInvokedTool=obsidian sessionCount=5',
    };
    const overlap: SkillOverlapCandidate = {
      skillIdA: 'skill-a',
      skillIdB: 'skill-b',
      titleA: 'Send weekly digest',
      titleB: 'Send weekly summary',
      similarity: 0.9,
    };
    const snapshot = baseSnapshot({ gaps: [pruneGap, tightenGap], skillOverlapCandidates: [overlap] });
    const repo = makeFakeProposalsRepo();

    await generateScopeHygieneProposals(snapshot, { proposalsRepo: repo as any });

    expect(repo.created.length).toBeGreaterThan(0);
    for (const proposal of repo.created) {
      const risk = classifyProposalRisk({
        kind: proposal.kind,
        changeJson: proposal.changeJson,
        external: proposal.external,
      });
      expect(proposal.risk).toBe(risk);
    }
    const pruneProposal = repo.created.find((p) => p.kind === 'prune-scope');
    const tightenProposal = repo.created.find((p) => p.kind === 'tighten-scope');
    const consolidateProposal = repo.created.find((p) => p.kind === 'consolidate-skill');
    expect(pruneProposal?.risk).toBe('high');
    expect(tightenProposal?.risk).toBe('high');
    expect(consolidateProposal?.risk).toBe('low');
  });
});

describe('issue-822-c7: a dedup_key that already exists via existsByDedupKeyAsync is skipped, not re-created', () => {
  it('does not call createAsync for a gap whose computed dedup_key already exists', async () => {
    // Bug this catches: the generator does not check existsByDedupKeyAsync
    // before writing, so the same gap re-proposes an identical row on every
    // optimizer run instead of relying on the repository's documented
    // idempotency contract.
    const { generateScopeHygieneProposals } = await import('../services/generators/scope_hygiene_generator');

    const gap: OrgAuditGap = {
      gapId: 'prune-scope:dupe',
      kind: 'prune-scope',
      evidence: 'profile=secretary scopeKind=mcp deadName=nfl-mcp',
    };
    const snapshot = baseSnapshot({ gaps: [gap] });

    // First run: discover the dedup key it would use.
    const firstRepo = makeFakeProposalsRepo();
    await generateScopeHygieneProposals(snapshot, { proposalsRepo: firstRepo as any });
    expect(firstRepo.created).toHaveLength(1);
    const dedupKey = firstRepo.created[0].dedupKey;
    expect(dedupKey).toBeTruthy();

    // Second run: same gap, but the repo now reports that dedup_key as
    // already existing -> generator must skip creating a duplicate.
    const secondRepo = makeFakeProposalsRepo(new Set([dedupKey!]));
    await generateScopeHygieneProposals(snapshot, { proposalsRepo: secondRepo as any });

    expect(secondRepo.createAsync).not.toHaveBeenCalled();
    expect(secondRepo.created).toHaveLength(0);
  });
});
