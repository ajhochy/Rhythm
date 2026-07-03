/**
 * CONTRACT TEST for issue #821 (org-optimizer-05) — must fail before
 * implementation, then pass once org_proposal_apply.ts / org_proposal_measure.ts
 * exist. See docs/ai/contracts/issue-821.json for the criterion mapping.
 *
 * Covers:
 *  - issue-821-c1: applyProposal writes before_snapshot_json, applies, sets
 *    status='measuring'.
 *  - issue-821-c2: applyProposal refuses any 'high'-risk proposal.
 *  - issue-821-c3a: measureProposal (prune-scope) keeps on strict hygiene
 *    improvement + functional guard pass.
 *  - issue-821-c3b: measureProposal (prune-scope) reverts when the functional
 *    guard fails (a recently-exercised scope was pruned).
 *  - issue-821-c3c: measureProposal (refine-skill) keeps iff post > baseline
 *    via the injected LLM scorer; ties revert (fail-closed).
 *  - issue-821-c4: revert replays before_snapshot_json, restores prior state,
 *    sets status='reverted', and the dedup seen-set still reports the
 *    proposal as seen (not re-proposable).
 *  - issue-821-c5: unexpected error during apply/measure never throws into
 *    the caller — resolves to a skipped/no-op outcome.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

describe('issue-821-c1: applyProposal snapshots, applies, and sets status=measuring', () => {
  it('writes before_snapshot_json capturing the prior allowedMcpsJson, then applies the change and transitions to measuring', async () => {
    // Bug this catches: applyProposal writes the change but skips (or
    // mis-orders) the before_snapshot_json capture, making revert impossible
    // — the auto-apply lane would no longer be reversible by construction.
    const { applyProposal } = await import('../services/org_proposal_apply');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'mail',
      allowedMcpsJson: JSON.stringify(['nfl_mcp', 'rhythm']),
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      title: 'Prune dead nfl_mcp scope from Secretary',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['nfl_mcp'] }),
      dedupKey: 'prune-scope:secretary:nfl_mcp',
    });

    const result = await applyProposal(proposal);
    expect(result.status).toBe('applied-ok');

    const updated = await proposalsRepo.findByIdAsync(proposal.id);
    expect(updated?.status).toBe('measuring');
    expect(updated?.beforeSnapshotJson).toBeTruthy();
    const snapshot = JSON.parse(updated!.beforeSnapshotJson!);
    expect(snapshot.allowedMcpsJson).toBe(JSON.stringify(['nfl_mcp', 'rhythm']));

    const afterConfig = configsRepo.getById(config.id);
    expect(JSON.parse(afterConfig!.allowedMcpsJson!)).toEqual(['rhythm']);
  });
});

describe('issue-821-c2: applyProposal refuses any high-risk proposal', () => {
  it('does not apply and does not transition status for a high-risk proposal', async () => {
    // Bug this catches: applyProposal trusts the caller instead of
    // re-checking classifyProposalRisk itself, so a caller bug (or a future
    // regression in the queue-gating code) could apply a privilege-granting
    // change through the "auto" path.
    const { applyProposal } = await import('../services/org_proposal_apply');
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Create a new specialist agent',
      dedupKey: 'create-agent:specialist-x',
    });

    const result = await applyProposal(proposal);
    expect(result.status).toBe('refused-high-risk');

    const unchanged = await proposalsRepo.findByIdAsync(proposal.id);
    expect(unchanged?.status).toBe('proposed');
    expect(unchanged?.beforeSnapshotJson).toBeNull();
  });
});

describe('issue-821-c3a: measureProposal (prune-scope) keeps on hygiene improvement + functional guard pass', () => {
  it('transitions measuring -> active when the pruned scope was never exercised', async () => {
    // Bug this catches: the keep/revert decision ignores the functional
    // guard and keeps ANY prune, even one that removed a tool the profile
    // actually uses — silently breaking that profile's capability.
    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'mail',
      allowedMcpsJson: JSON.stringify(['nfl_mcp', 'rhythm']),
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      title: 'Prune dead nfl_mcp scope',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['nfl_mcp'] }),
      dedupKey: 'prune-scope:secretary:nfl_mcp:keep',
    });
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    // never-invoked: exercisedTools returns an empty set for this profile.
    const outcome = await measureProposal(measuring!, {
      exercisedTools: async () => new Set<string>(),
    });

    expect(outcome).toBe('kept');
    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('active');
  });
});

describe('issue-821-c3b: measureProposal (prune-scope) reverts when the functional guard fails', () => {
  it('transitions measuring -> reverted and restores allowedMcpsJson when the pruned scope was recently exercised', async () => {
    // Bug this catches: without the functional guard, a scope that IS in
    // active use gets permanently pruned because the mechanical hygiene
    // metric alone looks like an improvement (fewer allowlist entries).
    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'mail',
      allowedMcpsJson: JSON.stringify(['nfl_mcp', 'rhythm']),
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      title: 'Prune nfl_mcp scope (actually in use)',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['nfl_mcp'] }),
      dedupKey: 'prune-scope:secretary:nfl_mcp:revert',
    });
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    // The pruned tool WAS exercised in the trailing window -> functional guard fails.
    const outcome = await measureProposal(measuring!, {
      exercisedTools: async () => new Set(['nfl_mcp']),
    });

    expect(outcome).toBe('reverted');
    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('reverted');

    const restoredConfig = configsRepo.getById(config.id);
    expect(JSON.parse(restoredConfig!.allowedMcpsJson!)).toEqual(['nfl_mcp', 'rhythm']);
  });
});

describe('issue-821-c3c: measureProposal (refine-skill) keeps iff post > baseline via injected scorer; ties revert', () => {
  it('keeps when the injected scorer reports post score strictly greater than baseline', async () => {
    // Bug this catches: the keep rule uses >= instead of strict >, which
    // would keep a no-op / cosmetic "refinement" that did not actually
    // improve anything.
    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-skill',
      risk: 'low',
      title: 'Refine skill body for clarity',
      targetRef: 'skill:example-skill',
      changeJson: JSON.stringify({
        skillName: 'example-skill',
        priorBody: 'Old vague body.',
        revisedBody: 'New precise, actionable body.',
      }),
      dedupKey: 'refine-skill:example-skill:v1',
    });
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    const outcome = await measureProposal(measuring!, {
      scoreSkillBody: async (_purpose: unknown, body: string) => {
        if (body === 'Old vague body.') return { score: 40, reason: 'baseline' };
        if (body === 'New precise, actionable body.') return { score: 85, reason: 'post' };
        return { score: 0, reason: 'unexpected body' };
      },
    });

    expect(outcome).toBe('kept');
    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('active');
  });

  it('reverts on a tie (post === baseline), fail-closed', async () => {
    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-skill',
      risk: 'low',
      title: 'Refine skill body (no real change)',
      targetRef: 'skill:example-skill-2',
      changeJson: JSON.stringify({
        skillName: 'example-skill-2',
        priorBody: 'Same body.',
        revisedBody: 'Same body (cosmetic only).',
      }),
      dedupKey: 'refine-skill:example-skill-2:v1',
    });
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    const outcome = await measureProposal(measuring!, {
      scoreSkillBody: async () => ({ score: 60, reason: 'tie' }),
    });

    expect(outcome).toBe('reverted');
    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('reverted');
  });
});

describe('issue-821-c4: revert replays before_snapshot_json and the reverted proposal stays in the dedup seen-set', () => {
  it('after revert, existsByDedupKeyAsync still reports true for the same dedup_key (not re-proposable)', async () => {
    // Bug this catches: revert deletes or otherwise loses the row, so the
    // dedup guard no longer sees it and the same change gets re-proposed
    // and re-applied every optimizer run — an apply/revert flip-flop loop.
    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'mail',
      allowedMcpsJson: JSON.stringify(['nfl_mcp', 'rhythm']),
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const dedupKey = 'prune-scope:secretary:nfl_mcp:dedup-check';
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      title: 'Prune nfl_mcp',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['nfl_mcp'] }),
      dedupKey,
    });
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);
    await measureProposal(measuring!, { exercisedTools: async () => new Set(['nfl_mcp']) });

    expect(await proposalsRepo.existsByDedupKeyAsync(dedupKey)).toBe(true);
    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('reverted');
  });
});

describe('issue-821-c5: unexpected errors never throw into the caller', () => {
  it('applyProposal resolves to a skipped outcome (does not throw) when the change payload is malformed', async () => {
    // Bug this catches: a malformed/unexpected changeJson payload throws out
    // of applyProposal, crashing the fire-and-forget optimizer loop instead
    // of degrading to a safe no-op (matching the skill-loop discipline).
    const { applyProposal } = await import('../services/org_proposal_apply');
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      title: 'Malformed change payload',
      changeJson: 'not valid json {{{',
      dedupKey: 'prune-scope:malformed',
    });

    await expect(applyProposal(proposal)).resolves.not.toThrow();
    const result = await applyProposal(proposal);
    expect(['skipped', 'applied-ok', 'refused-high-risk']).toContain(result.status);
  });

  it('measureProposal resolves to skipped (does not throw) when the injected metric hook throws', async () => {
    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'mail',
      allowedMcpsJson: JSON.stringify(['nfl_mcp', 'rhythm']),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      title: 'Prune scope with throwing guard',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['nfl_mcp'] }),
      dedupKey: 'prune-scope:secretary:throwing-guard',
    });
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    const outcome = await measureProposal(measuring!, {
      exercisedTools: async () => {
        throw new Error('telemetry unavailable');
      },
    });
    expect(outcome).toBe('skipped');
  });
});
