import { describe, expect, it } from 'vitest';
import { assertOrgEvaluationTargetBinding } from '../org_evaluation_target_binding';
import type { OrgEvaluationTargetSnapshot } from '../org_evaluation_fixture';

const snapshot = { schemaVersion: 1, targetRef: 'agent_config:a', targetRevision: '1', kind: 'refine-config',
  effectiveModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6', source: 'hardcoded-default' },
  profiles: [], skills: [], schedules: [], recipes: [], managedSkillFiles: [] } as OrgEvaluationTargetSnapshot;
describe('evaluated target and apply payload binding', () => {
  it('rejects an otherwise valid config payload aimed at a dependency instead of the reviewed target', () => {
    expect(() => assertOrgEvaluationTargetBinding({ kind: 'refine-config', targetRef: 'agent_config:a', snapshot,
      change: { configPatch: { agentConfigId: 'b', field: 'system_prompt', value: 'Different target' } } })).toThrow(/different object/);
    expect(() => assertOrgEvaluationTargetBinding({ kind: 'refine-config', targetRef: 'agent_config:a', snapshot,
      change: { configPatch: { agentConfigId: 'a', field: 'system_prompt', value: 'Reviewed target' } } })).not.toThrow();
  });
  it('rejects a scope/task payload with a different durable target ID', () => {
    expect(() => assertOrgEvaluationTargetBinding({ kind: 'refine-scope', targetRef: 'agent_config:a', snapshot,
      change: { scopePatch: { agentConfigId: 'b', field: 'allowedSkillsJson', add: ['other-skill'] } } })).toThrow();
    expect(() => assertOrgEvaluationTargetBinding({ kind: 'refine-task', targetRef: 'scheduled_task:a', snapshot,
      change: { taskPatch: { scheduledTaskId: 'b', field: 'prompt', value: 'Other task' } } })).toThrow();
  });
});
