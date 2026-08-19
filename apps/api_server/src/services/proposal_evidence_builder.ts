/**
 * C5 — the deterministic evidence builder (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C5, requirements
 * 2-4).
 *
 * Closes the gap C4's own report named: proposal generators (and, before
 * this, an operator) had to hand-write a `ProposalEvidenceBundle` by typing
 * plausible-looking `sourceEvidence`/`counterEvidenceSearch`/`target` fields
 * — none of it provably tied to a real durable fact. This builder replaces
 * hand-typing with a real, deterministic read of durable state:
 *
 *   - `target.ref`/`target.hash` come from {@link toProfileTargetRef} /
 *     {@link buildProfileRevisionFingerprint} — the SAME functions
 *     org_proposal_experiment_service.ts's own eligibility check
 *     (`findEligibleExperiment`) will later recompute and compare against.
 *     A hand-typed hash can drift from the real target; this cannot.
 *   - `sourceEvidence` names the exact {@link BehavioralFact} ids that
 *     qualify as evidence for the hypothesis (this profile has been failing).
 *   - `counterEvidenceSearch` is a real, typed, closed-registry scan of
 *     every fact for the same profile — not a free-text sentence a human
 *     invented — and records its own coverage.
 *
 * Only supports `refine-config` (system-prompt-v1) today — the ONLY
 * treatment family this campaign's global invariants allow to ever reach a
 * verified promotion (see the contract's global_invariants). Every other
 * proposal kind is refused by name, not silently ignored: this builder is
 * not a general-purpose evidence fabricator for kinds nothing can treat.
 *
 * Every failure mode below (no proposal, wrong kind, unresolvable patch,
 * missing target state, no qualifying facts, a failed counter-evidence
 * scan) returns `{ ok: false, reason }` — NEVER a partial or best-effort
 * bundle, and never a thrown exception on the caller's happy path. An
 * unexperimentable proposal stays human-only; nothing here invents evidence
 * to force it into `paired-cohort-outcome`.
 */

import type { AgentOrgProposal } from '../models/agent_org_proposal';
import type { ProposalEvidenceBundle } from '../models/proposal_evidence_bundle';
import { KNOWN_METRIC_NAMES, PROPOSAL_EVIDENCE_BUNDLE_V2_VERSION } from '../models/proposal_evidence_bundle';
import { GUARDRAIL_NAMES } from '../models/guardrail_registry';
import { validateStrictRefineConfigChange } from '../models/experiment_treatment_adapter';
import { parseStrictJson } from './strict_json';
import { toProfileTargetRef, buildProfileRevisionFingerprint } from './org_proposal_experiment_service';
import { AgentConfigsRepository, type RevisionedAgentConfig } from '../repositories/agent_configs_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';

/** ponytail: at least one real prior failing fact — not a statistical minimum (the experiment's own stopping rule owns that), just "not fabricated out of thin air". */
const MIN_QUALIFYING_FACTS = 1;

const EVIDENCE_BUILDER_VERSION = 'proposal-evidence-builder-v1';

export type EvidenceBuildResult =
  | { ok: true; bundle: ProposalEvidenceBundle; qualifyingFactIds: string[] }
  | { ok: false; reason: string };

export interface EvidenceBuilderDeps {
  configsRepo?: AgentConfigsRepository;
  outcomesRepo?: AgentRunOutcomesRepository;
}

/** A qualifying fact: real evidence the target profile has an active problem. */
function isQualifyingFailure(o: { terminalStatus: string; objectiveVerdict: string }): boolean {
  return o.terminalStatus === 'error' || o.objectiveVerdict === 'failure';
}

/** Counter-evidence: a real success for the same profile — would contradict "this profile needs fixing". */
function isContradictingSuccess(o: { objectiveVerdict: string }): boolean {
  return o.objectiveVerdict === 'success';
}

