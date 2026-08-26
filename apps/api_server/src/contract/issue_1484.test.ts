import { describe, expect, it } from 'vitest';
import { buildTaskDelegatePermissions, injectManagerPreamble } from '../services/opencode_agent_writer';

describe('#1484 roster-aware manager routing', () => {
  it('issue-1484-c1: mandates workflow-orchestrator when effectively allowed', () => {
    const roster = ['workflow-orchestrator', 'librarian'];
    const permissions = buildTaskDelegatePermissions(roster, 'manager');
    expect(permissions['workflow-orchestrator']).toBe('allow');
    expect(injectManagerPreamble('Manager body', true, roster, 'manager')).toContain('subagent_type="workflow-orchestrator"');
  });

  it('issue-1484-c2: omits workflow-orchestrator requirements when absent', () => {
    const body = injectManagerPreamble('Manager body', true, ['librarian'], 'manager');
    expect(body).not.toContain('workflow-orchestrator');
  });

  it('issue-1484-c3: generated routing never mandates a task target denied by projection', () => {
    const roster = ['librarian'];
    const permissions = buildTaskDelegatePermissions(roster, 'manager');
    const body = injectManagerPreamble('Manager body', true, roster, 'manager');
    expect(permissions['workflow-orchestrator']).toBeUndefined();
    expect(body).not.toContain('subagent_type="workflow-orchestrator"');
  });

  it('issue-1484-c4: preserves intentionally narrow delegate rosters', () => {
    expect(buildTaskDelegatePermissions(['librarian'], 'manager')).toEqual({
      '*': 'deny', explore: 'allow', general: 'allow', librarian: 'allow',
    });
  });

  it('issue-1484-c5: covers both effective roster outcomes', () => {
    const withWorkflow = injectManagerPreamble('body', true, ['workflow-orchestrator'], 'manager');
    const withoutWorkflow = injectManagerPreamble('body', true, ['librarian'], 'manager');
    expect(withWorkflow).toContain('workflow-orchestrator');
    expect(withoutWorkflow).not.toContain('workflow-orchestrator');
  });
});
