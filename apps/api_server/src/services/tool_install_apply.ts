/**
 * D1.4 (#1429) — the only production boundary allowed to apply a vetted
 * tool-install proposal. Rhythm has no managed arbitrary-package installer,
 * so the production implementation deliberately fails closed. Tests inject a
 * no-op boundary to prove lifecycle ordering without executing on the host.
 */
import type { AgentOrgProposal } from '../models/agent_org_proposal';

export type ToolInstallApplyReason = 'tool_install_apply_unavailable';

export interface ToolInstallApplyResult {
  applied: boolean;
  reason: ToolInstallApplyReason | null;
}

export type ToolInstallApplier = (proposal: AgentOrgProposal) => Promise<ToolInstallApplyResult>;

export async function applyVettedToolInstallAsync(
  proposal: AgentOrgProposal,
  applier: ToolInstallApplier = async () => ({
    applied: false,
    reason: 'tool_install_apply_unavailable',
  }),
): Promise<ToolInstallApplyResult> {
  return applier(proposal);
}
