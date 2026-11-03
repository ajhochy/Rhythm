import type { CoordinatorCodingWorkflowCapability } from '../contracts/coordinator_conversation_contract';
import { agentConfigExecutionBlockReason, type AgentConfig } from '../repositories/agent_configs_repository';

/**
 * Status-only roster predicate for the one coding path (goal ->
 * workflow-orchestrator, which may delegate review to verification-gate).
 */
export const CODING_WORKFLOW_MANAGER_ID = 'workflow-orchestrator';
export const CODING_WORKFLOW_REVIEWER_ID = 'verification-gate';

function delegatesToReviewer(manager: AgentConfig): boolean {
  try {
    const value: unknown = manager.allowedDelegatesJson ? JSON.parse(manager.allowedDelegatesJson) : [];
    return Array.isArray(value) && value.includes(CODING_WORKFLOW_REVIEWER_ID);
  } catch {
    return false;
  }
}

function profileReason(config: AgentConfig | null | undefined, id: string): string | null {
  if (!config) return `profile missing: '${id}'`;
  if (!config.isAgent) return `profile is not an agent: '${id}'`;
  return agentConfigExecutionBlockReason(config);
}

export function computeCodingWorkflowCapability(input: {
  configs: { getById(id: string): AgentConfig | null | undefined };
  projectAuthorized: boolean;
}): CoordinatorCodingWorkflowCapability {
  let reason: string | null = null;
  try {
    const manager = input.configs.getById(CODING_WORKFLOW_MANAGER_ID);
    const reviewer = input.configs.getById(CODING_WORKFLOW_REVIEWER_ID);
    reason = !input.projectAuthorized ? 'current project is not authorized for this owner'
      : profileReason(manager, CODING_WORKFLOW_MANAGER_ID) ?? profileReason(reviewer, CODING_WORKFLOW_REVIEWER_ID) ??
        (manager && !delegatesToReviewer(manager) ? `manager '${CODING_WORKFLOW_MANAGER_ID}' may not delegate to '${CODING_WORKFLOW_REVIEWER_ID}'` : null);
  } catch {
    reason = 'capability check failed';
  }
  return capability(reason);
}

export function capability(reason: string | null): CoordinatorCodingWorkflowCapability {
  return {
    lane: 'coding_workflow',
    available: reason === null,
    reason,
    crossProject: 'unsupported',
  };
}

/** One server-authored line for the prompt preface so the model never guesses from stale run reports. */
export function renderCodingWorkflowCapabilityLine(item: CoordinatorCodingWorkflowCapability): string {
  return `Coding Workflow lane: ${item.available ? 'available' : `UNAVAILABLE (${item.reason ?? 'unknown'})`}; ` +
    `cross-project execution: ${item.crossProject}. ` +
    'This line, not earlier run reports, is the current capability state.';
}
