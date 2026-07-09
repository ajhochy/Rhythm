/**
 * new_agent_generator.ts — issue #824 (org-optimizer-08).
 *
 * Generates `create-agent` proposals (HIGH risk, human-gated) for detected
 * coverage-gap signals: a recurring denied-tool pattern with no existing
 * profile that fits, or a recurring task/session cluster no profile covers.
 * Per docs/ai/decisions/2026-07-02-autonomy-and-vault-intent.md decision #4
 * ("FULL AUTONOMY WITH ROLLBACK... human sign-off ONLY for new-agent creation
 * (#824)"), this is one of exactly two proposal kinds that must NEVER be
 * reachable from the auto-apply lane — see `classifyProposalRisk('create-agent')`
 * in org_risk_classifier.ts, which hard-codes it into HIGH_RISK_KINDS.
 *
 * This module owns BOTH halves of the #824 acceptance criteria:
 *
 *   1. EMISSION (`generateCreateAgentProposal`) — given a coverage-gap
 *      signal + candidate agent shape, validates every proposed MCP/skill
 *      name against the LIVE engine id set (via `mcp_name_alignment`) BEFORE
 *      creating the `agent_org_proposals` row. A gap whose proposed scopes
 *      cannot resolve is never emitted — it is silently dropped (returned as
 *      `{ emitted: false }`) rather than surfaced to a human reviewer as if
 *      it were a valid, actionable proposal.
 *
 *   2. GATED APPLY (`registerNewAgentApplier`) — registers a validator +
 *      applier for `kind: 'create-agent'` into the pluggable seam exposed by
 *      `org_proposal_apply_service.ts` (the #826 review-queue's approve
 *      path). Applying creates the `agent_configs` row with `is_manager: 0`
 *      (manager status is user-controlled — see
 *      docs/ai/decisions/2026-06-25-decouple-is_manager-from-importer.md) and
 *      writes a `.mcp-roles/<slug>.mcp.json` role file, reusing the same
 *      `{ mcpServers: { ... } }` shape `agent_sessions_controller.ts`'s
 *      `resolveMcpRole()` reads. Both the validator and the applier
 *      RE-CHECK names against the live engine set at apply time — never
 *      trusting the (possibly stale, since-approved) proposal-time check —
 *      so apply is refused if a name has died between proposal and approval.
 *
 * This file intentionally does NOT edit `org_proposal_apply_service.ts`,
 * `org_audit_service.ts`, or `org_risk_classifier.ts` — it only calls their
 * exported registration seams / pure functions, so sibling gated generators
 * (#825/#828/#829) following the same pattern land without merge conflicts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { AgentOrgProposal } from '../../models/agent_org_proposal';
import {
  AgentOrgProposalsRepository,
} from '../../repositories/agent_org_proposals_repository';
import {
  AgentConfigsRepository,
  deriveAgentConfigIdFromLabel,
} from '../../repositories/agent_configs_repository';
import { alignMcpName } from '../mcp_name_alignment';
import { extractReferencedSkillNames } from '../agent_skill_wiring';
import { opencodeClient } from '../opencode_engine';
import { logger } from '../../utils/logger';
import type {
  ProposalApplier,
  ProposalValidationResult,
  ProposalValidator,
} from '../org_proposal_apply_service';

// ── Role-file directory resolution (mirrors agent_sessions_controller.ts) ──

/**
 * `.mcp-roles/` lives at the repo root. This file lives at:
 *   apps/api_server/src/services/generators/  (dev source)
 *   apps/api_server/dist/services/generators/  (compiled output, same depth)
 *
 * From src/services/generators/ → ../../../../../ = Rhythm/ (repo root).
 * Override with MCP_ROLES_DIR env var for tests and bundled deployments,
 * exactly like agent_sessions_controller.ts's resolveMcpRole().
 */
function mcpRolesDir(): string {
  return (
    process.env.MCP_ROLES_DIR ??
    path.join(__dirname, '..', '..', '..', '..', '..', '.mcp-roles')
  );
}

