/**
 * workflow_signal_generator.ts — issue #935 (workflow-failure-signals-03).
 *
 * Feeds `OrgAuditSnapshot.workflowFailureSignals` (#933/#934) into the
 * EXISTING Org Optimizer proposal lanes — this generator invents NO new
 * proposal `kind`. Only two existing kinds are used, both already HIGH risk
 * and human-gated per `org_risk_classifier.ts` (never auto-applied):
 *
 *   - `broaden-scope` — for category='missing-scope'. A dispatch-guard
 *     denial (`denied_tool_events`, structured — not regex) is unambiguous
 *     evidence a profile is missing an MCP grant it actually needed. Mirrors
 *     `scope_hygiene_generator.ts`'s `AgentConfigScopeChange` shape exactly
 *     (`{agentConfigId, field, add:[name]}`), just adding instead of removing.
 *
 *   - `create-recipe` — for every other category (retry-loop,
 *     hallucinated-claim, unverified-claim, stale-redo, repeated-correction,
 *     tool-unavailable-attempted, and delegate-result outcomes
 *     failed/transport-empty/incomplete). These are behavioral/workflow
 *     patterns with no existing `agent_cookbook`/`agent_skills` artifact to
 *     REFINE (that is what `recipe_generator.ts`'s own independent sweep
 *     over `snapshot.recipes` already covers, unmodified, every run) — V1 has
 *     no LLM classifier to safely synthesize a NEW artifact's fully-scoped
 *     body/system-prompt (`create-agent`) or to prove an alternate specialist
 *     exists (`grant-delegation`/`expand-delegation`, per the issue's "only
 *     if evidence shows a real delegation gap" — V1's evidence model never
 *     shows that), so the safe, honest, gated fallback is a `create-recipe`
 *     proposal suggesting a documented procedure/checklist a human can
 *     review and materialize. Reuses `recipe_generator.ts`'s registered
 *     `create-recipe` applier unmodified (this generator does not register
 *     its own — same kind, same apply step, regardless of which generator
 *     proposed the row).
 *
 * `delegateOutcome='unknown'` NEVER reaches a proposal — low-confidence/
 * unknown delegated-session evidence must never create a failure proposal
 * (issue #935 AC). The extractor itself already gates one-off ambiguous
 * evidence; this generator additionally never escalates 'unknown'.
 *
 * Dedup keys are stable per category(+outcome)+profile (or +scope name for
 * missing-scope) — NOT per audit run — so re-running the optimizer over the
 * same unresolved pattern collapses to the existing proposal row via the
 * repository's own `dedup_key` idempotency (#936 groundwork).
 *
 * Operational envelope (mirrors recipe_generator.ts / scope_hygiene_generator.ts):
 *   • NEVER throws — the caller is the fire-and-forget optimizer loop.
 *   • A single malformed/unparseable signal is logged and skipped, never fatal.
 */

import { logger } from '../../utils/logger';
import { classifyProposalRisk } from '../org_risk_classifier';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import type { AgentOrgProposal, AgentOrgProposalInput } from '../../models/agent_org_proposal';
import type { OrgAuditSnapshot } from '../org_audit_service';
import type { WorkflowFailureSignal } from '../workflow_failure_signal_extractor';

export interface WorkflowSignalGeneratorDeps {
  /** Injectable proposals repo (defaults to a fresh AgentOrgProposalsRepository). */
  proposalsRepo?: Pick<AgentOrgProposalsRepository, 'createAsync' | 'existsByDedupKeyAsync'>;
}

export interface WorkflowSignalGeneratorResult {
  created: AgentOrgProposal[];
}

/** Parses `deniedTool=<name>` out of a missing-scope signal's evidence string. */
function parseDeniedToolName(evidence: string): string | null {
  const match = /deniedTool=(\S+)/.exec(evidence);
  return match ? match[1] : null;
}

const CATEGORY_TITLES: Record<string, string> = {
  'retry-loop': 'reduce retry loops',
  'hallucinated-claim': 'verify commit/PR claims before reporting done',
  'unverified-claim': 'actually run tests/build before claiming verification',
  'stale-redo': 'confirm an issue is truly fixed before closing it out',
  'repeated-correction': 'clarify requirements before implementing',
  'tool-unavailable-attempted': 'check tool availability before retrying',
};

function profileLabel(agentConfigId: string | null): string {
  return agentConfigId ?? 'unattributed';
}

function buildCreateRecipeChange(title: string, evidence: string): string {
  return JSON.stringify({
    title,
    description: `Recurring workflow friction observed: ${evidence}`,
    steps_json: JSON.stringify([{ action: 'prompt', text: title }]),
  });
}

