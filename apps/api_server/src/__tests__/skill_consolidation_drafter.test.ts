/**
 * CONTRACT TEST for issue #852 (org-optimizer-18) — must fail before
 * implementation, then pass once
 * apps/api_server/src/services/skill_consolidation_drafter.ts exists and
 * org_proposal_measure.ts / org_proposal_apply.ts consume it for
 * consolidate-skill. See docs/ai/contracts/issue-852.json for the criterion
 * mapping.
 *
 * Covers:
 *  - issue-852-c1: a consolidate-skill proposal gains a drafted merged body
 *    and becomes measurable (no longer parks in 'measuring').
 *  - issue-852-c2: the merged body is a mechanical (concat + dedup section)
 *    merge of the two source skills' bodies, and change_json is reshaped
 *    into the BodyRefinementChange shape ({skillName, priorBody, revisedBody,
 *    description}).
 *  - issue-852-c3: measured via skill_refiner.scoreSkillBody; kept ONLY if
 *    the merged body scores STRICTLY higher than baseline, else reverted.
 *  - issue-852-c4: applying a consolidate-skill proposal writes the merged
 *    skill and retires/marks the redundant one; before_snapshot_json
 *    supports a full revert of both skills to their pre-merge state.
 *  - issue-852-c5: a consolidate-skill proposal drafted by this module still
 *    classifies 'low' via the real classifyProposalRisk (no top-level `add`
 *    key introduced by the drafted change_json).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { classifyProposalRisk } from '../services/org_risk_classifier';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

/** Build the raw scope_hygiene_generator consolidate-skill pairing payload (no body). */
function pairingChangeJson(skillIdA: string, skillIdB: string, titleA: string, titleB: string) {
  return JSON.stringify({ skillIdA, skillIdB, titleA, titleB, similarity: 0.8 });
}

describe('issue-852-c1: a consolidate-skill proposal gains a drafted merged body and becomes measurable', () => {
  it('drafts a merged body onto the proposal changeJson so measureProposal no longer skips it', async () => {
    // Bug this catches: consolidate-skill proposals carry only the
    // {skillIdA, skillIdB, titleA, titleB, similarity} pairing shape forever,
    // so org_proposal_measure.measureBodyRefinement's isBodyRefinementChange()
    // check fails and the proposal parks in 'measuring' indefinitely instead
    // of ever reaching 'active' or 'reverted'.
    const skillsRepo = new AgentSkillsRepository();
    const skillA = skillsRepo.create({
      title: 'Send weekly digest',
      body: '# Send weekly digest\n\n## Steps\n\n1. Gather updates\n2. Send email',
      confidence: 0.7,
      status: 'published',
    });
    const skillB = skillsRepo.create({
      title: 'Send weekly summary',
      body: '# Send weekly summary\n\n## Steps\n\n1. Compile summary\n2. Send email',
      confidence: 0.7,
      status: 'published',
    });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'consolidate-skill',
      risk: 'low',
      title: `Consolidate overlapping skills '${skillA.title}' and '${skillB.title}'`,
      targetRef: `skill:${skillA.id}:skill:${skillB.id}`,
      changeJson: pairingChangeJson(skillA.id, skillB.id, skillA.title, skillB.title),
      dedupKey: `consolidate-skill:${skillA.id}:${skillB.id}`,
    });

    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');

    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);
    expect(measuring?.status).toBe('measuring');

    const outcome = await measureProposal(measuring!, {
      scoreSkillBody: async (_purpose, body) => ({ score: body.length, reason: 'length-scored' }),
    });

    // The drafted merged body is longer than either source body alone, so
    // the injected length-scorer must report an improvement -> kept. The
    // key regression this guards is 'skipped' (parked forever), not the
    // keep/revert direction itself (covered by c3).
    expect(outcome).not.toBe('skipped');
    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(['active', 'reverted']).toContain(finalRow?.status);
  });
});