const MCP_ROLE_SLUG_RE = /^[a-z0-9-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function roleFilePath(slug: string): string {
  return path.join(mcpRolesDir(), `${slug}.mcp.json`);
}

// ── Public shapes ────────────────────────────────────────────────────────

/** A coverage-gap signal this generator turns into a create-agent proposal. */
export interface CoverageGapSignal {
  /** Stable gap id (e.g. from org_audit_service's stableGapId convention, or caller-derived). */
  gapId: string;
  /** Human-readable evidence string — becomes the proposal's signal_ref. */
  evidence: string;
  /** Proposed new agent_configs.id (slug). Must match [a-z0-9-]+. */
  proposedId: string;
  proposedLabel: string;
  proposedSystemPrompt: string;
  proposedAllowedMcps: string[];
  proposedAllowedSkills: string[];
  /** Optional — delegation targets the new agent should be allowed to hand off to. */
  proposedAllowedDelegates?: string[];
}

export interface GenerateDeps {
  proposalsRepo: AgentOrgProposalsRepository;
  /** Live MCP server ids (e.g. from opencodeClient.listMcp()'s keys). */
  liveMcpNames: Set<string>;
  /** Live skill names (e.g. from opencodeClient.listSkills()'s names). */
  liveSkillNames: Set<string>;
  auditRunId?: string | null;
}

export interface GenerateResult {
  emitted: boolean;
  /** Present when emitted=true. */
  proposal?: AgentOrgProposal;
  /** Present when emitted=false — why the gap was dropped. */
  reason?: string;
}

/** Shape persisted in `agent_org_proposals.change_json` for kind='create-agent'. */
interface CreateAgentChange {
  agentSlug: string;
  label: string;
  systemPrompt: string;
  allowedMcpsJson: string;
  allowedSkillsJson: string;
  allowedDelegatesJson?: string;
}

/**
 * Validate a list of candidate names against a live set, returning the set of
 * names that FAILED to resolve (empty = all resolved). Uses `alignMcpName`
 * for drift-tolerant resolution (both MCP and skill names go through the
 * same canonicalization rule — skills do not carry the "-mcp" suffix
 * ambiguity, so the rule degrades gracefully to exact-match for them).
 */
function unresolvedNames(candidates: string[], liveNames: Set<string>): string[] {
  const unresolved: string[] = [];
  for (const name of candidates) {
    const { matched } = alignMcpName(name, liveNames);
    if (!matched) unresolved.push(name);
  }
  return unresolved;
}

/**
 * #958 canonical-wiring guard. Every workflow skill the proposed system-prompt
 * body tells the model to load ("`name` skill") MUST be in the proposed
 * `allowedSkills`, or the created agent silently runs without it. Returns the
 * offending references (empty = correctly wired). Liveness is NOT re-checked
 * here: an in-allowlist name is already validated against the live set by the
 * caller's `unresolvedNames(skillNames, …)` check, so "in allowlist" implies
 * "enabled" — an unwired reference is exactly one absent from the allowlist.
 */
function unwiredSkillReferences(systemPrompt: string, allowedSkills: string[]): string[] {
  const allow = new Set(allowedSkills);
  return extractReferencedSkillNames(systemPrompt).filter((name) => !allow.has(name));
}

/**
 * EMISSION — issue-824-c1/c2. Given a coverage-gap signal, validate every
 * proposed MCP/skill name against the live engine id set BEFORE creating the
 * proposal row. A name that cannot resolve means the whole proposal is
 * dropped (not emitted, not emitted-flagged-invalid) — a human reviewer must
 * never see a create-agent proposal whose scopes are already known-dead.
 *
 * Idempotent via `dedupKey` (kind + gapId), matching the #817 repository
 * convention used by every other generator.
 */
export async function generateCreateAgentProposal(
  signal: CoverageGapSignal,
  deps: GenerateDeps,
): Promise<GenerateResult> {
  if (!MCP_ROLE_SLUG_RE.test(signal.proposedId)) {
    return {
      emitted: false,
      reason: `proposedId "${signal.proposedId}" must match [a-z0-9-]+`,
    };
  }

  const badMcps = unresolvedNames(signal.proposedAllowedMcps, deps.liveMcpNames);
  if (badMcps.length > 0) {
    logger.warn(
      `[NewAgentGenerator] gap ${signal.gapId}: dropping proposal — unresolved MCP name(s): ${badMcps.join(', ')}`,
    );
    return {
      emitted: false,
      reason: `unresolved MCP name(s): ${badMcps.join(', ')}`,
    };
  }

  const badSkills = unresolvedNames(signal.proposedAllowedSkills, deps.liveSkillNames);
  if (badSkills.length > 0) {
    logger.warn(
      `[NewAgentGenerator] gap ${signal.gapId}: dropping proposal — unresolved skill name(s): ${badSkills.join(', ')}`,
    );
    return {
      emitted: false,
      reason: `unresolved skill name(s): ${badSkills.join(', ')}`,
    };
  }

  // #958 — refuse a proposal whose body references a skill it is not scoped
  // for (the dangling-reference class this issue fixes at the source).
  const unwiredSkills = unwiredSkillReferences(signal.proposedSystemPrompt, signal.proposedAllowedSkills);
  if (unwiredSkills.length > 0) {
    logger.warn(
      `[NewAgentGenerator] gap ${signal.gapId}: dropping proposal — body references skill(s) not in allowedSkills: ${unwiredSkills.join(', ')}`,
    );
    return {
      emitted: false,
      reason: `body references skill(s) not in allowedSkills: ${unwiredSkills.join(', ')}`,
    };
  }

  const change: CreateAgentChange = {
    agentSlug: signal.proposedId,
    label: signal.proposedLabel,
    systemPrompt: signal.proposedSystemPrompt,
    allowedMcpsJson: JSON.stringify(signal.proposedAllowedMcps),
    allowedSkillsJson: JSON.stringify(signal.proposedAllowedSkills),
  };
  if (signal.proposedAllowedDelegates && signal.proposedAllowedDelegates.length > 0) {
    change.allowedDelegatesJson = JSON.stringify(signal.proposedAllowedDelegates);
  }

  const proposal = await deps.proposalsRepo.createAsync({
    auditRunId: deps.auditRunId ?? null,
    kind: 'create-agent',
    risk: 'high',
    title: `Create new agent: ${signal.proposedLabel}`,
    rationale: `Coverage gap detected: ${signal.evidence}`,
    signalRef: signal.evidence,
    targetRef: `agent_config:${signal.proposedId}`,
    changeJson: JSON.stringify(change),
    dedupKey: `create-agent:${signal.gapId}`,
  });

  return { emitted: true, proposal };
}

// ── GATED APPLY — issue-824-c3/c4 ──────────────────────────────────────────

function parseCreateAgentChange(proposal: AgentOrgProposal): CreateAgentChange | null {
  if (!proposal.changeJson) return null;
  try {
    const parsed = JSON.parse(proposal.changeJson) as Partial<CreateAgentChange>;
    if (
      typeof parsed.agentSlug === 'string' &&
      parsed.agentSlug.trim() !== '' &&
      typeof parsed.label === 'string' &&
      typeof parsed.systemPrompt === 'string' &&
      typeof parsed.allowedMcpsJson === 'string' &&
      typeof parsed.allowedSkillsJson === 'string'
    ) {
      return parsed as CreateAgentChange;
    }
    return null;
  } catch {
    return null;
  }
}

function parseJsonStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Read the live MCP/skill id sets from the running opencode engine. Fails
 * CLOSED: when the engine is not ready (or a call throws), returns empty
 * sets — which `unresolvedNames` will treat as "every name unresolved",
 * refusing the apply rather than writing a role file we cannot verify
 * against a live set (agent-creation is HIGH risk; unlike the fail-open
 * scope-derivation paths elsewhere, this apply step must not proceed blind).
 */
async function readLiveNameSets(): Promise<{ liveMcpNames: Set<string>; liveSkillNames: Set<string> }> {
  if (!opencodeClient.isReady) {
    return { liveMcpNames: new Set(), liveSkillNames: new Set() };
  }
  try {
    const [mcpStatus, skills] = await Promise.all([
      opencodeClient.listMcp(),
      opencodeClient.listSkills(),
    ]);
    return {
      liveMcpNames: new Set(Object.keys(mcpStatus)),
      liveSkillNames: new Set(skills.map((s) => s.name)),
    };
  } catch {
    return { liveMcpNames: new Set(), liveSkillNames: new Set() };
  }
}

/**
 * Build the `.mcp-roles/<slug>.mcp.json` role file content from the
 * resolved (live-validated) MCP names. Shape matches what
 * `agent_sessions_controller.ts`'s `resolveMcpRole()` requires:
 * `{ mcpServers: Record<name, { allowedTools?: string[] }> }`. No
 * `allowedTools` restriction is written per-server (undefined = full tool
 * surface for that server) — narrowing to specific tools is a follow-up
 * refinement a human can make in the designer after creation, matching how
 * hand-authored role files start broad and get tightened over time.
 */
function buildRoleFileContent(slug: string, resolvedMcps: string[]): Record<string, unknown> {
  const mcpServers: Record<string, { inherit: true }> = {};
  for (const name of resolvedMcps) {
    mcpServers[name] = { inherit: true };
  }
  return {
    $schema: 'https://rhythm.vcrcapps.com/schemas/mcp-role.json',
    role: slug,
    description: `Generated by the org self-optimizer (issue #824) — human-approved create-agent proposal.`,
    mcpServers,
  };
}

/**
 * Re-validation run at apply time (never trusted from proposal time). Fails
 * closed on: malformed change_json, an agentSlug that already exists, or any
 * proposed MCP/skill name no longer resolving against the CURRENT live set.
 */
async function validateCreateAgentChange(
  proposal: AgentOrgProposal,
): Promise<ProposalValidationResult> {
  const change = parseCreateAgentChange(proposal);
  if (!change) {
    return { valid: false, reason: 'change_json is missing required create-agent fields' };
  }

  const configsRepo = new AgentConfigsRepository();
  if (configsRepo.getById(change.agentSlug)) {
    return {
      valid: false,
      reason: `agent_configs row "${change.agentSlug}" already exists`,
    };
  }

  const { liveMcpNames, liveSkillNames } = await readLiveNameSets();

  const mcpNames = parseJsonStringArray(change.allowedMcpsJson);
  const badMcps = unresolvedNames(mcpNames, liveMcpNames);
  if (badMcps.length > 0) {
    return {
      valid: false,
      reason: `MCP name(s) no longer live at apply time: ${badMcps.join(', ')}`,
    };
  }

  const skillNames = parseJsonStringArray(change.allowedSkillsJson);
  const badSkills = unresolvedNames(skillNames, liveSkillNames);
  if (badSkills.length > 0) {
    return {
      valid: false,
      reason: `Skill name(s) no longer live at apply time: ${badSkills.join(', ')}`,
    };
  }

  // #958 — the body must not reference a skill outside the allowlist.
  const unwiredSkills = unwiredSkillReferences(change.systemPrompt, skillNames);
  if (unwiredSkills.length > 0) {
    return {
      valid: false,
      reason: `body references skill(s) not in allowedSkills: ${unwiredSkills.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * The gated apply step — runs ONLY when invoked via the review queue's
 * approve path (`org_proposal_apply_service.applyProposal`), which itself
 * always re-runs `validateProposalChange` immediately before calling this.
 * Creates the `agent_configs` row with `is_manager: 0` and writes the
 * `.mcp-roles/<slug>.mcp.json` role file. Throws if re-validation (run again
 * here, defense-in-depth) fails — `org_proposal_apply_service.applyProposal`
 * already throws on an invalid change, but this applier is also directly
 * unit-testable/callable, so it must not silently "succeed" on a bad payload
 * if invoked outside that wrapper.
 */
async function applyCreateAgentChange(proposal: AgentOrgProposal): Promise<{ measurable: boolean }> {
  const validation = await validateCreateAgentChange(proposal);
  if (!validation.valid) {
    throw new Error(validation.reason ?? `create-agent apply refused for proposal ${proposal.id}`);
  }
  const change = parseCreateAgentChange(proposal)!;
  const mcpNames = parseJsonStringArray(change.allowedMcpsJson);
  const skillNames = parseJsonStringArray(change.allowedSkillsJson);
  const delegateNames = change.allowedDelegatesJson
    ? parseJsonStringArray(change.allowedDelegatesJson)
    : undefined;

  const configsRepo = new AgentConfigsRepository();
  const agentId = UUID_RE.test(change.agentSlug)
    ? deriveAgentConfigIdFromLabel(
        change.label,
        (candidate) => configsRepo.getById(candidate) !== null,
      )
    : change.agentSlug;
  configsRepo.insert({
    id: agentId,
    label: change.label,
    icon: 'sparkles',
    isAgent: true,
    isManager: false, // #824 hard invariant — manager status is user-controlled only.
    systemPrompt: change.systemPrompt,
    allowedMcpsJson: JSON.stringify(mcpNames),
    allowedSkillsJson: JSON.stringify(skillNames),
    allowedDelegatesJson: delegateNames ? JSON.stringify(delegateNames) : null,
    sessionSelectable: true,
  });

  const dir = mcpRolesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const rolePath = roleFilePath(agentId);
  const roleContent = buildRoleFileContent(agentId, mcpNames);
  writeFileSync(rolePath, `${JSON.stringify(roleContent, null, 2)}\n`, 'utf8');

  logger.info(
    `[NewAgentGenerator] applied create-agent proposal ${proposal.id}: created agent_configs "${agentId}" + role file`,
  );

  return { measurable: false };
}

// ── Registration seam — #830 wiring round calls this ────────────────────

export interface ApplyServiceRegistry {
  registerProposalApplier: (kind: string, applier: ProposalApplier) => void;
  registerProposalValidator: (kind: string, validator: ProposalValidator) => void;
}

/**
 * Wire this generator's validator + applier into the shared
 * `org_proposal_apply_service.ts` seam for `kind: 'create-agent'`, WITHOUT
 * this file (or the #830 wiring round) needing to edit that module's control
 * flow. Call once at server startup (mirrors how other pluggable subsystems
 * self-register). Idempotent — re-registering simply replaces the prior
 * registration for this kind (last call wins), matching
 * `registerProposalApplier`'s own semantics.
 */
export function registerNewAgentApplier(registry: ApplyServiceRegistry): void {
  registry.registerProposalValidator('create-agent', validateCreateAgentChange);
  registry.registerProposalApplier('create-agent', applyCreateAgentChange);
}

// Exported for direct unit testing of the re-validation predicate in isolation.
export { validateCreateAgentChange, applyCreateAgentChange };
