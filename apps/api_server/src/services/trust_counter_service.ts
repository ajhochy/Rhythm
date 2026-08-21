/**
 * D4.2 (#1440) — trust counter service.
 *
 * Reads the EXISTING experiment/outcome ledger — never a second tally — and
 * recomputes the D4.1 (#1439) trust-state singleton's counters via
 * AgentOrgExperimentsRepository.getTrustLedgerCountsAsync(), a single
 * aggregate query so both counters reflect one consistent snapshot:
 *   - totalVerified: agent_org_experiments rows whose associated proposal
 *     has outcome_status='verified' (W6-c8's authoritative outcome field). A
 *     verified proposal with no experiment does not count — #1440 requires
 *     counting verified EXPERIMENTS, not verified proposals.
 *   - totalRegressions: agent_org_experiments rows with decision='regress'
 *     (W6-c12's authoritative decision field).
 * `autoPromotionEligible` is derived (totalVerified >= trustThreshold AND
 * totalRegressions === 0) and persisted alongside the counts. D4.6 makes a
 * non-zero durable regression atomically disable the gate; this service never
 * enables it.
 *
 * This module NEVER sets `autoPromotionEnabled` true. A regression can only
 * force it false through the repository's atomic persistence boundary.
 */
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { PromotionTrustStateRepository } from '../repositories/promotion_trust_state_repository';
import type { PromotionTrustState } from '../models/promotion_trust_state';

export interface TrustCounterDeps {
  experimentsRepo?: AgentOrgExperimentsRepository;
  trustStateRepo?: PromotionTrustStateRepository;
}

export interface TrustCounterCounts {
  totalVerified: number;
  totalRegressions: number;
  autoPromotionEligible: boolean;
}

/** Read-only tally against the current threshold. Does not persist anything. */
export async function computeTrustCountersAsync(deps: TrustCounterDeps = {}): Promise<TrustCounterCounts> {
  const experimentsRepo = deps.experimentsRepo ?? new AgentOrgExperimentsRepository();
  const trustStateRepo = deps.trustStateRepo ?? new PromotionTrustStateRepository();

  const [ledgerCounts, trustState] = await Promise.all([
    experimentsRepo.getTrustLedgerCountsAsync(),
    trustStateRepo.getSingletonAsync(),
  ]);

  const { totalVerified, totalRegressions } = ledgerCounts;
  const autoPromotionEligible = totalVerified >= trustState.trustThreshold && totalRegressions === 0;

  return { totalVerified, totalRegressions, autoPromotionEligible };
}

/**
 * Recomputes the counters and durably records them on the singleton.
 * A zero-regression refresh preserves the gate; a non-zero durable regression
 * atomically disables it — see PromotionTrustStateRepository.recordEligibilityAsync.
 */
export async function recordTrustCountersAsync(deps: TrustCounterDeps = {}): Promise<PromotionTrustState> {
  const trustStateRepo = deps.trustStateRepo ?? new PromotionTrustStateRepository();
  const counters = await computeTrustCountersAsync({ ...deps, trustStateRepo });
  return trustStateRepo.recordEligibilityAsync(counters);
}
