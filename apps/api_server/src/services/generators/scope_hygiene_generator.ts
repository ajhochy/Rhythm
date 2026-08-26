/**
 * scope_hygiene_generator.ts — #822 (org-optimizer-06)
 *
 * Translates `OrgAuditSnapshot.gaps` (kind='prune-scope' | 'tighten-scope',
 * computed read-only by `org_audit_service.ts`) and
 * `OrgAuditSnapshot.skillOverlapCandidates` into `agent_org_proposals` rows,
 * per docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md §4:
 *
 *   - `prune-scope`   — a dead/unresolved allowlist name (drift gap).
 *   - `tighten-scope` — a granted MCP tool with zero invocations in the
 *     trailing window (never-invoked gap).
 *   - `consolidate-skill` — 2+ skills whose titles overlap above the audit
 *     service's own Jaccard threshold (`SKILL_OVERLAP_THRESHOLD` in
 *     org_audit_service.ts; NOT re-filtered here).
 *
 * This module ONLY reads `snapshot.gaps` / `snapshot.skillOverlapCandidates`
 * for the tighten/prune signal — it never re-derives its own "unused tool"
 * or "dead name" candidates from `snapshot.profiles` / `snapshot.drift`
 * directly. `org_audit_service.ts` already computed those against the real
 * live-engine set and denied-tool telemetry; re-deriving here would risk
 * disagreeing with that computation and proposing removal of a tool that was
 * actually exercised (the hard safety invariant this generator must never
 * violate).
 *
 * USER-AUTHORED SCOPE ENTRIES (#785 overlay preservation): the audit
 * snapshot carries no per-name "who set this" bit, so this module accepts an
 * injectable `isUserAuthoredScopeEntry` predicate (default: always false,
 * i.e. "assume derived" — callers with real overlay/authorship data override
 * it). When the predicate returns true for a prune-scope gap's
 * profile+scopeKind+name, the proposal for that gap is still recorded (so
 * the human can see it and the gap is not silently dropped/forgotten) but
 * is classified `risk='high'` regardless of what `classifyProposalRisk`
 * would otherwise say — i.e. it is EXCLUDED from the auto-apply lane and
 * must go through the human-gate queue. It is NEVER emitted as an auto-apply
 * low-risk prune. Tighten-scope and consolidate-skill proposals are not
 * subject to this check — they never remove a USER-entered name (tighten
 * only fires on a currently-matched/live name that was simply never
 * invoked, and consolidate-skill never mutates an allowlist at all).
 *
 * APPLY-SIDE WIRING NOTE (for #830/#831): scope changes must go through the
 * registered human-gate appliers; `org_proposal_apply.ts` refuses the direct
 * `{agentConfigId, field, remove}` shape on its unattended lane.
 *   - `org_proposal_measure.ts`'s `measureScopeChange` already measures
 *     tighten-scope/prune-scope (functional-guard keep/revert), and
 *     `measureBodyRefinement` already measures consolidate-skill IF a
 *     `changeJson` shaped as `{priorBody, revisedBody, ...}` is present.
 *     This generator's consolidate-skill payload does NOT include
 *     `priorBody`/`revisedBody` — it only detects and proposes the
 *     *pairing* ({skillIdA, skillIdB, titleA, titleB, similarity}); it does
 *     not draft a merged body itself. #852 closed the resulting gap: at
 *     apply time, `org_proposal_apply.applyProposal` now drafts the merged
 *     body (`skill_consolidation_drafter.ts` — a mechanical
 *     concatenate-and-dedup-sections merge, no LLM call) and reshapes
 *     `change_json` into the `BodyRefinementChange` shape BEFORE the row
 *     reaches `measuring`, so `measureBodyRefinement` sees a normal
 *     body-refinement payload and no longer parks the row indefinitely.
 *   - No `registerProposalApplier` / `registerProposalValidator`
 *     (`org_proposal_apply_service.ts`, #826) registration is needed for
 *     any of these three kinds: all three are `risk='low'` (except a
 *     user-authored prune, escalated to `'high'` above) and therefore flow
 *     through the direct `proposed -> applied` auto-apply lane, never the
 *     human-gate queue's registered-applier path that #826 seam serves.
 *
 * Operational envelope (mirrors org_proposal_apply.ts / org_proposal_measure.ts):
 *   • NEVER throws — the caller is the fire-and-forget optimizer loop.
 *   • A single malformed gap (e.g. an evidence string that does not match
 *     the expected format) is logged and skipped; it never aborts the rest
 *     of the run.
 */