export async function buildProposalEvidenceAsync(
  proposal: AgentOrgProposal,
  deps: EvidenceBuilderDeps = {},
): Promise<EvidenceBuildResult> {
  if (proposal.kind !== 'refine-config') {
    return {
      ok: false,
      reason:
        `evidence builder only supports 'refine-config' (system-prompt-v1) proposals today, ` +
        `got '${proposal.kind}' — this proposal remains unexperimentable/human-only`,
    };
  }

  let parsedChange: unknown;
  try {
    parsedChange = parseStrictJson(proposal.changeJson ?? '', 'changeJson');
  } catch (err) {
    return {
      ok: false,
      reason: `evidence builder: change_json is not valid JSON (${String((err as Error).message ?? err)})`,
    };
  }
  const patchValidation = validateStrictRefineConfigChange(parsedChange);
  if (!patchValidation.valid) {
    return {
      ok: false,
      reason:
        `evidence builder: proposal ${proposal.id} has no machine-applyable system-prompt-v1 patch ` +
        `(${patchValidation.reasons.join('; ')}) — a prose-only diagnosis cannot be automatically evidenced`,
    };
  }
  const { agentConfigId } = patchValidation.patch;

  const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();
  const config: RevisionedAgentConfig | null = configsRepo.getById(agentConfigId);
  if (!config) {
    return {
      ok: false,
      reason: `evidence builder: target agent_config '${agentConfigId}' no longer exists (missing target state)`,
    };
  }
  if (typeof config.systemPrompt !== 'string') {
    return {
      ok: false,
      reason:
        `evidence builder: target agent_config '${agentConfigId}' has no durable system prompt to ` +
        'evidence against (missing target state)',
    };
  }

  const outcomesRepo = deps.outcomesRepo ?? new AgentRunOutcomesRepository();
  let facts;
  try {
    facts = await outcomesRepo.listByProfileAsync(agentConfigId);
  } catch (err) {
    return {
      ok: false,
      reason:
        `evidence builder: the counter-evidence search could not read the fact ledger for ` +
        `'${agentConfigId}' (incomplete counter-evidence coverage): ${String((err as Error).message ?? err)}`,
    };
  }

  const qualifying = facts.filter(isQualifyingFailure);
  if (qualifying.length < MIN_QUALIFYING_FACTS) {
    return {
      ok: false,
      reason:
        `evidence builder: '${agentConfigId}' has no qualifying behavioral facts (need at least ` +
        `${MIN_QUALIFYING_FACTS} failing/error run, found ${qualifying.length}) — this proposal ` +
        'remains unexperimentable/human-only',
    };
  }

  // Typed counter-evidence search: a full, deterministic scan of every fact
  // this profile has, not a bounded sample — coverage is genuinely 1 on
  // success (the only way it is anything less is the caught read failure
  // above, which already refuses before reaching here).
  const contradictingCount = facts.filter(isContradictingSuccess).length;
  const coverage = 1;

  const metricName = 'objective-success-rate';
  if (!KNOWN_METRIC_NAMES.has(metricName)) {
    // Defensive, not reachable with today's closed registry — kept real
    // rather than assumed, matching guardrail_registry.ts's own posture.
    return { ok: false, reason: `evidence builder: metric '${metricName}' is not a known computable metric` };
  }

  const bundle: ProposalEvidenceBundle = {
    version: PROPOSAL_EVIDENCE_BUNDLE_V2_VERSION,
    sourceEvidence: {
      sessionIds: [...new Set(qualifying.map((f) => f.rootSessionId))],
      eventIds: qualifying.map((f) => f.id),
    },
    counterEvidenceSearch: {
      query: `agent_run_outcomes finalized rows for profile '${agentConfigId}'`,
      searchedAt: new Date().toISOString(),
      contradictingCount,
      method: 'same-profile-ledger-scan',
      coverage,
    },
    target: {
      ref: toProfileTargetRef(agentConfigId),
      hash: buildProfileRevisionFingerprint(config),
    },
    expectedOutcome: `objective-success-rate improves for agent_config '${agentConfigId}' under the candidate system prompt`,
    primaryMetric: { name: metricName, direction: 'increase' },
    guardrails: [...GUARDRAIL_NAMES],
    experimentAdapter: 'paired-cohort-outcome',
    rollbackRule:
      'revert to the exact prior system prompt recorded in the tested candidateSpec.priorValue via the existing refine-config revert path',
    generatorVersion: EVIDENCE_BUILDER_VERSION,
    confidenceCalibrationVersion: 'uncalibrated',
  };

  return { ok: true, bundle, qualifyingFactIds: qualifying.map((f) => f.id) };
}
