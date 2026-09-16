import type { AgentCapabilityGapsRepository } from '../repositories/agent_capability_gaps_repository';
import type { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import type { RunGeneratorResult } from './generators/external_discovery_generator';
import type { discoverCandidatesFromEcosystem } from './generators/external_discovery_search';

export interface GapDiscoveryDeps {
  gapsRepo?: AgentCapabilityGapsRepository;
  proposalsRepo?: AgentOrgProposalsRepository;
  discoverCandidates?: typeof discoverCandidatesFromEcosystem;
}

export type GapDiscoveryPassResult = RunGeneratorResult & {
  gapsConsidered: number;
  skipped: boolean;
  skippedReason?: string;
};

/** Compatibility result for the retired automatic external-adoption lane. */
export async function runGapDrivenDiscoveryPass(
  _deps: GapDiscoveryDeps = {},
): Promise<GapDiscoveryPassResult> {
  return {
    emitted: 0, droppedNoGap: 0, droppedMissingProvenance: 0,
    droppedDuplicate: 0, droppedInstalledOverlap: 0, errored: false,
    gapsConsidered: 0, skipped: true,
    skippedReason: 'Automatic external discovery retired in favor of Org Reviewer',
  };
}

/** New capability gaps remain evidence; they no longer schedule adoption work. */
export function scheduleGapDrivenDiscovery(
  _runFn: () => Promise<unknown> = runGapDrivenDiscoveryPass,
): void {}

/** Retained for existing callers; the retired lane holds no timers or state. */
export function _resetGapDiscoverySchedulerForTests(): void {}