import { logger } from '../../utils/logger';
import { classifyProposalRisk } from '../org_risk_classifier';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import type { OrgAuditSnapshot, OrgAuditGap, SkillOverlapCandidate } from '../org_audit_service';
import type { AgentOrgProposalInput } from '../../models/agent_org_proposal';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentSkillsRepository } from '../../repositories/agent_skills_repository';
import { resolveProfileMcpScope } from '../agent_profile_scope';

export type ScopeKind = 'mcp' | 'skill';

/** Shape written to `change_json` for a scope mutation — mirrors org_proposal_apply.ts's AgentConfigScopeChange. */
interface AgentConfigScopeChangePayload {
  agentConfigId: string;
  field: 'allowedMcpsJson' | 'allowedSkillsJson';
  remove: string[];
}

export interface ScopeHygieneDeps {
  /** Injectable proposals repo (defaults to a fresh AgentOrgProposalsRepository). */
  proposalsRepo?: Pick<AgentOrgProposalsRepository, 'createAsync' | 'existsByDedupKeyAsync'>;
  /**
   * Returns true when the given profile/scopeKind/name combination is a
   * USER-authored scope entry (#785 overlay) rather than a derived default.
   * Default: always false (no positive signal to say otherwise). See the
   * module doc comment for what happens when this returns true.
   */
  isUserAuthoredScopeEntry?: (profileId: string, scopeKind: ScopeKind, name: string) => boolean;
  /**
   * Returns true when the profile prompt or one of its allowed skills still
   * requires an MCP server. The default lookup is best-effort so generator
   * callers with no initialized database retain the original #822 behavior.
   */
  isMcpRequiredByProfile?: (profileId: string, serverName: string) => boolean;
}

function defaultIsUserAuthoredScopeEntry(): boolean {
  return false;
}

function mcpRequirementAliases(serverName: string): string[] {
  const lower = serverName.toLowerCase();
  const withoutSuffix = lower.replace(/[-_]mcp$/, '');
  return [...new Set([
    lower,
    lower.replaceAll('-', '_'),
    lower.replaceAll('_', '-'),
    withoutSuffix,
    withoutSuffix.replaceAll('-', '_'),
    withoutSuffix.replaceAll('_', '-'),
  ].filter(Boolean))];
}

function defaultIsMcpRequiredByProfile(profileId: string, serverName: string): boolean {
  try {
    const config = new AgentConfigsRepository().getById(profileId);
    if (!config) return false;
    const aliases = mcpRequirementAliases(serverName);
    const mentionsServer = (text: string | null | undefined) => {
      const lower = text?.toLowerCase() ?? '';
      return aliases.some((alias) => lower.includes(alias));
    };
    if (mentionsServer(config.systemPrompt)) return true;

    const scope = resolveProfileMcpScope(config.allowedMcpsJson, config.id, config.label);
    if (
      scope.shape === 'tools-map' &&
      Object.entries(scope.toolsByServer).some(
        ([storedServer, tools]) =>
          tools.length > 0 &&
          mcpRequirementAliases(storedServer).some((alias) => aliases.includes(alias)),
      )
    ) return true;

    const allowedSkills = config.allowedSkillsJson
      ? new Set(
          (JSON.parse(config.allowedSkillsJson) as unknown[]).filter(
            (name): name is string => typeof name === 'string',
          ),
        )
      : new Set<string>();
    return new AgentSkillsRepository()
      .list()
      .some(
        (skill) =>
          allowedSkills.has(skill.title) && mentionsServer(skill.body),
      );
  } catch {
    return false;
  }
}

function scopeField(scopeKind: ScopeKind): 'allowedMcpsJson' | 'allowedSkillsJson' {
  return scopeKind === 'mcp' ? 'allowedMcpsJson' : 'allowedSkillsJson';
}

/** Parses `profile=<id> scopeKind=<mcp|skill> deadName=<name>` (org_audit_service's detectPruneGaps evidence format). */
function parsePruneEvidence(
  evidence: string,
): { profileId: string; scopeKind: ScopeKind; name: string } | null {
  const match = /^profile=(\S+) scopeKind=(mcp|skill) deadName=(\S+)$/.exec(evidence);
  if (!match) return null;
  const [, profileId, scopeKind, name] = match;
  return { profileId, scopeKind: scopeKind as ScopeKind, name };
}

