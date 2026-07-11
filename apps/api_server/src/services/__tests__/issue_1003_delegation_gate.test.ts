import { describe, it, expect } from 'vitest';
import { diagnosisToProposalKind } from '../generators/workflow_signal_generator';
import { validateDelegationChangeShape } from '../org_proposal_appliers_wiring';
import type { DiagnosisResult } from '../org_diagnosis_types';
import type { AgentOrgProposal } from '../../models/agent_org_proposal';

// #1003 — an LLM `delegation-change` diagnosis must NOT create an un-approvable
// grant-delegation proposal (its envelope has no concrete delegate target), and
// any legacy diagnosis-envelope grant-delegation row already in the queue must
// fail approval with an actionable reason instead of a cryptic id error.
describe('#1003 delegation-change diagnosis gate', () => {
  const kindFor = (fixType: DiagnosisResult['fixType']) =>
    diagnosisToProposalKind({ fixType } as unknown as DiagnosisResult);

  it('routes delegation-change to null so no grant-delegation proposal is created', () => {
    expect(kindFor('delegation-change')).toBeNull();
  });

  it('still maps the other actionable fix types unchanged', () => {
    expect(kindFor('skill-edit')).toBe('workflow-prompt-fix');
    expect(kindFor('config-change')).toBe('refine-config');
    expect(kindFor('scope-change')).toBe('refine-scope');
    expect(kindFor('external-noop')).toBeNull();
  });

  const proposalWith = (changeJson: string) => ({ changeJson } as unknown as AgentOrgProposal);

  it('gives an actionable refusal for a legacy diagnosis-envelope grant-delegation item', () => {
    const result = validateDelegationChangeShape(
      proposalWith(JSON.stringify({ fixType: 'delegation-change', diagnosis: 'needs a helper' })),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/dismiss this item/i);
  });

  it('still reports the concrete-shape error for a non-diagnosis payload missing agentConfigId', () => {
    const result = validateDelegationChangeShape(proposalWith(JSON.stringify({ foo: 'bar' })));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/agentConfigId is required/);
  });
});
