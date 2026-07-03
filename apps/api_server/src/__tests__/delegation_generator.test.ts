/**
 * CONTRACT TEST for issue #825 (org-optimizer-09) — must fail before
 * implementation, then pass once delegation_generator.ts exists. See
 * docs/ai/contracts/issue-825.json for the criterion mapping.
 *
 * Covers:
 *  - issue-825-c1: a redo/abandon signal produces exactly one HIGH-risk
 *    grant-delegation (or expand-delegation) proposal targeting the manager
 *    config, with change_json naming the target id(s) to add.
 *  - issue-825-c2: ineligible targets (disabled, non-agent, self, or beyond
 *    the depth cap) never produce a proposal.
 *  - issue-825-c3: a non-manager signal never produces a delegation
 *    proposal, because only is_manager=1 profiles are valid target_refs.
 *  - issue-825-c4: the registered applier re-validates auth + depth at apply
 *    time (not just proposal time) and refuses a self-delegation even if it
 *    were smuggled into change_json.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { classifyProposalRisk } from '../services/org_risk_classifier';
import type { ProposalApplier } from '../services/org_proposal_apply_service';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

describe('issue-825-c1: a redo/abandon signal produces one HIGH-risk grant-delegation proposal', () => {
  it('targets the manager config and names the specialist id to add in change_json', async () => {
    // Bug this catches: the generator produces a proposal targeting the
    // SPECIALIST instead of the manager, or fails to mark the proposal HIGH
    // risk — either would let a delegation grant slip past the human gate.
    const { generateDelegationProposals } = await import(
      '../services/generators/delegation_generator'
    );
    const repo = new AgentConfigsRepository();
    const manager = repo.insert({ id: 'secretary', label: 'Secretary', icon: 'mail', isManager: true });
    const specialist = repo.insert({
      id: 'coding-agent',
      label: 'Coding Agent',
      icon: 'code',
      isManager: false,
    });

    const proposals = generateDelegationProposals(
      [
        {
          managerConfigId: manager.id,
          specialistConfigId: specialist.id,
          occurrences: 4,
          evidence: 'sessions=abc,def,ghi,jkl',
        },
      ],
      repo.list(),
    );

    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal.kind).toBe('grant-delegation');
    expect(proposal.risk).toBe('high');
    expect(proposal.targetRef).toBe(`agent_config:${manager.id}`);

    const change = JSON.parse(proposal.changeJson);
    expect(change.agentConfigId).toBe(manager.id);
    expect(change.allowed_delegates_json.add).toEqual([specialist.id]);

    // Independently confirm the risk classifier agrees this change_json
    // shape is HIGH regardless of the stated kind (defense-in-depth check).
    expect(classifyProposalRisk({ kind: proposal.kind, changeJson: proposal.changeJson })).toBe(
      'high',
    );
  });

  it('emits expand-delegation when the edge already exists in allowed_delegates_json', async () => {
    const { generateDelegationProposals } = await import(
      '../services/generators/delegation_generator'
    );
    const repo = new AgentConfigsRepository();
    const specialist = repo.insert({ id: 'coding-agent', label: 'Coding Agent', icon: 'code' });
    const manager = repo.insert({
      id: 'orchestrator',
      label: 'Orchestrator',
      icon: 'gear',
      isManager: true,
      allowedDelegatesJson: JSON.stringify([specialist.id]),
    });

    const proposals = generateDelegationProposals(
      [
        {
          managerConfigId: manager.id,
          specialistConfigId: specialist.id,
          occurrences: 5,
          evidence: 'sessions=x,y,z,w,v',
        },
      ],
      repo.list(),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0].kind).toBe('expand-delegation');
    expect(proposals[0].risk).toBe('high');
  });
});

describe('issue-825-c2: ineligible targets never produce a proposal', () => {
  it('excludes a disabled target', async () => {
    // Bug this catches: the generator proposes delegating to a disabled
    // profile, which would then be unrunnable if approved.
    const { generateDelegationProposals } = await import(
      '../services/generators/delegation_generator'
    );
    const repo = new AgentConfigsRepository();
    const manager = repo.insert({ id: 'secretary', label: 'Secretary', icon: 'mail', isManager: true });
    const disabledSpecialist = repo.insert({
      id: 'disabled-specialist',
      label: 'Disabled Specialist',
      icon: 'code',
      enabled: false,
    });

    const proposals = generateDelegationProposals(
      [
        {
          managerConfigId: manager.id,
          specialistConfigId: disabledSpecialist.id,
          occurrences: 4,
          evidence: 'sessions=a,b,c,d',
        },
      ],
      repo.list(),
    );

    expect(proposals).toHaveLength(0);
  });

  it('excludes a non-agent target', async () => {
    const { generateDelegationProposals } = await import(
      '../services/generators/delegation_generator'
    );
    const repo = new AgentConfigsRepository();
    const manager = repo.insert({ id: 'secretary', label: 'Secretary', icon: 'mail', isManager: true });
    const nonAgent = repo.insert({
      id: 'not-an-agent',
      label: 'Not An Agent',
      icon: 'code',
      isAgent: false,
    });

    const proposals = generateDelegationProposals(
      [
        {
          managerConfigId: manager.id,
          specialistConfigId: nonAgent.id,
          occurrences: 4,
          evidence: 'sessions=a,b,c,d',
        },
      ],
      repo.list(),
    );

    expect(proposals).toHaveLength(0);
  });

  it('excludes self-delegation (manager cannot be its own delegate target)', async () => {
    // Bug this catches: a signal accidentally naming the manager as its own
    // specialist would create a self-delegation edge — explicitly forbidden.
    const { generateDelegationProposals } = await import(
      '../services/generators/delegation_generator'
    );
    const repo = new AgentConfigsRepository();
    const manager = repo.insert({ id: 'secretary', label: 'Secretary', icon: 'mail', isManager: true });

    const proposals = generateDelegationProposals(
      [
        {
          managerConfigId: manager.id,
          specialistConfigId: manager.id,
          occurrences: 4,
          evidence: 'sessions=a,b,c,d',
        },
      ],
      repo.list(),
    );

    expect(proposals).toHaveLength(0);
  });

  it('excludes an edge that would exceed the delegation depth cap', async () => {
    // Bug this catches: granting a delegation edge to a manager who is
    // ALREADY a delegate at depth=2 (the cap) would create a 4-level chain,
    // which agent_delegation_service.ts's MAX_DELEGATION_DEPTH=2 forbids at
    // invocation time. The generator must not even propose such an edge.
    const { generateDelegationProposals } = await import(
      '../services/generators/delegation_generator'
    );
    const repo = new AgentConfigsRepository();
    // root -> mid -> deepManager is already a 2-hop chain (deepManager is at
    // structural depth 2, the cap) — deepManager must not be granted a
    // further delegate.
    const deepManager = repo.insert({
      id: 'deep-manager',
      label: 'Deep Manager',
      icon: 'gear',
      isManager: true,
    });
    const mid = repo.insert({
      id: 'mid-manager',
      label: 'Mid Manager',
      icon: 'gear',
      isManager: true,
      allowedDelegatesJson: JSON.stringify([deepManager.id]),
    });
    repo.insert({
      id: 'root-manager',
      label: 'Root Manager',
      icon: 'gear',
      isManager: true,
      allowedDelegatesJson: JSON.stringify([mid.id]),
    });
    const specialist = repo.insert({ id: 'leaf-specialist', label: 'Leaf', icon: 'code' });

    const proposals = generateDelegationProposals(
      [
        {
          managerConfigId: deepManager.id,
          specialistConfigId: specialist.id,
          occurrences: 4,
          evidence: 'sessions=a,b,c,d',
        },
      ],
      repo.list(),
    );

    expect(proposals).toHaveLength(0);
  });
});

describe('issue-825-c3: only managers (is_manager=1) are valid target_ref', () => {
  it('a non-manager profile never receives a delegation proposal', async () => {
    // Bug this catches: the generator ignores is_manager and proposes
    // granting delegation power to a profile that was never designed to
    // delegate — expanding the delegation surface beyond the intended
    // manager set.
    const { generateDelegationProposals } = await import(
      '../services/generators/delegation_generator'
    );
    const repo = new AgentConfigsRepository();
    const nonManager = repo.insert({
      id: 'non-manager',
      label: 'Non Manager',
      icon: 'mail',
      isManager: false,
    });
    const specialist = repo.insert({ id: 'coding-agent', label: 'Coding Agent', icon: 'code' });

    const proposals = generateDelegationProposals(
      [
        {
          managerConfigId: nonManager.id,
          specialistConfigId: specialist.id,
          occurrences: 10,
          evidence: 'sessions=a,b,c,d,e,f,g,h,i,j',
        },
      ],
      repo.list(),
    );

    expect(proposals).toHaveLength(0);
  });
});

describe('issue-825-c4: apply-time re-validation of auth + depth (not just proposal time)', () => {
  it('writes allowed_delegates_json for a still-valid manager/target pair', async () => {
    const { registerDelegationApplier } = await import(
      '../services/generators/delegation_generator'
    );
    const repo = new AgentConfigsRepository();
    const manager = repo.insert({ id: 'secretary', label: 'Secretary', icon: 'mail', isManager: true });
    const specialist = repo.insert({ id: 'coding-agent', label: 'Coding Agent', icon: 'code' });

    const appliers: Record<string, ProposalApplier> = {};
    registerDelegationApplier(
      { registerProposalApplier: (kind, applier) => (appliers[kind] = applier) },
      { configsRepo: repo },
    );

    const proposal = {
      id: 'p1',
      auditRunId: null,
      kind: 'grant-delegation',
      risk: 'high',
      external: 0,
      status: 'approved',
      title: 'Grant delegation',
      rationale: null,
      signalRef: null,
      targetRef: `agent_config:${manager.id}`,
      changeJson: JSON.stringify({
        agentConfigId: manager.id,
        allowed_delegates_json: { add: [specialist.id] },
      }),
      beforeSnapshotJson: null,
      provenanceJson: null,
      dedupKey: `grant-delegation:${manager.id}:${specialist.id}`,
      baselineScore: null,
      postScore: null,
      measureReason: null,
      decidedByUserId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await appliers['grant-delegation'](proposal);
    expect((result as { beforeSnapshotJson?: string }).beforeSnapshotJson).toBeTruthy();

    const updated = repo.getById(manager.id);
    expect(JSON.parse(updated!.allowedDelegatesJson!)).toEqual([specialist.id]);
  });

  it('refuses to apply when change_json smuggles a self-delegation, even though it passed proposal time', async () => {
    // Bug this catches: the applier trusts change_json verbatim instead of
    // re-running the eligibility guard, so a proposal that was tampered with
    // (or whose target became invalid) between proposal and approval would
    // silently create a forbidden self-delegation edge.
    const { registerDelegationApplier } = await import(
      '../services/generators/delegation_generator'
    );
    const repo = new AgentConfigsRepository();
    const manager = repo.insert({ id: 'secretary', label: 'Secretary', icon: 'mail', isManager: true });

    const appliers: Record<string, ProposalApplier> = {};
    registerDelegationApplier(
      { registerProposalApplier: (kind, applier) => (appliers[kind] = applier) },
      { configsRepo: repo },
    );

    const tamperedProposal = {
      id: 'p2',
      auditRunId: null,
      kind: 'grant-delegation',
      risk: 'high',
      external: 0,
      status: 'approved',
      title: 'Grant delegation (tampered)',
      rationale: null,
      signalRef: null,
      targetRef: `agent_config:${manager.id}`,
      changeJson: JSON.stringify({
        agentConfigId: manager.id,
        allowed_delegates_json: { add: [manager.id] }, // self-delegation smuggled in
      }),
      beforeSnapshotJson: null,
      provenanceJson: null,
      dedupKey: `grant-delegation:${manager.id}:${manager.id}`,
      baselineScore: null,
      postScore: null,
      measureReason: null,
      decidedByUserId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => appliers['grant-delegation'](tamperedProposal)).toThrow();

    const unchanged = repo.getById(manager.id);
    expect(unchanged!.allowedDelegatesJson).toBeNull();
  });

  it('refuses to apply when the manager was demoted (is_manager=0) since proposal time', async () => {
    const { registerDelegationApplier } = await import(
      '../services/generators/delegation_generator'
    );
    const repo = new AgentConfigsRepository();
    const manager = repo.insert({ id: 'secretary', label: 'Secretary', icon: 'mail', isManager: true });
    const specialist = repo.insert({ id: 'coding-agent', label: 'Coding Agent', icon: 'code' });

    const appliers: Record<string, ProposalApplier> = {};
    registerDelegationApplier(
      { registerProposalApplier: (kind, applier) => (appliers[kind] = applier) },
      { configsRepo: repo },
    );

    // Manager demoted after the proposal was created but before approval.
    repo.update(manager.id, { isManager: false });

    const proposal = {
      id: 'p3',
      auditRunId: null,
      kind: 'grant-delegation',
      risk: 'high',
      external: 0,
      status: 'approved',
      title: 'Grant delegation',
      rationale: null,
      signalRef: null,
      targetRef: `agent_config:${manager.id}`,
      changeJson: JSON.stringify({
        agentConfigId: manager.id,
        allowed_delegates_json: { add: [specialist.id] },
      }),
      beforeSnapshotJson: null,
      provenanceJson: null,
      dedupKey: `grant-delegation:${manager.id}:${specialist.id}:demoted`,
      baselineScore: null,
      postScore: null,
      measureReason: null,
      decidedByUserId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => appliers['grant-delegation'](proposal)).toThrow();
    const unchanged = repo.getById(manager.id);
    expect(unchanged!.allowedDelegatesJson).toBeNull();
  });
});