async function createIfNotDuplicate(
  proposalsRepo: NonNullable<WorkflowSignalGeneratorDeps['proposalsRepo']>,
  input: AgentOrgProposalInput,
): Promise<AgentOrgProposal | null> {
  if (input.dedupKey && (await proposalsRepo.existsByDedupKeyAsync(input.dedupKey))) {
    logger.info(`[workflow-signal-generator] skipped duplicate proposal for dedup_key='${input.dedupKey}'`);
    return null;
  }
  return proposalsRepo.createAsync(input);
}

async function proposeMissingScope(
  signal: WorkflowFailureSignal,
  proposalsRepo: NonNullable<WorkflowSignalGeneratorDeps['proposalsRepo']>,
): Promise<AgentOrgProposal | null> {
  const toolName = parseDeniedToolName(signal.evidence);
  if (!toolName || !signal.agentConfigId) {
    logger.warn(`[workflow-signal-generator] unparseable missing-scope evidence: '${signal.evidence}'`);
    return null;
  }

  const changeJson = JSON.stringify({
    agentConfigId: signal.agentConfigId,
    field: 'allowedMcpsJson',
    add: [toolName],
  });
  const risk = classifyProposalRisk({ kind: 'broaden-scope', changeJson });

  return createIfNotDuplicate(proposalsRepo, {
    kind: 'broaden-scope',
    risk,
    title: `Grant missing scope '${toolName}' to ${signal.agentConfigId}`,
    rationale: `${signal.evidence} (workflow signal: repeated dispatch-guard denial)`,
    signalRef: `workflow:missing-scope:${signal.agentConfigId}:${toolName}`,
    targetRef: `agent_config:${signal.agentConfigId}:mcp:${toolName}`,
    changeJson,
    dedupKey: `broaden-scope:${signal.agentConfigId}:mcp:${toolName}`,
  });
}

async function proposeCreateRecipeForCategory(
  signal: WorkflowFailureSignal,
  proposalsRepo: NonNullable<WorkflowSignalGeneratorDeps['proposalsRepo']>,
): Promise<AgentOrgProposal | null> {
  const profile = profileLabel(signal.agentConfigId);
  let humanTitle: string;
  let dedupSuffix: string;

  if (signal.category === 'delegate-result') {
    humanTitle = `verify delegated (${signal.delegateOutcome}) results before reporting done`;
    dedupSuffix = `delegate-result:${signal.delegateOutcome}`;
  } else {
    humanTitle = CATEGORY_TITLES[signal.category] ?? signal.category;
    dedupSuffix = signal.category;
  }

  const title = `Recipe: ${humanTitle} (${profile})`;
  const changeJson = buildCreateRecipeChange(title, signal.evidence);
  const risk = classifyProposalRisk({ kind: 'create-recipe', changeJson });
  // #936 — dedup on the signal's STABLE identity (dedupToken), not the profile.
  // profile is empty ('unattributed') for agent-less sessions, so distinct
  // patterns (e.g. stale-redo of different issues) all collapsed into one
  // dedup key and only the first ever surfaced. dedupToken is issue-scoped for
  // stale-redo, session-scoped for single-session incidents, profile-scoped
  // for the profile-grouped categories.
  const dedupKey = `create-recipe:workflow:${dedupSuffix}:${signal.dedupToken}`;

  return createIfNotDuplicate(proposalsRepo, {
    kind: 'create-recipe',
    risk,
    title,
    rationale: `${signal.evidence} (workflow signal: ${signal.category}, confidence=${signal.confidence})`,
    signalRef: `workflow:${signal.category}:${signal.dedupToken}`,
    targetRef: signal.agentConfigId ? `agent_config:${signal.agentConfigId}` : null,
    changeJson,
    dedupKey,
  });
}

/**
 * Generate proposals from workflow failure signals, reusing only existing
 * `agent_org_proposals` kinds. NEVER throws — a malformed individual signal
 * is logged and skipped, not fatal.
 */
export async function generateWorkflowSignalProposals(
  snapshot: OrgAuditSnapshot,
  deps: WorkflowSignalGeneratorDeps = {},
): Promise<WorkflowSignalGeneratorResult> {
  const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
  const created: AgentOrgProposal[] = [];

  for (const signal of snapshot.workflowFailureSignals ?? []) {
    try {
      // Low-confidence/unknown delegate evidence must NEVER produce a
      // proposal — the ambiguity is real, not just under-evidenced.
      if (signal.category === 'delegate-result' && signal.delegateOutcome === 'unknown') {
        continue;
      }

      const proposal =
        signal.category === 'missing-scope'
          ? await proposeMissingScope(signal, proposalsRepo)
          : await proposeCreateRecipeForCategory(signal, proposalsRepo);

      if (proposal) created.push(proposal);
    } catch (err) {
      logger.warn(
        `[workflow-signal-generator] FAILED processing signal (category=${signal.category}, non-fatal): ${String(err)}`,
      );
    }
  }

  return { created };
}