describe('issue-852-c2: merged body mechanically combines both source bodies and change_json is reshaped to BodyRefinementChange', () => {
  it('draftConsolidatedSkillBody concatenates + dedupes shared section headers from both bodies', async () => {
    // Bug this catches: the drafter drops one skill's content entirely (a
    // lossy "pick one" merge) instead of mechanically combining both, or
    // fails to dedup an identically-named section, doubling boilerplate like
    // a repeated "## Steps" heading.
    const { draftConsolidatedSkillBody } = await import('../services/skill_consolidation_drafter');

    const bodyA = '# Skill A\n\n## When to use\n\nUse for digests.\n\n## Steps\n\n1. Gather\n2. Send';
    const bodyB = '# Skill B\n\n## When to use\n\nUse for summaries.\n\n## Steps\n\n1. Compile\n2. Send';

    const merged = draftConsolidatedSkillBody(
      { title: 'Skill A', body: bodyA },
      { title: 'Skill B', body: bodyB },
    );

    expect(merged).toContain('Gather');
    expect(merged).toContain('Compile');
    // Exactly one '## When to use' heading and one '## Steps' heading — not
    // duplicated once per source skill.
    expect((merged.match(/## When to use/g) ?? []).length).toBe(1);
    expect((merged.match(/## Steps/g) ?? []).length).toBe(1);
  });

  it('draftConsolidationChangeJson reshapes the pairing payload into the BodyRefinementChange shape', async () => {
    // Bug this catches: the drafted change_json keeps the old
    // {skillIdA, skillIdB, ...} shape (or a mismatched key name), so
    // isBodyRefinementChange() in org_proposal_measure.ts still returns false
    // even after "drafting" — the whole point of #852 is to produce a
    // shape measureBodyRefinement actually recognizes.
    const skillsRepo = new AgentSkillsRepository();
    const skillA = skillsRepo.create({ title: 'Skill A', body: '# Skill A\nbody a', confidence: 0.7 });
    const skillB = skillsRepo.create({ title: 'Skill B', body: '# Skill B\nbody b', confidence: 0.7 });

    const { draftConsolidationChangeJson } = await import('../services/skill_consolidation_drafter');
    const changeJson = draftConsolidationChangeJson(skillA, skillB);
    const parsed = JSON.parse(changeJson);

    expect(typeof parsed.priorBody).toBe('string');
    expect(typeof parsed.revisedBody).toBe('string');
    expect(parsed.priorBody.length).toBeGreaterThan(0);
    // priorBody is the baseline to beat — must be one of the two ORIGINAL
    // bodies (or a deterministic combination), never the merged body itself.
    expect(parsed.revisedBody).not.toBe(parsed.priorBody);
    expect(parsed.skillName ?? parsed.recipeName).toBeTruthy();
  });
});

describe('issue-852-c3: measured via scoreSkillBody; kept only on a strictly higher score, else reverted', () => {
  it('keeps the consolidate-skill proposal when the merged body scores strictly higher than baseline', async () => {
    const skillsRepo = new AgentSkillsRepository();
    const skillA = skillsRepo.create({ title: 'Digest A', body: 'short body', confidence: 0.7, status: 'published' });
    const skillB = skillsRepo.create({ title: 'Digest B', body: 'short body 2', confidence: 0.7, status: 'published' });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'consolidate-skill',
      risk: 'low',
      title: 'Consolidate overlapping skills',
      targetRef: `skill:${skillA.id}:skill:${skillB.id}`,
      changeJson: pairingChangeJson(skillA.id, skillB.id, skillA.title, skillB.title),
      dedupKey: `consolidate-skill:${skillA.id}:${skillB.id}:keep`,
    });

    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    const outcome = await measureProposal(measuring!, {
      scoreSkillBody: async (_purpose, body) =>
        body.includes('short body') && body.includes('short body 2')
          ? { score: 90, reason: 'merged is better' }
          : { score: 40, reason: 'baseline' },
    });

    expect(outcome).toBe('kept');
    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('active');
  });

  it('reverts the consolidate-skill proposal on a tie or lower merged score (fail-closed)', async () => {
    // Bug this catches: a lower-scoring (or merely equal) merge is kept
    // anyway — e.g. the measure step uses >= instead of strict > for
    // consolidate-skill specifically, unlike every other body-refinement kind.
    const skillsRepo = new AgentSkillsRepository();
    const skillA = skillsRepo.create({ title: 'Digest C', body: 'good body', confidence: 0.7, status: 'published' });
    const skillB = skillsRepo.create({ title: 'Digest D', body: 'good body 2', confidence: 0.7, status: 'published' });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'consolidate-skill',
      risk: 'low',
      title: 'Consolidate overlapping skills (worse merge)',
      targetRef: `skill:${skillA.id}:skill:${skillB.id}`,
      changeJson: pairingChangeJson(skillA.id, skillB.id, skillA.title, skillB.title),
      dedupKey: `consolidate-skill:${skillA.id}:${skillB.id}:revert`,
    });

    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    // Merged (revised) body scores the SAME as baseline -> no improvement.
    const outcome = await measureProposal(measuring!, {
      scoreSkillBody: async () => ({ score: 50, reason: 'no improvement' }),
    });

    expect(outcome).toBe('reverted');
    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('reverted');
  });
});

describe('issue-852-c4: applying a consolidate-skill proposal writes the merged skill, retires the redundant one, and fully reverts', () => {
  it('kept: the surviving skill body reflects the merge and the redundant skill is retired', async () => {
    // Bug this catches: the apply step only advances the PROPOSAL's status
    // (the generic body-kind branch in org_proposal_apply.ts) without ever
    // touching agent_skills — so "consolidation" never actually happens in
    // the live skill store even when the proposal is measured 'active'.
    const skillsRepo = new AgentSkillsRepository();
    const skillA = skillsRepo.create({ title: 'Keep Me', body: 'keep-me body', confidence: 0.7, status: 'published' });
    const skillB = skillsRepo.create({ title: 'Retire Me', body: 'retire-me body', confidence: 0.7, status: 'published' });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'consolidate-skill',
      risk: 'low',
      title: 'Consolidate Keep Me and Retire Me',
      targetRef: `skill:${skillA.id}:skill:${skillB.id}`,
      changeJson: pairingChangeJson(skillA.id, skillB.id, skillA.title, skillB.title),
      dedupKey: `consolidate-skill:${skillA.id}:${skillB.id}:apply`,
    });

    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    await measureProposal(measuring!, {
      scoreSkillBody: async (_purpose, body) =>
        body.includes('keep-me body') && body.includes('retire-me body')
          ? { score: 95, reason: 'merged wins' }
          : { score: 10, reason: 'baseline' },
    });

    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('active');

    const survivor = skillsRepo.getById(skillA.id);
    const retired = skillsRepo.getById(skillB.id);
    expect(survivor?.body ?? '').toContain('keep-me body');
    expect(survivor?.body ?? '').toContain('retire-me body');
    // The redundant skill must no longer be a live, independently-surfaced
    // skill after consolidation (retired via status, not necessarily row
    // deletion, so history/rollback is preserved).
    expect(retired?.status).not.toBe('published');
  });

  it('reverted: before_snapshot_json restores BOTH skills to their pre-merge state', async () => {
    // Bug this catches: revert only restores the proposal's own status (the
    // documented behavior of the generic body-kind revert path today,
    // "no live-system side effect to undo here"), permanently losing the
    // retired skill or leaving the survivor's body mutated even though the
    // merge was rejected by measurement.
    const skillsRepo = new AgentSkillsRepository();
    const skillA = skillsRepo.create({ title: 'Stay A', body: 'original A body', confidence: 0.7, status: 'published' });
    const skillB = skillsRepo.create({ title: 'Stay B', body: 'original B body', confidence: 0.7, status: 'published' });

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'consolidate-skill',
      risk: 'low',
      title: 'Consolidate Stay A and Stay B',
      targetRef: `skill:${skillA.id}:skill:${skillB.id}`,
      changeJson: pairingChangeJson(skillA.id, skillB.id, skillA.title, skillB.title),
      dedupKey: `consolidate-skill:${skillA.id}:${skillB.id}:revert-apply`,
    });

    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    await measureProposal(measuring!, {
      scoreSkillBody: async () => ({ score: 1, reason: 'always worse' }),
    });

    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('reverted');

    const restoredA = skillsRepo.getById(skillA.id);
    const restoredB = skillsRepo.getById(skillB.id);
    expect(restoredA?.body).toBe('original A body');
    expect(restoredA?.status).toBe('published');
    expect(restoredB?.body).toBe('original B body');
    expect(restoredB?.status).toBe('published');
  });
});

describe('issue-852-c5: a drafted consolidate-skill proposal still classifies low via the real classifyProposalRisk', () => {
  it('the drafted BodyRefinementChange payload never introduces a top-level `add` key (hard-rule high escalation)', async () => {
    // Bug this catches: draftConsolidationChangeJson (or the apply step)
    // accidentally nests an `add` key (e.g. inside a naive shallow merge of
    // the pairing payload and the drafted body fields) into change_json,
    // which org_risk_classifier's changeShapeIsHardRuledHigh() hard-escalates
    // to 'high' regardless of the 'consolidate-skill' kind label — silently
    // knocking the proposal out of the auto-apply lane.
    const skillsRepo = new AgentSkillsRepository();
    const skillA = skillsRepo.create({ title: 'Risk A', body: 'body a', confidence: 0.7 });
    const skillB = skillsRepo.create({ title: 'Risk B', body: 'body b', confidence: 0.7 });

    const { draftConsolidationChangeJson } = await import('../services/skill_consolidation_drafter');
    const changeJson = draftConsolidationChangeJson(skillA, skillB);

    const risk = classifyProposalRisk({ kind: 'consolidate-skill', changeJson });
    expect(risk).toBe('low');
  });
});
