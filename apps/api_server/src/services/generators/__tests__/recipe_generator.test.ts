/**
 * CONTRACT TEST for issue #823 (org-optimizer-07) — must fail before
 * implementation, then pass once generators/recipe_generator.ts exists. See
 * docs/ai/contracts/issue-823.json for the criterion mapping.
 *
 * Covers:
 *  - issue-823-c1: repeated pattern w/o a matching recipe -> one create-recipe
 *    proposal (HIGH); change_json carries title/description/steps_json.
 *  - issue-823-c2: an improvable existing recipe -> one refine-recipe proposal
 *    (LOW); change_json is consumable by org_proposal_measure's
 *    measureBodyRefinement (priorBody/revisedBody/recipeName shape).
 *  - issue-823-c3: emitted risk == classifyProposalRisk(kind).
 *  - issue-823-c4: an adequate existing recipe yields no refine proposal, a
 *    matched-by-name pattern yields no create proposal, and dedup_key blocks
 *    a second identical run.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../../database/migrations';
import { setDb } from '../../../database/db';
import { AgentOrgProposalsRepository } from '../../../repositories/agent_org_proposals_repository';
import { AgentCookbookRepository } from '../../../repositories/agent_cookbook_repository';
import { classifyProposalRisk } from '../../org_risk_classifier';
import type { OrgAuditSnapshot } from '../../org_audit_service';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

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
    ...overrides,
  };
}

beforeEach(() => {
  setDb(makeDb());
});

describe('issue-823-c1: repeated pattern with no matching recipe emits one create-recipe proposal', () => {
  it('is high-risk and carries title/description/steps_json in change_json', async () => {
    // Bug this catches: the generator fails to surface a create-recipe
    // proposal at all, or emits it without the fields the review queue (#826)
    // needs to actually materialize the recipe (title/description/steps_json).
    const { generateRecipeProposals } = await import('../recipe_generator');

    const snapshot = baseSnapshot({
      gaps: [
        {
          gapId: 'webhook-wiring:abc123',
          kind: 'webhook-wiring',
          evidence: 'pattern="Weekly Volunteer Digest" count=4 sessionIds=s1,s2,s3,s4',
        },
      ],
      recipes: [],
    });

    const result = await generateRecipeProposals(snapshot);

    const createProposals = result.created.filter((p) => p.kind === 'create-recipe');
    expect(createProposals.length).toBe(1);

    const proposal = createProposals[0];
    expect(proposal.risk).toBe('high');
    expect(proposal.status).toBe('proposed');
    expect(proposal.dedupKey).toBeTruthy();

    const change = JSON.parse(proposal.changeJson!);
    expect(change.title).toBe('Weekly Volunteer Digest');
    expect(typeof change.description).toBe('string');
    expect(typeof change.steps_json).toBe('string');
    // steps_json must itself be valid JSON (an array) — not an opaque string.
    expect(Array.isArray(JSON.parse(change.steps_json))).toBe(true);

    // Never auto-applied: status stays 'proposed', not 'applied'/'measuring'.
    expect(proposal.status).not.toBe('applied');
    expect(proposal.status).not.toBe('measuring');
  });
});

describe('issue-823-c2: an improvable existing recipe emits one refine-recipe proposal', () => {
  it('is low-risk and change_json matches the BodyRefinementChange shape org_proposal_measure consumes', async () => {
    // Bug this catches: the generator emits a refine-recipe proposal whose
    // change_json does not match the priorBody/revisedBody shape
    // org_proposal_measure.measureBodyRefinement expects, silently breaking
    // the #821 measure/keep/revert loop for recipes.
    const { generateRecipeProposals } = await import('../recipe_generator');

    const cookbookRepo = new AgentCookbookRepository();
    const recipe = await cookbookRepo.createAsync({
      title: 'Sunday Prep',
      description: 'Prep for Sunday service',
      stepsJson: JSON.stringify(['Do the thing']),
    });

    const snapshot = baseSnapshot({ recipes: [recipe] });

    // Force the "improvable" branch via an injected low scorer.
    const result = await generateRecipeProposals(snapshot, {
      scorer: async () => ({ score: 30, reason: 'vague and incomplete' }),
    });

    const refineProposals = result.created.filter((p) => p.kind === 'refine-recipe');
    expect(refineProposals.length).toBe(1);

    const proposal = refineProposals[0];
    expect(proposal.risk).toBe('low');
    expect(proposal.dedupKey).toBeTruthy();

    const change = JSON.parse(proposal.changeJson!);
    expect(typeof change.priorBody).toBe('string');
    expect(typeof change.revisedBody).toBe('string');
    expect(change.priorBody).not.toBe(change.revisedBody);
    expect(change.recipeName).toBe('Sunday Prep');

    // Confirm org_proposal_measure's own shape guard accepts this payload.
    const isBodyRefinementChange = (v: unknown): boolean => {
      if (!v || typeof v !== 'object') return false;
      const c = v as Record<string, unknown>;
      return typeof c.priorBody === 'string' && typeof c.revisedBody === 'string';
    };
    expect(isBodyRefinementChange(change)).toBe(true);
  });
});

describe('issue-823-c3: emitted risk tiers match classifyProposalRisk', () => {
  it('create-recipe proposals carry classifyProposalRisk({kind:"create-recipe"}) and refine-recipe carry the "refine-recipe" verdict', async () => {
    // Bug this catches: the generator hardcodes 'high'/'low' independently of
    // classifyProposalRisk instead of deriving from it, so a future change to
    // the classifier's kind tables silently desyncs from what this generator
    // emits.
    const { generateRecipeProposals } = await import('../recipe_generator');

    const cookbookRepo = new AgentCookbookRepository();
    const recipe = await cookbookRepo.createAsync({
      title: 'Volunteer Follow-up',
      description: 'Follow up with volunteers',
      stepsJson: JSON.stringify(['step one']),
    });

    const snapshot = baseSnapshot({
      gaps: [
        {
          gapId: 'webhook-wiring:def456',
          kind: 'webhook-wiring',
          evidence: 'pattern="Brand New Pattern" count=5 sessionIds=s1,s2,s3,s4,s5',
        },
      ],
      recipes: [recipe],
    });

    const result = await generateRecipeProposals(snapshot, {
      scorer: async () => ({ score: 20, reason: 'weak' }),
    });

    for (const proposal of result.created) {
      const expected = classifyProposalRisk({ kind: proposal.kind, changeJson: proposal.changeJson });
      expect(proposal.risk).toBe(expected);
    }
    expect(result.created.some((p) => p.kind === 'create-recipe')).toBe(true);
    expect(result.created.some((p) => p.kind === 'refine-recipe')).toBe(true);
    expect(classifyProposalRisk({ kind: 'create-recipe' })).toBe('high');
    expect(classifyProposalRisk({ kind: 'refine-recipe' })).toBe('low');
  });
});

describe('issue-823-c4: no proposal when an adequate recipe already exists; dedup blocks re-proposal', () => {
  it('emits no create-recipe proposal when a recipe already matches the repeated pattern by title', async () => {
    // Bug this catches: the generator proposes a duplicate "create" recipe
    // even though an equivalent recipe already exists in the cookbook,
    // spamming the review queue with redundant work.
    const { generateRecipeProposals } = await import('../recipe_generator');

    const cookbookRepo = new AgentCookbookRepository();
    const recipe = await cookbookRepo.createAsync({
      title: 'Weekly Volunteer Digest',
      description: 'Digest of volunteer activity',
      stepsJson: JSON.stringify(['gather data', 'summarise', 'post']),
    });

    const snapshot = baseSnapshot({
      gaps: [
        {
          gapId: 'webhook-wiring:ghi789',
          kind: 'webhook-wiring',
          evidence: 'pattern="Weekly Volunteer Digest" count=6 sessionIds=s1,s2,s3,s4,s5,s6',
        },
      ],
      recipes: [recipe],
    });

    // High scorer -> the existing recipe is ALSO adequate, so no refine
    // proposal either. Net result: zero proposals for an adequate recipe.
    const result = await generateRecipeProposals(snapshot, {
      scorer: async () => ({ score: 90, reason: 'excellent' }),
    });

    expect(result.created.filter((p) => p.kind === 'create-recipe').length).toBe(0);
    expect(result.created.filter((p) => p.kind === 'refine-recipe').length).toBe(0);
  });

  it('does not create a duplicate proposal when the same signal is scanned twice (dedup_key)', async () => {
    // Bug this catches: re-running the generator over unchanged data
    // (e.g. the next optimizer tick) creates a second, duplicate proposal
    // instead of being a no-op — spamming the review/auto-apply pipeline.
    const { generateRecipeProposals } = await import('../recipe_generator');

    const snapshot = baseSnapshot({
      gaps: [
        {
          gapId: 'webhook-wiring:jkl012',
          kind: 'webhook-wiring',
          evidence: 'pattern="Repeated Onboarding Flow" count=3 sessionIds=s1,s2,s3',
        },
      ],
      recipes: [],
    });

    const proposalsRepo = new AgentOrgProposalsRepository();

    const first = await generateRecipeProposals(snapshot, { proposalsRepo });
    expect(first.created.filter((p) => p.kind === 'create-recipe').length).toBe(1);

    const second = await generateRecipeProposals(snapshot, { proposalsRepo });
    expect(second.created.filter((p) => p.kind === 'create-recipe').length).toBe(0);

    const all = await proposalsRepo.listByStatusAsync('proposed');
    const matching = all.filter((p) => p.title.includes('Repeated Onboarding Flow'));
    expect(matching.length).toBe(1);
  });
});