/**
 * Parses `profile=<id> neverInvokedTool=<name> sessionCount=<n>` (org_audit_service's
 * detectTightenGaps evidence format), with an optional trailing
 * ` observationDays=<n>` (#857 data-sufficiency guard) — kept optional so a
 * gap built by an older evidence format (or a test fixture) still parses.
 */
function parseTightenEvidence(evidence: string): { profileId: string; name: string } | null {
  const match = /^profile=(\S+) neverInvokedTool=(\S+) sessionCount=(\d+)(?: observationDays=\d+)?$/.exec(evidence);
  if (!match) return null;
  const [, profileId, name] = match;
  return { profileId, name };
}

function buildProposalInput(params: {
  kind: 'prune-scope' | 'tighten-scope';
  auditRunId: string;
  profileId: string;
  scopeKind: ScopeKind;
  name: string;
  gapId: string;
  evidence: string;
  userAuthored: boolean;
}): AgentOrgProposalInput {
  const { kind, auditRunId, profileId, scopeKind, name, gapId, evidence, userAuthored } = params;
  const change: AgentConfigScopeChangePayload = {
    agentConfigId: profileId,
    field: scopeField(scopeKind),
    remove: [name],
  };
  const changeJson = JSON.stringify(change);

  // Re-check via the real predicate so this row's stated risk can never
  // silently drift from what org_proposal_apply.applyProposal would itself
  // decide — EXCEPT the user-authored escalation, which is a hard override
  // this generator imposes independent of the payload shape (the predicate
  // has no way to know a name is user-authored; it only inspects change
  // shape/kind).
  const computedRisk = classifyProposalRisk({ kind, changeJson });
  const risk = userAuthored ? 'high' : computedRisk;

  const verb = kind === 'prune-scope' ? 'Prune dead' : 'Tighten unused';
  const title = `${verb} ${scopeKind} scope '${name}' from ${profileId}`;
  const rationale = userAuthored
    ? `${evidence} — SKIPPED auto-apply: '${name}' is a user-authored scope entry (#785 overlay); routed to human gate instead of silently pruning.`
    : `${evidence} (org self-optimizer scope-hygiene audit)`;

  return {
    kind,
    risk,
    title,
    rationale,
    signalRef: gapId,
    targetRef: `agent_config:${profileId}:${scopeKind}:${name}`,
    changeJson,
    dedupKey: `${kind}:${profileId}:${scopeKind}:${name}`,
    auditRunId,
  };
}

function buildConsolidateSkillProposalInput(
  auditRunId: string,
  candidate: SkillOverlapCandidate,
): AgentOrgProposalInput {
  // Order-independent dedup key: sort the pair so (a,b) and (b,a) collide.
  const [firstId, secondId] = [candidate.skillIdA, candidate.skillIdB].sort();

  const change = {
    skillIdA: candidate.skillIdA,
    skillIdB: candidate.skillIdB,
    titleA: candidate.titleA,
    titleB: candidate.titleB,
    similarity: candidate.similarity,
  };
  const changeJson = JSON.stringify(change);
  const risk = classifyProposalRisk({ kind: 'consolidate-skill', changeJson });

  return {
    kind: 'consolidate-skill',
    risk,
    title: `Consolidate overlapping skills '${candidate.titleA}' and '${candidate.titleB}'`,
    rationale: `skillIdA=${candidate.skillIdA} skillIdB=${candidate.skillIdB} similarity=${candidate.similarity.toFixed(2)} (title overlap above audit threshold)`,
    signalRef: null,
    targetRef: `skill:${candidate.skillIdA}:skill:${candidate.skillIdB}`,
    changeJson,
    dedupKey: `consolidate-skill:${firstId}:${secondId}`,
    auditRunId,
  };
}

/**
 * Generate scope-hygiene proposals (`prune-scope`, `tighten-scope`,
 * `consolidate-skill`) from an already-built `OrgAuditSnapshot` and write
 * them via the injected (or real) `AgentOrgProposalsRepository`. NEVER
 * throws — a malformed individual gap is logged and skipped, not fatal.
 */
