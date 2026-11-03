import { describe, expect, it } from 'vitest';

import type { AgentConfig } from '../repositories/agent_configs_repository';
import { computeCodingWorkflowCapability, renderCodingWorkflowCapabilityLine } from '../services/coding_workflow_capability';

const cfg = (id: string, over: Partial<AgentConfig> = {}) => ({
  id, enabled: true, isAgent: true, locked: false,
  allowedDelegatesJson: id === 'workflow-orchestrator' ? '["verification-gate"]' : null, ...over,
}) as unknown as AgentConfig;

const run = (profiles: AgentConfig[], over: { projectAuthorized?: boolean } = {}) =>
  computeCodingWorkflowCapability({
    configs: { getById: (id) => profiles.find((p) => p.id === id) ?? null },
    projectAuthorized: true, ...over,
  });

const good = () => [cfg('workflow-orchestrator'), cfg('verification-gate')];

describe('computeCodingWorkflowCapability', () => {
  it('available only when manager, reviewer and project all pass; shape is fixed', () => {
    expect(run(good())).toEqual({
      lane: 'coding_workflow', available: true, reason: null,
      crossProject: 'unsupported',
    });
  });

  it.each([
    ['reviewer missing', () => [cfg('workflow-orchestrator')], {}, "profile missing: 'verification-gate'"],
    ['manager missing', () => [cfg('verification-gate')], {}, "profile missing: 'workflow-orchestrator'"],
    ['reviewer disabled', () => [cfg('workflow-orchestrator'), cfg('verification-gate', { enabled: false })], {}, "agent disabled: 'verification-gate'"],
    ['reviewer locked', () => [cfg('workflow-orchestrator'), cfg('verification-gate', { locked: true })], {}, "agent security-locked: 'verification-gate'"],
    ['manager cannot delegate', () => [cfg('workflow-orchestrator', { allowedDelegatesJson: '[]' }), cfg('verification-gate')], {}, "may not delegate"],
    ['project unauthorized', good, { projectAuthorized: false }, 'not authorized'],
  ] as const)('%s -> unavailable with the server reason', (_n, profiles, over, reason) => {
    const item = run(profiles(), over);
    expect(item.available).toBe(false);
    expect(item.reason).toContain(reason);
    expect(item.crossProject).toBe('unsupported');
  });

  it('a throwing config read is unavailable, never available', () => {
    const item = computeCodingWorkflowCapability({
      configs: { getById: () => { throw new Error('db'); } }, projectAuthorized: true,
    });
    expect(item).toMatchObject({ available: false, reason: 'capability check failed' });
  });

  it('the prompt line states availability, reason, checks and cross-project', () => {
    expect(renderCodingWorkflowCapabilityLine(run(good()))).toContain('available; cross-project execution: unsupported');
    expect(renderCodingWorkflowCapabilityLine(run([cfg('workflow-orchestrator')]))).toContain("UNAVAILABLE (profile missing: 'verification-gate')");
  });
});
