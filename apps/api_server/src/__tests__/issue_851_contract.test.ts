/**
 * CONTRACT TEST for issue #851 (org-optimizer-17) — must fail before
 * implementation, then pass once the create-recipe apply step exists (a
 * `register*Applier` exported from recipe_generator.ts or a small companion
 * file, wired into org_proposal_appliers_wiring.registerAllProposalAppliers).
 * See docs/ai/contracts/issue-851.json for the criterion mapping.
 *
 * Covers:
 *  - issue-851-c1: on approval of a create-recipe proposal, an
 *    agent_cookbook row is created from change_json (title/description/
 *    steps_json; boundConfigId if provided).
 *  - issue-851-c2: registered as a GATED applier — never reachable from the
 *    auto (low-risk) path.
 *  - issue-851-c3: idempotent — approving twice does not duplicate the
 *    recipe.
 *  - issue-851-c4: before_snapshot_json supports revert (removing the
 *    created recipe).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import type { AgentOrgProposal } from '../models/agent_org_proposal';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

function makeCreateRecipeProposal(overrides: Partial<AgentOrgProposal> = {}): AgentOrgProposal {
  const changeJson =
    overrides.changeJson ??
    JSON.stringify({
      title: 'Process weekly giving report',
      description: 'Repeated prompt pattern observed 5 times across sessions with no matching recipe.',
      steps_json: JSON.stringify([{ action: 'prompt', text: 'Process weekly giving report' }]),
    });
  return {
    id: overrides.id ?? 'p-create-recipe-1',
    auditRunId: null,
    kind: 'create-recipe',
    risk: 'high',
    external: 0,
    status: 'approved',
    title: 'Create recipe: Process weekly giving report',
    rationale: 'Repeated prompt pattern observed 5 times across sessions with no matching recipe.',
    signalRef: 'gap:webhook-wiring:abc123',
    targetRef: null,
    changeJson,
    beforeSnapshotJson: null,
    provenanceJson: null,
    dedupKey: 'create-recipe:abc123',
    baselineScore: null,
    postScore: null,
    measureReason: null,
    decidedByUserId: null,
    ownerUserId: null,
    diagnosisConfidence: null,
    diagnosisConfidenceVersion: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('issue-851-c1: approval creates an agent_cookbook row from change_json', () => {
  it('creates a cookbook row with title/description/stepsJson (and boundConfigId when provided)', async () => {
    // Bug this catches: approving a create-recipe proposal is a no-op (the
    // default applier in org_proposal_apply_service.ts), so the proposed
    // recipe never actually materializes as something the org can run.
    const applyService = await import('../services/org_proposal_apply_service');
    const { AgentCookbookRepository } = await import('../repositories/agent_cookbook_repository');

    const wiring = await import('../services/org_proposal_appliers_wiring');
    wiring.registerAllProposalAppliers({
      registerProposalApplier: applyService.registerProposalApplier,
      registerProposalValidator: applyService.registerProposalValidator,
    });

    const changeJson = JSON.stringify({
      title: 'Process weekly giving report',
      description: 'Repeated prompt pattern.',
      steps_json: JSON.stringify([{ action: 'prompt', text: 'Process weekly giving report' }]),
      boundConfigId: 'agent-config-1',
    });
    const proposal = makeCreateRecipeProposal({ id: 'p-c1', dedupKey: 'create-recipe:c1', changeJson });

    await applyService.applyProposal(proposal);

    const cookbookRepo = new AgentCookbookRepository();
    const all = await cookbookRepo.listAllAsync();
    const created = all.find((r) => r.title === 'Process weekly giving report');

    expect(created).toBeDefined();
    expect(created!.description).toBe('Repeated prompt pattern.');
    expect(JSON.parse(created!.stepsJson)).toEqual([{ action: 'prompt', text: 'Process weekly giving report' }]);
    expect(created!.boundConfigId).toBe('agent-config-1');
  });

  it('creates a cookbook row with a null boundConfigId when not provided', async () => {
    const applyService = await import('../services/org_proposal_apply_service');
    const { AgentCookbookRepository } = await import('../repositories/agent_cookbook_repository');

    const wiring = await import('../services/org_proposal_appliers_wiring');
    wiring.registerAllProposalAppliers({
      registerProposalApplier: applyService.registerProposalApplier,
      registerProposalValidator: applyService.registerProposalValidator,
    });

    const proposal = makeCreateRecipeProposal({ id: 'p-c1b', dedupKey: 'create-recipe:c1b' });
    await applyService.applyProposal(proposal);

    const cookbookRepo = new AgentCookbookRepository();
    const all = await cookbookRepo.listAllAsync();
    const created = all.find((r) => r.title === 'Process weekly giving report');

    expect(created).toBeDefined();
    expect(created!.boundConfigId).toBeNull();
  });
});

describe('issue-851-c2: registered as a GATED applier — never reachable from the auto path', () => {
  it('classifyProposalRisk always returns high for create-recipe', async () => {
    // Bug this catches: create-recipe is reclassified/misclassified as low
    // risk, making it eligible for the fire-and-forget auto-apply lane
    // instead of stopping in the human review queue.
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(
      classifyProposalRisk({
        kind: 'create-recipe',
        changeJson: JSON.stringify({ title: 'x', description: 'y', steps_json: '[]' }),
      }),
    ).toBe('high');
  });

  it('org_proposal_apply.ts (the low-risk auto-apply module) refuses to apply a create-recipe proposal', async () => {
    // Bug this catches: the create-recipe applier is wired into (or otherwise
    // reachable from) the auto-apply path in org_proposal_apply.ts, bypassing
    // the human gate entirely. That module re-derives risk via
    // classifyProposalRisk and must refuse anything not 'low' BEFORE ever
    // consulting the org_proposal_apply_service.ts registered-applier map —
    // so even though this is the SAME `create-recipe` kind our applier
    // registers into the gated service, the auto-apply module's independent
    // risk re-check must still refuse it.
    const autoApplyModule = await import('../services/org_proposal_apply');
    const { AgentCookbookRepository } = await import('../repositories/agent_cookbook_repository');

    const proposal = makeCreateRecipeProposal({
      id: 'p-c2',
      status: 'proposed',
      dedupKey: 'create-recipe:c2',
    });

    const result = await autoApplyModule.applyProposal(proposal);
    expect(result.status).toBe('refused-high-risk');

    const cookbookRepo = new AgentCookbookRepository();
    const all = await cookbookRepo.listAllAsync();
    expect(all.find((r) => r.title === 'Process weekly giving report')).toBeUndefined();
  });
});

describe('issue-851-c3: idempotent — approving twice does not duplicate the recipe', () => {
  it('applying the same create-recipe proposal twice creates exactly one agent_cookbook row', async () => {
    // Bug this catches: the applier has no dedup/idempotency guard (by title
    // or an applied-marker), so re-running approval (e.g. a retried request,
    // or a duplicate approval click) inserts a second identical recipe.
    const applyService = await import('../services/org_proposal_apply_service');
    const { AgentCookbookRepository } = await import('../repositories/agent_cookbook_repository');

    const wiring = await import('../services/org_proposal_appliers_wiring');
    wiring.registerAllProposalAppliers({
      registerProposalApplier: applyService.registerProposalApplier,
      registerProposalValidator: applyService.registerProposalValidator,
    });

    const proposal = makeCreateRecipeProposal({ id: 'p-c3', dedupKey: 'create-recipe:c3' });

    await applyService.applyProposal(proposal);
    await applyService.applyProposal(proposal);

    const cookbookRepo = new AgentCookbookRepository();
    const all = await cookbookRepo.listAllAsync();
    const matches = all.filter((r) => r.title === 'Process weekly giving report');

    expect(matches).toHaveLength(1);
  });
});

describe('issue-851-c4: before_snapshot_json supports revert (removing the created recipe)', () => {
  it('apply returns a beforeSnapshotJson naming the created cookbook row', async () => {
    // Bug this catches: the applier does not return beforeSnapshotJson (or
    // returns an empty/unusable one), so there is no way to know which
    // agent_cookbook row to remove on revert.
    const applyService = await import('../services/org_proposal_apply_service');

    const wiring = await import('../services/org_proposal_appliers_wiring');
    wiring.registerAllProposalAppliers({
      registerProposalApplier: applyService.registerProposalApplier,
      registerProposalValidator: applyService.registerProposalValidator,
    });

    const proposal = makeCreateRecipeProposal({ id: 'p-c4', dedupKey: 'create-recipe:c4' });
    const result = await applyService.applyProposal(proposal);

    expect(result.beforeSnapshotJson).toBeTruthy();
    const snapshot = JSON.parse(result.beforeSnapshotJson!);
    expect(typeof snapshot.createdCookbookId).toBe('string');
    expect(snapshot.createdCookbookId.length).toBeGreaterThan(0);
  });

  it('the created cookbook row can be removed using the id captured in before_snapshot_json', async () => {
    const applyService = await import('../services/org_proposal_apply_service');
    const { AgentCookbookRepository } = await import('../repositories/agent_cookbook_repository');

    const wiring = await import('../services/org_proposal_appliers_wiring');
    wiring.registerAllProposalAppliers({
      registerProposalApplier: applyService.registerProposalApplier,
      registerProposalValidator: applyService.registerProposalValidator,
    });

    const proposal = makeCreateRecipeProposal({ id: 'p-c4b', dedupKey: 'create-recipe:c4b' });
    const result = await applyService.applyProposal(proposal);
    const snapshot = JSON.parse(result.beforeSnapshotJson!) as { createdCookbookId: string };

    const cookbookRepo = new AgentCookbookRepository();
    const beforeRevert = await cookbookRepo.findByIdAsync(snapshot.createdCookbookId);
    expect(beforeRevert).not.toBeNull();

    const deleted = await cookbookRepo.deleteAsync(snapshot.createdCookbookId);
    expect(deleted).toBe(true);

    const afterRevert = await cookbookRepo.findByIdAsync(snapshot.createdCookbookId);
    expect(afterRevert).toBeNull();
  });
});