export async function generateScopeHygieneProposals(
  snapshot: OrgAuditSnapshot,
  deps: ScopeHygieneDeps = {},
): Promise<void> {
  const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
  const isUserAuthoredScopeEntry = deps.isUserAuthoredScopeEntry ?? defaultIsUserAuthoredScopeEntry;
  const isMcpRequiredByProfile = deps.isMcpRequiredByProfile ?? defaultIsMcpRequiredByProfile;

  for (const gap of snapshot.gaps) {
    try {
      if (gap.kind === 'prune-scope') {
        await handlePruneGap(gap, snapshot, proposalsRepo, isUserAuthoredScopeEntry);
      } else if (gap.kind === 'tighten-scope') {
        await handleTightenGap(gap, snapshot, proposalsRepo, isMcpRequiredByProfile);
      }
      // webhook-wiring gaps are out of scope for this generator (org-optimizer-09).
    } catch (err) {
      logger.warn(
        `[scope-hygiene-generator] FAILED processing gap '${gap.gapId}' (kind=${gap.kind}, non-fatal): ${String(err)}`,
      );
    }
  }

  for (const candidate of snapshot.skillOverlapCandidates) {
    try {
      await handleSkillOverlapCandidate(candidate, snapshot, proposalsRepo);
    } catch (err) {
      logger.warn(
        `[scope-hygiene-generator] FAILED processing skill overlap candidate '${candidate.skillIdA}'/'${candidate.skillIdB}' (non-fatal): ${String(err)}`,
      );
    }
  }
}

async function handlePruneGap(
  gap: OrgAuditGap,
  snapshot: OrgAuditSnapshot,
  proposalsRepo: NonNullable<ScopeHygieneDeps['proposalsRepo']>,
  isUserAuthoredScopeEntry: NonNullable<ScopeHygieneDeps['isUserAuthoredScopeEntry']>,
): Promise<void> {
  const parsed = parsePruneEvidence(gap.evidence);
  if (!parsed) {
    logger.warn(`[scope-hygiene-generator] unparseable prune-scope evidence for gap '${gap.gapId}': '${gap.evidence}'`);
    return;
  }

  const userAuthored = isUserAuthoredScopeEntry(parsed.profileId, parsed.scopeKind, parsed.name);
  const input = buildProposalInput({
    kind: 'prune-scope',
    auditRunId: snapshot.auditRunId,
    profileId: parsed.profileId,
    scopeKind: parsed.scopeKind,
    name: parsed.name,
    gapId: gap.gapId,
    evidence: gap.evidence,
    userAuthored,
  });

  await createIfNotDuplicate(proposalsRepo, input);
}

async function handleTightenGap(
  gap: OrgAuditGap,
  snapshot: OrgAuditSnapshot,
  proposalsRepo: NonNullable<ScopeHygieneDeps['proposalsRepo']>,
  isMcpRequiredByProfile: NonNullable<ScopeHygieneDeps['isMcpRequiredByProfile']>,
): Promise<void> {
  const parsed = parseTightenEvidence(gap.evidence);
  if (!parsed) {
    logger.warn(`[scope-hygiene-generator] unparseable tighten-scope evidence for gap '${gap.gapId}': '${gap.evidence}'`);
    return;
  }

  if (isMcpRequiredByProfile(parsed.profileId, parsed.name)) {
    logger.info(
      `[scope-hygiene-generator] skipped tighten-scope for '${parsed.name}' on '${parsed.profileId}' because the profile prompt/skills require it`,
    );
    return;
  }

  // detectTightenGaps (org_audit_service.ts) only ever inspects
  // profile.allowedMcps, so the scope kind for a tighten-scope gap is always 'mcp'.
  const input = buildProposalInput({
    kind: 'tighten-scope',
    auditRunId: snapshot.auditRunId,
    profileId: parsed.profileId,
    scopeKind: 'mcp',
    name: parsed.name,
    gapId: gap.gapId,
    evidence: gap.evidence,
    userAuthored: false,
  });

  await createIfNotDuplicate(proposalsRepo, input);
}

async function handleSkillOverlapCandidate(
  candidate: SkillOverlapCandidate,
  snapshot: OrgAuditSnapshot,
  proposalsRepo: NonNullable<ScopeHygieneDeps['proposalsRepo']>,
): Promise<void> {
  const input = buildConsolidateSkillProposalInput(snapshot.auditRunId, candidate);
  await createIfNotDuplicate(proposalsRepo, input);
}

async function createIfNotDuplicate(
  proposalsRepo: NonNullable<ScopeHygieneDeps['proposalsRepo']>,
  input: AgentOrgProposalInput,
): Promise<void> {
  if (input.dedupKey && (await proposalsRepo.existsByDedupKeyAsync(input.dedupKey))) {
    logger.info(`[scope-hygiene-generator] skipped duplicate proposal for dedup_key='${input.dedupKey}'`);
    return;
  }
  await proposalsRepo.createAsync(input);
}
