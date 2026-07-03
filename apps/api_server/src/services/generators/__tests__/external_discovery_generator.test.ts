/**
 * CONTRACT TEST for issue #828 (org-optimizer-12) — must fail before
 * implementation, then pass once external_discovery_generator.ts exists. See
 * docs/ai/contracts/issue-828.json for the criterion mapping.
 *
 * Covers:
 *  - issue-828-c1: a candidate with no matching audit gap is DROPPED.
 *  - issue-828-c2: a candidate missing any required provenance field is
 *    DROPPED; every emitted proposal's provenance_json passes
 *    hasSecurityNote/requiresSecurityNote gating from org_proposal_apply_service.
 *  - issue-828-c3: risk='high', external=1 on every emitted proposal.
 *  - issue-828-c4: registerExternalAdoptionApplier's applier runs the
 *    injected curated-MCP install / skill-create path (never a bespoke
 *    install) and refuses when the post-install alignment guard fails.
 *  - issue-828-c5: the generator is a plain callable function (no scheduler
 *    wiring), dedupes against the already-suggested/rejected set, and caps
 *    emitted proposals per run.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../../database/migrations';
import { setDb } from '../../../database/db';
import { AgentOrgProposalsRepository } from '../../../repositories/agent_org_proposals_repository';
import type { OrgAuditGap } from '../../org_audit_service';
import {
  requiresSecurityNote as applyServiceRequiresSecurityNote,
  hasSecurityNote,
  registerProposalApplier,
  registerProposalValidator,
  resetProposalPluginsForTests,
} from '../../org_proposal_apply_service';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
  // resetProposalPluginsForTests() clears ALL registered validators/appliers,
  // including org_proposal_apply_service.ts's own module-load-time default
  // 'external-adoption' validator (module-level side effects only run once
  // per process). Re-register an equivalent minimal validator here via the
  // public seam so applyProposal's re-validation step behaves the same as
  // it would in production for these tests, without touching that file.
  resetProposalPluginsForTests();
  registerProposalValidator('external-adoption', (proposal) => {
    if (!proposal.changeJson) {
      return { valid: false, reason: 'change_json is required' };
    }
    try {
      const change = JSON.parse(proposal.changeJson) as Record<string, unknown>;
      const name = change.serverName ?? change.skillName ?? change.packageName;
      if (typeof name !== 'string' || !name.trim()) {
        return { valid: false, reason: 'change_json must name the server/skill being adopted' };
      }
      return { valid: true };
    } catch {
      return { valid: false, reason: 'change_json is not valid JSON' };
    }
  });
});

function makeGap(overrides: Partial<OrgAuditGap> = {}): OrgAuditGap {
  return {
    gapId: 'tighten-scope:abc123',
    kind: 'tighten-scope',
    evidence: 'profile=secretary neverInvokedTool=some-tool sessionCount=4',
    ...overrides,
  };
}

const FULL_PROVENANCE = {
  source: 'npm',
  stars: 120,
  downloads: 45000,
  lastUpdated: '2026-06-01',
  maintainer: 'example-org',
  license: 'MIT',
  installCommand: 'npx -y @example/mcp-server',
};

describe('issue-828-c1: drops a candidate with no matching audit gap', () => {
  it('never creates a proposal for a candidate whose gapId is not in the audit snapshot', async () => {
    // Bug this catches: the generator emits a "trending/popular" candidate
    // that isn't tied to any real audit gap, reintroducing unmoored
    // discovery noise the acceptance criteria explicitly forbid.
    const { runExternalDiscoveryGenerator } = await import('../external_discovery_generator');

    const result = await runExternalDiscoveryGenerator({
      gaps: [makeGap({ gapId: 'tighten-scope:real-gap' })],
      discoverCandidates: async () => [
        {
          kind: 'mcp' as const,
          name: 'unmoored-server',
          gapId: 'tighten-scope:NO-SUCH-GAP',
          provenance: FULL_PROVENANCE,
        },
      ],
    });

    expect(result.emitted).toBe(0);
    expect(result.droppedNoGap).toBe(1);

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    expect(proposed.length).toBe(0);
  });

  it('emits a proposal when the candidate references a real gap, with signal_ref carrying the gapId', async () => {
    const { runExternalDiscoveryGenerator } = await import('../external_discovery_generator');
    const gap = makeGap({ gapId: 'tighten-scope:real-gap-2' });

    const result = await runExternalDiscoveryGenerator({
      gaps: [gap],
      discoverCandidates: async () => [
        {
          kind: 'mcp' as const,
          name: 'grounded-server',
          gapId: gap.gapId,
          provenance: FULL_PROVENANCE,
        },
      ],
    });

    expect(result.emitted).toBe(1);
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    expect(proposed.length).toBe(1);
    expect(proposed[0].signalRef).toContain(gap.gapId);
  });
});

describe('issue-828-c2: drops a candidate missing any required provenance field', () => {
  it('does not emit a proposal when a required provenance field (license) is missing', async () => {
    // Bug this catches: the generator emits a proposal with a partial
    // provenance note, letting an under-vetted external adoption slip into
    // the review queue looking fully vetted.
    const { runExternalDiscoveryGenerator } = await import('../external_discovery_generator');
    const gap = makeGap({ gapId: 'tighten-scope:prov-gap' });

    const { license: _omit, ...incompleteProvenance } = FULL_PROVENANCE;

    const result = await runExternalDiscoveryGenerator({
      gaps: [gap],
      discoverCandidates: async () => [
        {
          kind: 'mcp' as const,
          name: 'partial-provenance-server',
          gapId: gap.gapId,
          provenance: incompleteProvenance as unknown as typeof FULL_PROVENANCE,
        },
      ],
    });

    expect(result.emitted).toBe(0);
    expect(result.droppedMissingProvenance).toBe(1);
  });

  it('emitted proposals carry a provenance_json that satisfies the review-queue security-note gate', async () => {
    const { runExternalDiscoveryGenerator } = await import('../external_discovery_generator');
    const gap = makeGap({ gapId: 'tighten-scope:prov-gap-2' });

    await runExternalDiscoveryGenerator({
      gaps: [gap],
      discoverCandidates: async () => [
        {
          kind: 'skill' as const,
          name: 'grounded-skill',
          gapId: gap.gapId,
          provenance: FULL_PROVENANCE,
        },
      ],
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const [proposal] = await proposalsRepo.listByStatusAsync('proposed');
    expect(proposal).toBeTruthy();
    expect(applyServiceRequiresSecurityNote(proposal)).toBe(true);
    expect(hasSecurityNote(proposal)).toBe(true);

    const provenance = JSON.parse(proposal.provenanceJson!);
    expect(provenance.source).toBeTruthy();
    expect(provenance.maintainer).toBeTruthy();
    expect(provenance.license).toBeTruthy();
    expect(provenance.installCommand).toBeTruthy();
  });
});

describe('issue-828-c3: every emitted proposal is risk=high, external=1', () => {
  it('sets risk=high and external=1 regardless of candidate kind (mcp or skill)', async () => {
    // Bug this catches: a generator that forgets to mark external=1 would let
    // classifyProposalRisk's kind-based path (or a future kind mislabeling)
    // slip an external-adoption proposal into the low-risk auto-apply lane.
    const { runExternalDiscoveryGenerator } = await import('../external_discovery_generator');
    const gap = makeGap({ gapId: 'tighten-scope:risk-gap' });

    await runExternalDiscoveryGenerator({
      gaps: [gap],
      discoverCandidates: async () => [
        { kind: 'mcp' as const, name: 'srv-a', gapId: gap.gapId, provenance: FULL_PROVENANCE },
      ],
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const [proposal] = await proposalsRepo.listByStatusAsync('proposed');
    expect(proposal.kind).toBe('external-adoption');
    expect(proposal.risk).toBe('high');
    expect(proposal.external).toBe(1);

    const { classifyProposalRisk } = await import('../../org_risk_classifier');
    expect(
      classifyProposalRisk({
        kind: proposal.kind,
        changeJson: proposal.changeJson,
        external: proposal.external,
      }),
    ).toBe('high');
  });
});

describe('issue-828-c4: approval runs the curated-install/skill-create path, never a bespoke install', () => {
  it('registers an applier that calls the injected curated-MCP installer and re-runs the alignment guard', async () => {
    // Bug this catches: a generator that performs its own bespoke
    // installation (writing files/config directly) instead of routing
    // through ensureCuratedMcps + the alignment guard, bypassing the exact
    // safety mechanism the acceptance criteria mandate.
    const { registerExternalAdoptionApplier } = await import('../external_discovery_generator');

    let installCalled: unknown = null;
    let alignmentCheckCalled = false;

    registerExternalAdoptionApplier(registerProposalApplier, {
      installCuratedMcp: async (input) => {
        installCalled = input;
        return { changed: true, registered: true };
      },
      installSkill: async () => {
        throw new Error('should not be called for an mcp candidate');
      },
      checkAlignment: async () => {
        alignmentCheckCalled = true;
        return { aligned: true };
      },
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const gap = makeGap({ gapId: 'tighten-scope:apply-gap' });
    const proposal = await proposalsRepo.createAsync({
      kind: 'external-adoption',
      risk: 'high',
      external: 1,
      title: 'Adopt srv-a MCP server',
      signalRef: `gapId:${gap.gapId}`,
      targetRef: 'mcp:srv-a',
      changeJson: JSON.stringify({ candidateKind: 'mcp', serverName: 'srv-a', installCommand: 'npx -y srv-a' }),
      provenanceJson: JSON.stringify(FULL_PROVENANCE),
      dedupKey: 'external-adoption:mcp:srv-a',
    });

    const { applyProposal } = await import('../../org_proposal_apply_service');
    const result = await applyProposal(proposal);

    expect(installCalled).toBeTruthy();
    expect(alignmentCheckCalled).toBe(true);
    expect(result.measurable).toBe(false);
  });

  it('refuses (throws inside applyProposal is not expected — applier must report failure) when the post-install alignment guard fails', async () => {
    const { registerExternalAdoptionApplier } = await import('../external_discovery_generator');

    registerExternalAdoptionApplier(registerProposalApplier, {
      installCuratedMcp: async () => ({ changed: true, registered: true }),
      installSkill: async () => ({ created: true }),
      checkAlignment: async () => ({ aligned: false, reason: 'server id not found in live engine list' }),
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const gap = makeGap({ gapId: 'tighten-scope:apply-gap-2' });
    const proposal = await proposalsRepo.createAsync({
      kind: 'external-adoption',
      risk: 'high',
      external: 1,
      title: 'Adopt srv-b MCP server',
      signalRef: `gapId:${gap.gapId}`,
      targetRef: 'mcp:srv-b',
      changeJson: JSON.stringify({ candidateKind: 'mcp', serverName: 'srv-b', installCommand: 'npx -y srv-b' }),
      provenanceJson: JSON.stringify(FULL_PROVENANCE),
      dedupKey: 'external-adoption:mcp:srv-b',
    });

    const { applyProposal } = await import('../../org_proposal_apply_service');
    await expect(applyProposal(proposal)).rejects.toThrow();
  });
});

describe('issue-828-c5: callable without a scheduler, dedup-aware, result-capped', () => {
  it('is a plain async function requiring no scheduler/cron wiring', async () => {
    const mod = await import('../external_discovery_generator');
    expect(typeof mod.runExternalDiscoveryGenerator).toBe('function');
  });

  it('skips a candidate whose dedup key already exists (already-suggested/rejected set)', async () => {
    // Bug this catches: the generator re-proposes the same external adoption
    // every run because it does not check existsByDedupKeyAsync first,
    // spamming the review queue with duplicates of an already-decided item.
    const proposalsRepo = new AgentOrgProposalsRepository();
    const gap = makeGap({ gapId: 'tighten-scope:dedup-gap' });
    await proposalsRepo.createAsync({
      kind: 'external-adoption',
      risk: 'high',
      external: 1,
      title: 'Adopt dup-server MCP server',
      signalRef: `gapId:${gap.gapId}`,
      changeJson: JSON.stringify({ candidateKind: 'mcp', serverName: 'dup-server' }),
      provenanceJson: JSON.stringify(FULL_PROVENANCE),
      dedupKey: 'external-adoption:mcp:dup-server',
      status: 'rejected',
    });

    const { runExternalDiscoveryGenerator } = await import('../external_discovery_generator');
    const result = await runExternalDiscoveryGenerator({
      gaps: [gap],
      discoverCandidates: async () => [
        { kind: 'mcp' as const, name: 'dup-server', gapId: gap.gapId, provenance: FULL_PROVENANCE },
      ],
    });

    expect(result.emitted).toBe(0);
    expect(result.droppedDuplicate).toBe(1);
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    expect(proposed.length).toBe(0);
  });

  it('caps the number of emitted proposals per run at the configured limit', async () => {
    const { runExternalDiscoveryGenerator } = await import('../external_discovery_generator');
    const gaps = [
      makeGap({ gapId: 'tighten-scope:cap-1' }),
      makeGap({ gapId: 'tighten-scope:cap-2' }),
      makeGap({ gapId: 'tighten-scope:cap-3' }),
    ];

    const result = await runExternalDiscoveryGenerator({
      gaps,
      maxResults: 2,
      discoverCandidates: async () =>
        gaps.map((g, i) => ({
          kind: 'mcp' as const,
          name: `cap-server-${i}`,
          gapId: g.gapId,
          provenance: FULL_PROVENANCE,
        })),
    });

    expect(result.emitted).toBe(2);
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposed = await proposalsRepo.listByStatusAsync('proposed');
    expect(proposed.length).toBe(2);
  });

  it('never throws when discoverCandidates itself throws (fire-and-forget discipline)', async () => {
    const { runExternalDiscoveryGenerator } = await import('../external_discovery_generator');
    await expect(
      runExternalDiscoveryGenerator({
        gaps: [makeGap()],
        discoverCandidates: async () => {
          throw new Error('scoped agent unavailable');
        },
      }),
    ).resolves.not.toThrow();
  });
});
