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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../utils/logger';
import { classifyProposalRisk } from '../org_risk_classifier';
import { AgentOrgProposalsRepository, type OrgProposalAttempt } from '../../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository, type AgentConfig } from '../../repositories/agent_configs_repository';
import { AgentScheduledTasksRepository } from '../../repositories/agent_scheduled_tasks_repository';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { managedSkillsRoot } from '../rhythm_managed_skills';
import {
  CONFIG_PATCH_FIELDS,
  CORE_PERMISSION_ACTIONS,
  CORE_PERMISSION_NAMES,
  DIAGNOSIS_CONFIDENCE_MAPPING_VERSION,
  SCOPE_PATCH_FIELDS,
  TASK_PATCH_FIELDS,
  mapDiagnosisConfidence,
  type ConfigPatch,
  type ScopePatch,
  type TaskPatch,
  type DiagnosisResult,
} from '../org_diagnosis_types';
import type { AgentOrgProposal, AgentOrgProposalInput } from '../../models/agent_org_proposal';
import type {
  OrgAuditSnapshot,
  ProfileScopeSnapshot,
  DelegationEdge,
  DeniedToolAggregate,
} from '../org_audit_service';
import type { WorkflowFailureSignal, WorkflowFailureCategory } from '../workflow_failure_signal_extractor';
import { resolveKnownMcpServerName } from '../mcp_scope_name';
import { resolveProfileMcpScope, type ResolvedProfileMcpScope } from '../agent_profile_scope';
import { isToolAllowed } from '../mcp_dispatch_guard';
import {
  coreCapabilityName,
  resolveCoreCapabilitySurface,
  type CoreCapabilitySurface,
} from '../profile_capability_surface';

export interface WorkflowSignalGeneratorDeps {
  /** Injectable proposals repo (defaults to a fresh AgentOrgProposalsRepository). */
  proposalsRepo?: Pick<AgentOrgProposalsRepository, 'createAsync' | 'existsByDedupKeyAsync'>;
  /** Injectable configs repo — read-only, used to confirm a scope gap is real. */
  configsRepo?: AgentConfigsRepository;
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
  'post-apply-regression': 'repair a post-apply guardrail regression',
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
  auditRunId: string,
  configsRepo: AgentConfigsRepository = new AgentConfigsRepository(),
): Promise<AgentOrgProposal | null> {
  const toolName = parseDeniedToolName(signal.evidence);
  if (!toolName || !signal.agentConfigId) {
    logger.warn(`[workflow-signal-generator] unparseable missing-scope evidence: '${signal.evidence}'`);
    return null;
  }
  // A core/provider-EXECUTED tool (bash, write, image_generation, …) is not an
  // MCP server and can never be granted by an MCP allowlist entry, yet
  // `isPlausibleMcpServerName` happily accepts its bare name. Route it nowhere
  // rather than proposing e.g. an 'image_generation' MCP server that cannot exist.
  const coreName = coreCapabilityName(toolName);
  if (coreName) {
    logger.info(
      `[workflow-signal-generator] denied tool '${toolName}' is the core/provider-executed capability ` +
        `'${coreName}', not an MCP server — no broaden-scope proposal (it is granted via corePermissionsJson).`,
    );
    return null;
  }
  const { serverName } = await resolveKnownMcpServerName(toolName);
  if (!serverName) {
    logger.warn(`[workflow-signal-generator] denied tool '${toolName}' does not map to a known MCP server`);
    return null;
  }

  // "Denied" and "not granted" are different conditions. Confirm the server is
  // genuinely absent from the profile's RESOLVED scope before asserting a gap —
  // a denial on an in-scope tool has some other cause, and filing a grant for a
  // grant that already exists is both false and (at apply time) a no-op write.
  const config = configsRepo.getById(signal.agentConfigId);
  if (config) {
    const scope = resolveProfileMcpScope(config.allowedMcpsJson ?? null, config.id, config.label);
    if (scope.shape === 'unrestricted' || scope.servers.includes(serverName)) {
      logger.warn(
        `[workflow-signal-generator] '${serverName}' is ALREADY in ${signal.agentConfigId}'s resolved MCP ` +
          `scope (shape=${scope.shape}) — not filing a broaden-scope proposal for denied tool '${toolName}'.`,
      );
      return null;
    }
  }

  const changeJson = JSON.stringify({
    agentConfigId: signal.agentConfigId,
    field: 'allowedMcpsJson',
    add: [serverName],
  });
  const risk = classifyProposalRisk({ kind: 'broaden-scope', changeJson });

  return createIfNotDuplicate(proposalsRepo, {
    auditRunId,
    kind: 'broaden-scope',
    risk,
    title: `Grant missing scope '${serverName}' to ${signal.agentConfigId}`,
    rationale: `${signal.evidence} (workflow signal: repeated dispatch-guard denial)`,
    signalRef: `workflow:missing-scope:${signal.agentConfigId}:${serverName}`,
    targetRef: `agent_config:${signal.agentConfigId}:mcp:${serverName}`,
    changeJson,
    dedupKey: `broaden-scope:${signal.agentConfigId}:mcp:${serverName}`,
  });
}

async function proposeCreateRecipeForCategory(
  signal: WorkflowFailureSignal,
  proposalsRepo: NonNullable<WorkflowSignalGeneratorDeps['proposalsRepo']>,
  auditRunId: string,
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
    auditRunId,
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
  const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();
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
          ? await proposeMissingScope(signal, proposalsRepo, snapshot.auditRunId, configsRepo)
          : await proposeCreateRecipeForCategory(signal, proposalsRepo, snapshot.auditRunId);

      if (proposal) created.push(proposal);
    } catch (err) {
      logger.warn(
        `[workflow-signal-generator] FAILED processing signal (category=${signal.category}, non-fatal): ${String(err)}`,
      );
    }
  }

  return { created };
}

// ═══════════════════════════════════════════════════════════════════════════
// #971 — LLM-driven diagnosis lane (ADDITIVE to the deterministic lane above).
//
// The deterministic `generateWorkflowSignalProposals` above maps each raw
// failure signal onto an EXISTING kind (broaden-scope / create-recipe) with no
// LLM. This lane is the reconstruction of the #937-era diagnosis brain that
// #956 removed: it groups the ambiguous BEHAVIORAL failure signals by
// (profile, error signature), asks the LLM for a root-cause + concrete fix per
// distinct failure mode, and emits the richer kinds the approval loop measures
// and reverts: `refine-config`, `refine-scope`, `workflow-prompt-fix`,
// `refine-task`.
//
// Both lanes run every optimizer run and DO NOT conflict — their dedup-key
// families are disjoint (`broaden-scope:*` / `create-recipe:*` vs
// `workflow-fix:*`), so the same signal can legitimately surface both a
// deterministic proposal and a diagnosed one for a human to choose between.
//
// `missing-scope` and `delegate-result` signals are intentionally NOT
// diagnosed here — a denied tool IS its own precise fix (the deterministic
// broaden-scope lane) and delegation gaps are the delegation_generator's job.
// The LLM only earns its cost on the ambiguous behavioral categories below,
// where the root cause (skill vs config vs scope) is genuinely unclear.
//
// Operational envelope is identical to the deterministic lane: NEVER throws;
// a diagnosis failure logs and skips, never crashing the fire-and-forget run.
// ═══════════════════════════════════════════════════════════════════════════

/** Cap on LLM diagnosis calls per optimizer run — prevents runaway costs. */
const DEFAULT_MAX_DIAGNOSE_CALLS = 10;

/**
 * #971-5 — max re-diagnosis attempts for one failure mode before it is PARKED
 * (logged, never re-proposed). Attempts run a1..aN; once N reverts have all
 * failed the failure mode stops looping forever. Constant, not configurable.
 */
const MAX_DIAGNOSIS_ATTEMPTS = 3;

/**
 * Behavioral failure categories worth an LLM root-cause diagnosis. Excludes
 * `missing-scope` (deterministic broaden-scope already yields the exact fix)
 * and `delegate-result` (owned by the delegation lane). Only signals with an
 * attributable `agentConfigId` are diagnosable — there must be a real profile
 * to inspect and patch.
 */
const DIAGNOSABLE_CATEGORIES: ReadonlySet<WorkflowFailureCategory> = new Set([
  'retry-loop',
  'hallucinated-claim',
  'unverified-claim',
  'tool-unavailable-attempted',
  'repeated-correction',
  'stale-redo',
  'external-abort',
  'post-apply-regression',
]);

/**
 * Injectable diagnosis function: given the full context for a profile and its
 * failure signals, return a structured diagnosis + fix. Tests inject a
 * deterministic one; production uses {@link defaultDiagnose}.
 */
export type DiagnoseCall = (context: DiagnosisContext) => Promise<DiagnosisResult | null>;

/** Everything the LLM needs to diagnose a profile's failures. */
export interface DiagnosisContext {
  /** The agent_configs.id of the failing profile (mega's `affectedSkill`). */
  affectedSkill: string;
  signals: WorkflowFailureSignal[];
  profile: ProfileScopeSnapshot | null;
  agentConfig: AgentConfig | null;
  /**
   * The profile's MCP scope resolved through the SHARED resolver (both stored
   * shapes + the unrestricted case), so the prompt states what is granted rather
   * than an ambiguous `[]`.
   */
  mcpScope: ResolvedProfileMcpScope;
  /**
   * The profile's NON-MCP grant surface: core permissions plus provider-executed
   * capabilities (image_generation). Absence from the MCP allowlist says nothing
   * about these.
   */
  coreCapabilities: CoreCapabilitySurface;
  skillBody: string | null;
  deniedTools: DeniedToolAggregate[];
  delegationOutbound: DelegationEdge[];
  delegationInbound: DelegationEdge[];
  /**
   * #971-5 — prior reverted attempts for this exact failure mode, so the LLM
   * is told what was already tried (and why it reverted) and proposes
   * something DIFFERENT. Empty on the first attempt.
   */
  priorAttempts?: OrgProposalAttempt[];
}

/**
 * Validate a (fully untrusted) `configPatch` and re-resolve its
 * `agentConfigId` from the failing signal's own profile via
 * `AgentConfigsRepository` — an LLM-emitted row id is NEVER trusted directly.
 * Returns undefined (drop the patch, prose-only survives) on any malformed
 * shape or if the profile no longer exists.
 */
function resolveConfigPatch(
  raw: unknown,
  agentConfigId: string,
  configsRepo: AgentConfigsRepository,
): ConfigPatch | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.field !== 'string' || !(CONFIG_PATCH_FIELDS as readonly string[]).includes(r.field)) return undefined;
  if (typeof r.value !== 'string') return undefined;
  if (!configsRepo.getById(agentConfigId)) return undefined;
  return { agentConfigId, field: r.field as ConfigPatch['field'], value: r.value };
}

/** Same contract as {@link resolveConfigPatch}, for `scopePatch`. */
function resolveScopePatch(
  raw: unknown,
  agentConfigId: string,
  configsRepo: AgentConfigsRepository,
): ScopePatch | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.field !== 'string' || !(SCOPE_PATCH_FIELDS as readonly string[]).includes(r.field)) return undefined;
  if (!configsRepo.getById(agentConfigId)) return undefined;
  if (r.field === 'corePermissionsJson') {
    if (r.add !== undefined || r.remove !== undefined) return undefined;
    const set = r.set && typeof r.set === 'object' && !Array.isArray(r.set) ? r.set as Record<string, unknown> : undefined;
    const unset = Array.isArray(r.unset) && r.unset.every((x) => typeof x === 'string' && x.trim()) ? r.unset as string[] : undefined;
    const coreNames = new Set<string>(CORE_PERMISSION_NAMES);
    const actions = new Set<string>(CORE_PERMISSION_ACTIONS);
    const validValue = (value: unknown) => typeof value === 'string'
      ? actions.has(value)
      : !!value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value as Record<string, unknown>).every(
        ([pattern, action]) => pattern.trim() && typeof action === 'string' && actions.has(action),
      );
    if ((!set || Object.keys(set).length === 0) && (!unset || unset.length === 0)) return undefined;
    if ((set && Object.entries(set).some(([name, value]) => !coreNames.has(name) || !validValue(value))) ||
      (unset && unset.some((name) => !coreNames.has(name)))) return undefined;
    return { agentConfigId, field: 'corePermissionsJson', ...(set ? { set } : {}), ...(unset ? { unset } : {}) };
  }
  const add = Array.isArray(r.add) && r.add.every((x) => typeof x === 'string') ? (r.add as string[]) : undefined;
  const remove = Array.isArray(r.remove) && r.remove.every((x) => typeof x === 'string') ? (r.remove as string[]) : undefined;
  if ((!add || add.length === 0) && (!remove || remove.length === 0)) return undefined;
  return {
    agentConfigId,
    field: r.field as ScopePatch['field'],
    ...(add ? { add } : {}),
    ...(remove ? { remove } : {}),
  };
}

/**
 * #971 reliability fallback. In practice the diagnosis LLM reliably states the
 * fix in `concreteFix` prose ("model: google/gemini-2.5-pro") but frequently
 * OMITS the structured `configPatch`, so a proposal would degrade to prose-only
 * and 400 at approve — the loop never closes. For the common, unambiguous
 * model-swap this derives the patch deterministically from the prose. Anything
 * that isn't a clear `provider/model` swap (e.g. an ocAgent tweak) returns
 * undefined and correctly stays prose-only for the human gate.
 */
function deriveConfigPatchFromProse(
  concreteFix: string,
  agentConfigId: string,
  configsRepo: AgentConfigsRepository,
): ConfigPatch | undefined {
  if (!/\bmodel\b/i.test(concreteFix)) return undefined;
  const m = concreteFix.match(/\b([a-z][a-z0-9_-]*\/[a-z0-9][a-z0-9._/-]+)\b/i);
  if (!m) return undefined;
  if (!configsRepo.getById(agentConfigId)) return undefined;
  return { agentConfigId, field: 'model', value: m[1] };
}

/**
 * #971 reliability fallback for scope fixes (same rationale as
 * {@link deriveConfigPatchFromProse}). Conservative: fires only for a clear
 * single-intent "add '<name>' ..." or "remove/drop '<name>' ..." with quoted
 * names. Ambiguous set-rewrites ("reduce the list to [...]") return undefined
 * and stay prose-only — we never guess add-vs-remove-vs-replace.
 */
function deriveScopePatchFromProse(
  concreteFix: string,
  agentConfigId: string,
  configsRepo: AgentConfigsRepository,
): ScopePatch | undefined {
  const lower = concreteFix.toLowerCase();
  const isAdd = /\badd\b/.test(lower) && !/\b(remove|drop)\b/.test(lower);
  const isRemove = /\b(remove|drop)\b/.test(lower) && !/\badd\b/.test(lower);
  if (!isAdd && !isRemove) return undefined;
  const names = [...concreteFix.matchAll(/['"`]([^'"`]+)['"`]/g)]
    .map((x) => x[1])
    .filter((n) => n.length > 0 && n.length <= 60 && !/\s/.test(n));
  if (!names.length) return undefined;
  if (!configsRepo.getById(agentConfigId)) return undefined;
  const coreNames = new Set<string>(CORE_PERMISSION_NAMES);
  const targetCoreNames = names.filter((name) => coreNames.has(name));
  const hasPermissionContext = /\b(?:core\s+)?permissions?\b/i.test(concreteFix);
  if (hasPermissionContext && targetCoreNames.length > 0) {
    // A mixed target list is ambiguous and dangerous (for example, a core tool
    // plus an MCP name). Preserve it as prose instead of silently routing it to
    // either scope layer.
    if (targetCoreNames.length !== names.length) return undefined;
    return isAdd
      ? { agentConfigId, field: 'corePermissionsJson', set: Object.fromEntries(targetCoreNames.map((name) => [name, 'allow'])) }
      : { agentConfigId, field: 'corePermissionsJson', unset: targetCoreNames };
  }
  const field: ScopePatch['field'] = /\bmcp\b/i.test(concreteFix)
    ? 'allowedMcpsJson'
    : 'allowedSkillsJson';
  return isAdd
    ? { agentConfigId, field, add: names }
    : { agentConfigId, field, remove: names };
}

/** Outcome of {@link sanitizeScopePatch}. */
interface SanitizedScopePatch {
  /** The patch with no-op/mis-layered entries dropped; undefined when nothing actionable remains. */
  patch?: ScopePatch;
  /**
   * True when an entry was dropped because the profile ALREADY has it. The
   * diagnosis was then built on a false premise ("this agent lacks X" when it
   * has X), so the caller must not file the proposal at all.
   */
  alreadySatisfied: boolean;
  /** Human-readable reason for the caller's log line. */
  reason?: string;
}

/**
 * Last line of defense for a `scope-change` diagnosis: drop every `add` entry the
 * profile does not actually need, and report WHY.
 *
 * Two classes are dropped:
 *   - already granted — the named MCP server is in the resolved scope (or the
 *     profile is unrestricted), or the named core capability is already granted.
 *     A "missing scope" claim about it is false; `alreadySatisfied` is set so the
 *     whole proposal is skipped rather than filed as a no-op high-risk row.
 *   - wrong layer — a core/provider-executed capability name (image_generation,
 *     bash, …) proposed as an MCP allowlist entry. It cannot be granted there, so
 *     the patch is dropped and the prose survives for the human gate.
 *
 * `remove` entries are left alone: removing something already absent is a
 * harmless no-op, and narrowing is never the false-positive direction here.
 */
function sanitizeScopePatch(
  patch: ScopePatch | undefined,
  agentConfigId: string,
  configsRepo: AgentConfigsRepository,
): SanitizedScopePatch {
  if (!patch) return { alreadySatisfied: false };
  const config = configsRepo.getById(agentConfigId);
  if (!config) return { patch, alreadySatisfied: false };

  if (patch.field === 'corePermissionsJson') {
    const surface = resolveCoreCapabilitySurface(config);
    const set = patch.set ?? {};
    const requested = Object.keys(set);
    const missing = requested.filter(
      (name) => !(surface.granted.includes(name) && set[name] === 'allow'),
    );
    if (requested.length > 0 && missing.length === 0 && !patch.unset?.length) {
      return {
        alreadySatisfied: true,
        reason: `every requested core capability (${requested.join(', ')}) is already granted`,
      };
    }
    return { patch, alreadySatisfied: false };
  }

  if (patch.field !== 'allowedMcpsJson' || !patch.add?.length) {
    return { patch, alreadySatisfied: false };
  }

  const scope = resolveProfileMcpScope(config.allowedMcpsJson ?? null, config.id, config.label);
  const surface = resolveCoreCapabilitySurface(config);
  const alreadyGranted: string[] = [];
  const wrongLayer: string[] = [];
  const add = patch.add.filter((name) => {
    const core = coreCapabilityName(name);
    if (core) {
      (surface.granted.includes(core) ? alreadyGranted : wrongLayer).push(name);
      return false;
    }
    if (scope.shape === 'unrestricted' || scope.servers.includes(name)) {
      alreadyGranted.push(name);
      return false;
    }
    return true;
  });

  if (add.length > 0) {
    return { patch: { ...patch, add }, alreadySatisfied: false };
  }
  if (alreadyGranted.length > 0) {
    return {
      alreadySatisfied: true,
      reason: `'${alreadyGranted.join("', '")}' already granted to ${agentConfigId} (mcp scope shape=${scope.shape})`,
    };
  }
  return {
    alreadySatisfied: false,
    reason: `'${wrongLayer.join("', '")}' is a core/provider-executed capability, not an MCP server — patch dropped, prose kept`,
  };
}

/**
 * #981 — resolve the scheduled task the failing signals actually ran under.
 * The scheduler tags every session it launches with `scheduled_task_id`, so the
 * failing session's own row is the authoritative link — the LLM's emitted id is
 * NEVER trusted (mirrors resolveConfigPatch's server-side re-resolution). Walks
 * the signals' sessionIds newest-first and returns the first non-null
 * scheduled_task_id whose task still exists. Returns undefined if none of the
 * failing sessions were launched by a scheduled task (nothing to refine).
 */
async function resolveScheduledTaskIdFromSignals(
  skillSignals: WorkflowFailureSignal[],
  sessionsRepo: AgentSessionsRepository,
  tasksRepo: AgentScheduledTasksRepository,
): Promise<string | undefined> {
  const sessionIds = [...new Set(skillSignals.flatMap((s) => s.sessionIds))];
  for (const sid of sessionIds) {
    const session = sessionsRepo.findById(sid);
    const taskId = session?.scheduledTaskId;
    if (taskId && (await tasksRepo.findByIdAsync(taskId))) return taskId;
  }
  return undefined;
}

/**
 * Validate a (fully untrusted) `taskPatch` and re-resolve its `scheduledTaskId`
 * from the failing signal's OWN task (never the LLM's emitted id — mirrors
 * {@link resolveConfigPatch}). Returns undefined (drop the patch, prose-only
 * survives) on any malformed shape or if no failing session ran under a
 * scheduled task.
 */
async function resolveTaskPatch(
  raw: unknown,
  skillSignals: WorkflowFailureSignal[],
  sessionsRepo: AgentSessionsRepository,
  tasksRepo: AgentScheduledTasksRepository,
): Promise<TaskPatch | undefined> {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.field !== 'string' || !(TASK_PATCH_FIELDS as readonly string[]).includes(r.field)) return undefined;
  if (typeof r.value !== 'string') return undefined;
  const scheduledTaskId = await resolveScheduledTaskIdFromSignals(skillSignals, sessionsRepo, tasksRepo);
  if (!scheduledTaskId) return undefined;
  return { scheduledTaskId, field: r.field as TaskPatch['field'], value: r.value };
}

/**
 * #981 reliability fallback for task fixes (same rationale as
 * {@link deriveConfigPatchFromProse}). Conservative: fires ONLY for an
 * unambiguous cron-expression change ("cron: 0 9 * * 1" / "schedule to `0 9 * *
 * 1`"), the one task field with a machine-recognizable literal. Instruction /
 * prompt / binding rewrites stay prose-only for the human gate — we never guess
 * free-text instructions or an agent id.
 */
async function deriveTaskPatchFromProse(
  concreteFix: string,
  skillSignals: WorkflowFailureSignal[],
  sessionsRepo: AgentSessionsRepository,
  tasksRepo: AgentScheduledTasksRepository,
): Promise<TaskPatch | undefined> {
  if (!/\b(cron|schedule)\b/i.test(concreteFix)) return undefined;
  // A 5- or 6-field cron expression (optionally quoted). Requires ≥4 spaces so a
  // bare word like "cron" never matches.
  const m = concreteFix.match(/['"`]?((?:[\d*/,\-]+\s+){4,5}[\d*/,\-]+)['"`]?/);
  if (!m) return undefined;
  const scheduledTaskId = await resolveScheduledTaskIdFromSignals(skillSignals, sessionsRepo, tasksRepo);
  if (!scheduledTaskId) return undefined;
  return { scheduledTaskId, field: 'cronExpression', value: m[1].trim() };
}

/**
 * Read a profile's managed SKILL.md body from disk. Returns null when no
 * managed skill file exists for this id (many profiles have none).
 */
function readSkillBodyFromDisk(skillName: string): string | null {
  try {
    const path = join(managedSkillsRoot(), skillName, 'SKILL.md');
    const raw = readFileSync(path, 'utf-8');
    const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n/);
    return fmMatch ? raw.slice(fmMatch[0].length).trim() : raw.trim();
  } catch {
    return null;
  }
}

/**
 * Build the LLM system prompt for diagnosis. The LLM must determine the ROOT
 * CAUSE and propose a CONCRETE fix — not vague advice. When the fix is a
 * config or scope change it must ALSO emit a structured, machine-applyable
 * patch (configPatch/scopePatch) so a deterministic applier can execute it.
 */
function buildDiagnosisSystemPrompt(): string {
  return [
    'You are a senior agent-ops engineer diagnosing why an AI agent profile keeps failing.',
    'You will receive: the agent profile config, the skill body (if any), error evidence',
    'from recent failed sessions, denied tool events, and delegation edges.',
    '',
    'Your job: determine the ROOT CAUSE and propose a CONCRETE fix.',
    '',
    'Root cause categories:',
    '- skill: The skill/prompt itself is unclear, missing a guard, or causes the agent to',
    '  take wrong actions. Fix = edit the SKILL.md (paste the specific paragraph to add).',
    '- config: The agent profile config is wrong (model too weak/strong, system prompt',
    '  misleading, ocAgent mode wrong). Fix = the specific config field + value to change.',
    '- scope: Profile tool scope has two layers. MCP/skill allowlists use allowedMcpsJson or',
    '  allowedSkillsJson. Shell and local-file tools (bash, read, edit, glob, grep, write) and',
    '  provider-EXECUTED tools (image_generation) use corePermissionsJson — those are NOT MCP',
    '  servers and their absence from allowedMcps means nothing. Fix = the exact layer and names',
    '  to add/remove or set/unset.',
    '  Two hard rules before you diagnose scope:',
    '   1. The context states the profile\'s RESOLVED scope. A denied tool marked IN SCOPE is NOT a',
    '      missing grant — a denial and a missing grant are different conditions. Never claim a grant',
    '      is absent when the context shows it present; if you cannot establish the cause, say the',
    '      cause is unestablished and pick rootCause "external" rather than inventing a scope gap.',
    '   2. Check the "provider-executed + core capabilities GRANTED" line before claiming the agent',
    '      lacks any capability listed there (image_generation above all).',
    '- delegation: The profile can\'t delegate to the specialist it needs, or delegates',
    '  to the wrong one. Fix = which delegate to add/remove.',
    '- task: The SCHEDULED TASK definition itself is wrong — its run instructions/prompt',
    '  are unclear, its schedule (cron/time) is wrong, or it is bound to the wrong agent',
    '  profile. Fix = the specific scheduled-task field + value to change.',
    '- external: The failure is infrastructure (provider outage, rate limit, API error)',
    '  not fixable by skill/config/scope changes. Fix = log only, no proposal.',
    '',
    'Output ONLY a JSON object with these fields:',
    '{"diagnosis":"<plain language explanation>","rootCause":"skill|config|scope|delegation|task|external","fixType":"skill-edit|config-change|scope-change|delegation-change|task-change|external-noop","concreteFix":"<the actual fix text>","confidence":"high|medium|low"}',
    '',
    'For a config-change you MUST ALSO include a structured patch (REQUIRED — a',
    'config-change WITHOUT this patch cannot be applied and will be rejected):',
    '  "configPatch":{"agentConfigId":"<the AFFECTED SKILL/PROFILE id>","field":"model|allowedSkillsJson|allowedDelegatesJson|system_prompt","value":"<the new value; for model a model id like anthropic/claude-sonnet-5, for the *Json fields a JSON array string; for system_prompt the COMPLETE replacement system prompt text (the full new role text, not a description)>"}',
    'For a scope-change you MUST ALSO include a structured patch (REQUIRED — same rule):',
    '  For MCP/skill allowlists: "scopePatch":{"agentConfigId":"<the AFFECTED SKILL/PROFILE id>","field":"allowedMcpsJson|allowedSkillsJson","add":["<name>"],"remove":["<name>"]}',
    '  For core permissions: "scopePatch":{"agentConfigId":"<the AFFECTED SKILL/PROFILE id>","field":"corePermissionsJson","set":{"read":"allow","bash":{"*":"allow"}},"unset":["glob"]}',
    '  Never emit bash, read, edit, glob, grep, or write as MCP server names. corePermissionsJson keys',
    '  must be opencode core tool names and values must be allow, ask, deny, or a pattern-to-action map.',
    'For a task-change you MUST ALSO include a structured patch (REQUIRED — same rule).',
    'Do NOT emit a scheduledTaskId — the server resolves it from the failing task itself:',
    '  "taskPatch":{"field":"prompt|description|cronExpression|scheduledTime|agentConfigId","value":"<the new value; for prompt the COMPLETE replacement run instructions, for cronExpression a cron string like 0 9 * * 1, for agentConfigId the id of the profile it should run as>"}',
    '',
    'The concreteFix must be specific and actionable. Not "add a guard" — paste the actual',
    'guard text. Not "fix the model" — specify the model id. Not "check scope" — name the',
    'exact MCP server or skill to add or remove.',
  ].join('\n');
}

/**
 * Render a profile's resolved MCP scope so no reader can mistake "no restriction"
 * or "tool-scoped" for "no access".
 */
function describeMcpScope(scope: ResolvedProfileMcpScope): string {
  switch (scope.shape) {
    case 'unrestricted':
      return '(UNRESTRICTED — no MCP allowlist on this profile; every connected MCP server is available)';
    case 'invalid':
      return '(INVALID stored value — resolves to deny-all; fix the stored JSON, do not add servers)';
    default: {
      if (scope.servers.length === 0) return '[] (explicit deny-all — no MCP server is granted)';
      const detail = scope.servers
        .map((s) => {
          const tools = scope.toolsByServer[s] ?? [];
          return tools.length === 0 ? `${s}: ALL tools` : `${s}: ${tools.length} explicit tool(s)`;
        })
        .join('; ');
      return `${JSON.stringify(scope.servers)} — ${detail}`;
    }
  }
}

/**
 * State whether a denied tool is inside the profile's resolved scope. `isToolAllowed`
 * is the same predicate the dispatch guard enforces with, so this answers the only
 * question that distinguishes "denied" from "not granted".
 */
function describeDeniedToolScope(toolName: string, ctx: DiagnosisContext): string {
  if (!ctx.agentConfig) return 'UNKNOWN: profile not found — scope membership cannot be confirmed';
  const core = coreCapabilityName(toolName);
  if (core) {
    return ctx.coreCapabilities.granted.includes(core)
      ? `IN SCOPE: '${core}' is a core/provider-executed capability this profile is already granted (NOT an MCP server)`
      : `NOT-IN-SCOPE, core capability: '${core}' is granted via corePermissionsJson, NOT via the MCP allowlist`;
  }
  if (ctx.mcpScope.shape === 'unrestricted') {
    return 'IN SCOPE: the profile has no MCP allowlist at all, so this denial is not a missing MCP grant';
  }
  return isToolAllowed(toolName, ctx.agentConfig?.allowedMcpsJson ?? null)
    ? 'IN SCOPE: the profile already grants this tool — this denial is NOT evidence of a missing grant'
    : 'NOT-IN-SCOPE: no allowlist entry of this profile grants this tool';
}

/** Build the user message with full context for the LLM. */
function buildDiagnosisUserPrompt(ctx: DiagnosisContext): string {
  const lines: string[] = [];

  lines.push(`AFFECTED SKILL/PROFILE: ${ctx.affectedSkill}`);
  lines.push('');

  if (ctx.agentConfig) {
    lines.push('AGENT PROFILE CONFIG:');
    lines.push(`  label: ${ctx.agentConfig.label}`);
    lines.push(`  model: ${ctx.agentConfig.modelProvider ?? '(default)'}/${ctx.agentConfig.modelId ?? '(default)'}`);
    lines.push(`  ocAgent: ${ctx.agentConfig.ocAgent ?? '(default)'}`);
    lines.push(`  isManager: ${ctx.agentConfig.isManager}`);
    lines.push(`  systemPrompt: ${(ctx.agentConfig.systemPrompt ?? '(none)').slice(0, 500)}`);
    // MCP scope, stated unambiguously. An `allowedMcps: []` line was previously
    // printed for BOTH an unrestricted profile and a tools-map profile, and the
    // LLM (reasonably) read it as "this agent has no MCP access" and diagnosed
    // missing scope that was never missing.
    lines.push(`  allowedMcps: ${describeMcpScope(ctx.mcpScope)}`);
    lines.push(`  allowedSkills: ${JSON.stringify(ctx.profile?.allowedSkills ?? [])}`);
    lines.push(`  allowedDelegates: ${JSON.stringify(ctx.profile?.allowedDelegates ?? [])}`);
    // Core + provider-EXECUTED capabilities — a DIFFERENT grant surface from the
    // MCP allowlist above. `image_generation` in particular is executed by the
    // model provider and granted by the profile's imageGenerationEnabled flag /
    // a permission.image_generation entry; it is not, and cannot be, an MCP server.
    lines.push(`  corePermissions: ${JSON.stringify(ctx.coreCapabilities.actions)}`);
    lines.push(
      `  provider-executed + core capabilities GRANTED: ${
        ctx.coreCapabilities.granted.length > 0 ? ctx.coreCapabilities.granted.join(', ') : '(none)'
      }`,
    );
    lines.push(
      `    (image_generation is granted here — via imageGenerationEnabled / permission.image_generation — ` +
        `NOT through the MCP allowlist. Absence from allowedMcps proves nothing about it.)`,
    );
    lines.push('');
  } else {
    lines.push('AGENT PROFILE CONFIG: (not found — profile may have been deleted)');
    lines.push('');
  }

  if (ctx.skillBody) {
    const body = ctx.skillBody.length > 4000
      ? ctx.skillBody.slice(0, 4000) + '\n...(truncated)'
      : ctx.skillBody;
    lines.push('SKILL BODY (from SKILL.md):');
    lines.push(body);
    lines.push('');
  } else {
    lines.push('SKILL BODY: (no managed SKILL.md found for this profile)');
    lines.push('');
  }

  lines.push('ERROR EVIDENCE (recent failed sessions):');
  for (const signal of ctx.signals.slice(0, 10)) {
    lines.push(`  [${signal.category}] ${signal.evidence}`);
  }
  lines.push('');

  if (ctx.deniedTools.length > 0) {
    lines.push('DENIED TOOL EVENTS (tools the agent tried to use but was blocked):');
    for (const d of ctx.deniedTools.slice(0, 10)) {
      lines.push(`  ${d.toolName} (count=${d.count}) — ${describeDeniedToolScope(d.toolName, ctx)}`);
    }
    lines.push(
      '  A denial is NOT proof of a missing grant. Only a tool marked NOT-IN-SCOPE above supports a',
      '  scope diagnosis; for an IN-SCOPE one the cause is elsewhere — say so instead of inventing a gap.',
    );
    lines.push('');
  }

  if (ctx.delegationOutbound.length > 0 || ctx.delegationInbound.length > 0) {
    lines.push('DELEGATION EDGES:');
    if (ctx.delegationOutbound.length > 0) {
      lines.push(`  can delegate to: ${ctx.delegationOutbound.map((e) => e.toProfileId).join(', ')}`);
    }
    if (ctx.delegationInbound.length > 0) {
      lines.push(`  receives from: ${ctx.delegationInbound.map((e) => e.fromProfileId).join(', ')}`);
    }
    lines.push('');
  }

  const priors = ctx.priorAttempts ?? [];
  if (priors.length > 0) {
    lines.push(
      'PREVIOUSLY ATTEMPTED FIXES (do NOT repeat — each was applied and then REVERTED because it did not resolve the failure):',
    );
    for (const { attempt, proposal } of priors) {
      lines.push(`  attempt ${attempt} [${proposal.kind}]: ${summarizePriorFix(proposal)}`);
      lines.push(`    reverted because: ${proposal.measureReason ?? '(no measure reason recorded)'}`);
    }
    lines.push(
      'Propose a DIFFERENT root cause or fix than the ones above — repeating a reverted fix will just revert again.',
    );
    lines.push('');
  }

  lines.push('Diagnose the root cause and propose the concrete fix (JSON only):');
  return lines.join('\n');
}

/**
 * One-line summary of a prior attempt's fix for the re-diagnosis context —
 * the human `concreteFix` prose plus the structured patch (if any). Never
 * throws on a malformed `change_json`.
 */
function summarizePriorFix(proposal: AgentOrgProposal): string {
  try {
    const c = JSON.parse(proposal.changeJson ?? '{}') as Record<string, unknown>;
    const patch = c.configPatch ?? c.scopePatch;
    const patchStr = patch ? ` patch=${JSON.stringify(patch)}` : '';
    const fix = typeof c.concreteFix === 'string' ? c.concreteFix : '(no concreteFix)';
    return `${fix}${patchStr}`;
  } catch {
    return '(unparseable change payload)';
  }
}

/** Parse the LLM's JSON response. Returns null on any parse failure. */
function parseDiagnosisResponse(raw: string): DiagnosisResult | null {
  const text = (raw ?? '').trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const rootCause = parsed.rootCause;
    const fixType = parsed.fixType;
    if (typeof rootCause !== 'string' || typeof fixType !== 'string') return null;
    const validRootCauses = ['skill', 'config', 'scope', 'delegation', 'task', 'external'];
    const validFixTypes = ['skill-edit', 'config-change', 'scope-change', 'delegation-change', 'task-change', 'external-noop'];
    if (!validRootCauses.includes(rootCause) || !validFixTypes.includes(fixType)) return null;
    // Pass the raw configPatch/scopePatch through untouched (untrusted,
    // unvalidated shape) — resolveConfigPatch/resolveScopePatch in
    // proposeFixFromSignals are the single point of validation + agentConfigId
    // re-resolution, whether the diagnosis came from this parser or an
    // injected test double.
    const configPatch =
      parsed.configPatch && typeof parsed.configPatch === 'object'
        ? (parsed.configPatch as ConfigPatch)
        : undefined;
    const scopePatch =
      parsed.scopePatch && typeof parsed.scopePatch === 'object'
        ? (parsed.scopePatch as ScopePatch)
        : undefined;
    const taskPatch =
      parsed.taskPatch && typeof parsed.taskPatch === 'object'
        ? (parsed.taskPatch as TaskPatch)
        : undefined;
    return {
      diagnosis: typeof parsed.diagnosis === 'string' ? parsed.diagnosis : '(no diagnosis)',
      rootCause: rootCause as DiagnosisResult['rootCause'],
      fixType: fixType as DiagnosisResult['fixType'],
      concreteFix: typeof parsed.concreteFix === 'string' ? parsed.concreteFix : '(no fix proposed)',
      confidence: (typeof parsed.confidence === 'string' && ['high', 'medium', 'low'].includes(parsed.confidence)
        ? parsed.confidence
        : 'medium') as DiagnosisResult['confidence'],
      ...(configPatch ? { configPatch } : {}),
      ...(scopePatch ? { scopePatch } : {}),
      ...(taskPatch ? { taskPatch } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Default (real) diagnosis function — routes the full context through
 * `AgentRunner.run()` so the diagnosis is an OBSERVABLE `self_improvement`
 * agent_sessions row (is_system=1, visible under ?scope=self_improvement) with a
 * real transcript, rather than a direct, invisible engine call (USO B2 #1029).
 * `run()` handles `ensureReady()` internally. Returns null on any failure (no
 * response, engine down, parse error).
 */
export const defaultDiagnose: DiagnoseCall = async (ctx) => {
  try {
    const { resolveRunModel, run } = await import('../agent_runner');
    const model = resolveRunModel();
    const system = buildDiagnosisSystemPrompt();
    const user = buildDiagnosisUserPrompt(ctx);
    const promptText = `${system}\n\n${user}`;

    // This call only needs text reasoning back (a JSON diagnosis), never tool
    // use — mcpRole + an explicit empty allowedMcpsJson reproduces the old
    // zero-tool `{ role, mcpServers:{}, allowedToolsJson:'{}' }` config so the
    // session carries zero MCP function declarations. Without it the session
    // inherits every connected MCP server's full toolset, which blows past
    // Gemini's 512 function-declaration cap and 400s on a `google` provider.
    // modelOverride pins the already-resolved model so run() does NOT re-resolve
    // it. No agentConfigId — keeping it null is what makes mcpRole +
    // allowedMcpsJson build that exact zero-tool config.
    const res = await run({
      prompt: promptText,
      sessionName: `optimizer-diagnosis: ${ctx.affectedSkill}`,
      category: 'self_improvement',
      modelOverride: model,
      mcpRole: 'org-optimizer-diagnose',
      allowedMcpsJson: '{}',
    });

    if (res.status === 'error' || !res.result) {
      logger.warn('[workflow-signal-generator] diagnose: no response from AgentRunner (engine may not be running)');
      return null;
    }

    const result = parseDiagnosisResponse(res.result);
    if (!result) {
      logger.warn(`[workflow-signal-generator] diagnose: failed to parse LLM response: ${res.result.slice(0, 200)}`);
    }
    return result;
  } catch (err) {
    logger.warn(`[workflow-signal-generator] diagnose FAILED (non-fatal): ${String(err)}`);
    return null;
  }
};

/** Deterministic FNV-1a hash — mirrors org_audit_service.stableGapId's approach. */
function stableHash(...parts: string[]): string {
  const input = parts.join('::');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function isDiagnosableSignal(signal: WorkflowFailureSignal): boolean {
  return !!signal.agentConfigId && DIAGNOSABLE_CATEGORIES.has(signal.category);
}

/**
 * Collapse an evidence string to a stable "shape" — strip UUIDs and numbers
 * (session ids, ports, retry counts) that make otherwise-identical errors look
 * unique, so two occurrences of the same failure mode group together while two
 * genuinely different failure modes for one profile do NOT.
 */
function errorSignature(evidence: string): string {
  return evidence
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .slice(0, 160);
}

interface SignalGroup {
  agentConfigId: string;
  signature: string;
  signals: WorkflowFailureSignal[];
}

/**
 * Group diagnosable signals by `(agentConfigId, error signature)` so each LLM
 * diagnosis call sees ONE coherent failure mode, not every unrelated error a
 * profile has ever hit lumped together (which forced one overconfident root
 * cause across unrelated evidence).
 */
function groupSignalsBySkillAndSignature(signals: WorkflowFailureSignal[]): SignalGroup[] {
  const groups = new Map<string, SignalGroup>();
  for (const signal of signals) {
    if (!isDiagnosableSignal(signal) || !signal.agentConfigId) continue;
    const signature = errorSignature(signal.evidence);
    const key = `${signal.agentConfigId}::${signature}`;
    const existing = groups.get(key);
    if (existing) {
      existing.signals.push(signal);
    } else {
      groups.set(key, { agentConfigId: signal.agentConfigId, signature, signals: [signal] });
    }
  }
  return Array.from(groups.values());
}

/**
 * #971-5 — decide whether to (re-)diagnose a `workflow-fix:*` failure mode
 * from its prior attempts (`listAttemptsForBaseAsync`):
 *  - none               → attempt 1 (proceed).
 *  - any non-`reverted`  → BLOCK: an attempt is still in flight
 *    (proposed/approved/applied/measuring) or already decided (active/rejected)
 *    — don't pile on a duplicate.
 *  - all `reverted`      → the last fix didn't hold; PROCEED at N+1, unless the
 *    cap is reached → PARK (caller logs, creates nothing).
 * A `reverted` row is exactly the measure-failed / human-undo terminal state,
 * so "reverted or measure-failed permits a retry" falls out for free.
 */
function decideRediagnosis(
  priorAttempts: OrgProposalAttempt[],
): { action: 'proceed'; attemptN: number } | { action: 'block' } | { action: 'park' } {
  if (priorAttempts.length === 0) return { action: 'proceed', attemptN: 1 };
  if (priorAttempts.some((a) => a.proposal.status !== 'reverted')) return { action: 'block' };
  const maxN = Math.max(...priorAttempts.map((a) => a.attempt));
  if (maxN >= MAX_DIAGNOSIS_ATTEMPTS) return { action: 'park' };
  return { action: 'proceed', attemptN: maxN + 1 };
}

/**
 * Gather the full diagnosis context for a profile from the snapshot: profile
 * config, skill body from disk, denied tools, delegation edges, and any prior
 * reverted attempts for this failure mode (#971-5).
 */
function buildDiagnosisContext(
  agentConfigId: string,
  skillSignals: WorkflowFailureSignal[],
  snapshot: OrgAuditSnapshot,
  configsRepo: AgentConfigsRepository,
  priorAttempts: OrgProposalAttempt[] = [],
): DiagnosisContext {
  const profile = snapshot.profiles.find((p) => p.id === agentConfigId) ?? null;
  const agentConfig = configsRepo.getById(agentConfigId) ?? null;
  const skillBody = readSkillBodyFromDisk(agentConfigId);
  const deniedTools = snapshot.deniedToolAggregates.filter((d) => d.agentConfigId === agentConfigId);
  const delegationOutbound = snapshot.delegationEdges.filter((e) => e.fromProfileId === agentConfigId);
  const delegationInbound = snapshot.delegationEdges.filter((e) => e.toProfileId === agentConfigId);

  return {
    affectedSkill: agentConfigId,
    signals: skillSignals,
    profile,
    agentConfig,
    mcpScope: resolveProfileMcpScope(
      agentConfig?.allowedMcpsJson ?? null,
      agentConfigId,
      agentConfig?.label ?? null,
    ),
    coreCapabilities: agentConfig
      ? resolveCoreCapabilitySurface(agentConfig)
      : { actions: {}, granted: [] },
    skillBody,
    deniedTools,
    delegationOutbound,
    delegationInbound,
    priorAttempts,
  };
}

/**
 * Map an LLM diagnosis to the optimizer's proposal `kind`. External problems
 * produce no proposal (log only). `delegation-change` is ALSO log-only: the
 * diagnosis envelope carries no top-level `agentConfigId`/delegate target, so
 * routing it to the existing `grant-delegation` kind produced proposals that
 * failed the applier's `change_json.agentConfigId` validation at approve time
 * (#1003). Real delegation gaps are covered by the deterministic delegation
 * generator (#825), which writes the applier-shaped `change_json`.
 */
export function diagnosisToProposalKind(result: DiagnosisResult): string | null {
  switch (result.fixType) {
    case 'skill-edit': return 'workflow-prompt-fix';
    case 'config-change': return 'refine-config';
    case 'scope-change': return 'refine-scope';
    // #981 — a scheduled-task definition fix (instructions/schedule/binding).
    case 'task-change': return 'refine-task';
    case 'delegation-change': return null;
    case 'external-noop': return null;
    default: return null;
  }
}

/**
 * LLM-driven fix proposal: groups signals by (profile, error signature),
 * gathers full context, calls the LLM once per DISTINCT failure mode to
 * diagnose root cause + propose a concrete fix, and persists proposals whose
 * `change_json` carries BOTH the human-review prose (`concreteFix`, diagnosis,
 * evidence) AND — for config/scope fixes — a server-resolved machine-applyable
 * patch. Respects `maxLlmCalls`; the strongest evidence (most occurrences) is
 * diagnosed first.
 */
async function proposeFixFromSignals(
  signals: WorkflowFailureSignal[],
  snapshot: OrgAuditSnapshot,
  configsRepo: AgentConfigsRepository,
  proposalsRepo: Pick<
    AgentOrgProposalsRepository,
    'createAsync' | 'existsByDedupKeyAsync' | 'listAttemptsForBaseAsync'
  >,
  diagnose: DiagnoseCall,
  maxLlmCalls: number,
): Promise<AgentOrgProposal[]> {
  const created: AgentOrgProposal[] = [];
  // #981 — refine-task needs to server-resolve the failing task from the
  // session's own `scheduled_task_id`; these repos back that resolution.
  const sessionsRepo = new AgentSessionsRepository();
  const tasksRepo = new AgentScheduledTasksRepository();
  const groups = groupSignalsBySkillAndSignature(signals).sort(
    (a, b) => b.signals.length - a.signals.length,
  );
  let llmCallsUsed = 0;

  for (const { agentConfigId, signals: skillSignals } of groups) {
    if (llmCallsUsed >= maxLlmCalls) {
      logger.info(`[workflow-signal-generator] diagnose budget exhausted (${maxLlmCalls}); skipping ${agentConfigId}`);
      break;
    }

    // Dedup on (profile + failure-mode evidence hash). The hash differs per
    // error signature, so distinct failure modes for one profile dedup
    // independently. #971-5 makes the key ATTEMPT-AWARE: the base gains an
    // `:a<N>` suffix so a reverted fix isn't permanently deduped — a new
    // attempt is allowed while the prior one is reverted, blocked while it is
    // still in flight/decided, and parked after MAX_DIAGNOSIS_ATTEMPTS.
    const evidenceHash = stableHash(...skillSignals.map((s) => s.evidence));
    const baseKey = `workflow-fix:${agentConfigId}:${evidenceHash}`;
    const priorAttempts = await proposalsRepo.listAttemptsForBaseAsync(baseKey);
    const decision = decideRediagnosis(priorAttempts);
    if (decision.action === 'block') continue;
    if (decision.action === 'park') {
      logger.info(
        `[workflow-signal-generator] re-diagnosis PARKED for ${agentConfigId} (${baseKey}): ` +
          `${MAX_DIAGNOSIS_ATTEMPTS} attempts all reverted — not retrying`,
      );
      continue;
    }
    const dedupKey = `${baseKey}:a${decision.attemptN}`;

    const ctx = buildDiagnosisContext(agentConfigId, skillSignals, snapshot, configsRepo, priorAttempts);
    llmCallsUsed++;

    let result: DiagnosisResult | null;
    try {
      result = await diagnose(ctx);
    } catch (err) {
      logger.warn(`[workflow-signal-generator] diagnose call failed for ${agentConfigId} (non-fatal): ${String(err)}`);
      continue;
    }

    if (!result) {
      logger.info(`[workflow-signal-generator] no diagnosis returned for ${agentConfigId}`);
      continue;
    }

    if (result.fixType === 'external-noop') {
      logger.info(
        `[workflow-signal-generator] ${agentConfigId}: external issue diagnosed — ${result.diagnosis}. No proposal created.`,
      );
      continue;
    }

    if (result.fixType === 'delegation-change') {
      logger.info(
        `[workflow-signal-generator] ${agentConfigId}: delegation-change diagnosed — ${result.diagnosis}. ` +
          `Delegation gaps are applied by the deterministic delegation generator (#825); ` +
          `no grant-delegation proposal created from diagnosis (#1003).`,
      );
      continue;
    }

    const kind = diagnosisToProposalKind(result);
    if (!kind) continue;

    try {
      // Resolve/validate the structured patch (if any) for the fixType this
      // diagnosis actually produced — NEVER trust the LLM's agentConfigId; it
      // is re-resolved from the failing signal's own profile.
      const configPatch =
        result.fixType === 'config-change'
          ? (resolveConfigPatch(result.configPatch, agentConfigId, configsRepo) ??
            deriveConfigPatchFromProse(result.concreteFix, agentConfigId, configsRepo))
          : undefined;
      // A scope-change diagnosis is only filed once the claimed gap is confirmed
      // to exist. `sanitizeScopePatch` drops grants the profile already has (and
      // capability names that belong to the core/provider layer, not the MCP
      // allowlist); when the whole patch was already satisfied, the diagnosis
      // rests on a false premise and NOTHING is filed.
      const sanitized =
        result.fixType === 'scope-change'
          ? sanitizeScopePatch(
              resolveScopePatch(result.scopePatch, agentConfigId, configsRepo) ??
                deriveScopePatchFromProse(result.concreteFix, agentConfigId, configsRepo),
              agentConfigId,
              configsRepo,
            )
          : { alreadySatisfied: false as const };
      if (sanitized.alreadySatisfied) {
        logger.warn(
          `[workflow-signal-generator] ${agentConfigId}: DROPPED scope-change diagnosis — ${sanitized.reason}. ` +
            `Diagnosis was: ${result.diagnosis.slice(0, 160)}`,
        );
        continue;
      }
      if (sanitized.reason) {
        logger.info(`[workflow-signal-generator] ${agentConfigId}: scope patch adjusted — ${sanitized.reason}`);
      }
      const scopePatch = sanitized.patch;
      // #981 — task-change: scheduledTaskId is server-resolved from the failing
      // signal's own task (never the LLM's id); prose fallback covers cron edits.
      const taskPatch =
        result.fixType === 'task-change'
          ? ((await resolveTaskPatch(result.taskPatch, skillSignals, sessionsRepo, tasksRepo)) ??
            (await deriveTaskPatchFromProse(result.concreteFix, skillSignals, sessionsRepo, tasksRepo)))
          : undefined;

      // Flattened, de-duplicated session ids backing this failure mode — the
      // canonical list the behavioral-measure step (#3) replays.
      const sessionIds = [...new Set(skillSignals.flatMap((s) => s.sessionIds))];

      const changeJson = JSON.stringify({
        source: 'org-optimizer-llm-diagnosis',
        affectedSkill: agentConfigId,
        diagnosis: result.diagnosis,
        rootCause: result.rootCause,
        fixType: result.fixType,
        concreteFix: result.concreteFix,
        confidence: result.confidence,
        evidence: skillSignals.map((s) => ({
          sessionIds: s.sessionIds,
          category: s.category,
          evidence: s.evidence,
        })),
        sessionIds,
        ...(configPatch ? { configPatch } : {}),
        ...(scopePatch ? { scopePatch } : {}),
        ...(taskPatch ? { taskPatch } : {}),
      });

      const proposal = await proposalsRepo.createAsync({
        auditRunId: snapshot.auditRunId,
        kind,
        risk: classifyProposalRisk({ kind, changeJson }),
        status: 'proposed',
        title: `Fix ${result.rootCause} issue in ${agentConfigId}: ${result.diagnosis.slice(0, 80)}`,
        rationale:
          `${result.diagnosis} ` +
          `Root cause: ${result.rootCause}. Confidence: ${result.confidence}. ` +
          `Evidence: ${skillSignals.length} failure signal(s) from sessions: ${sessionIds.slice(0, 5).map((id) => id.slice(0, 8)).join(', ')}.`,
        signalRef: `diagnosis:${agentConfigId}:${evidenceHash}`,
        targetRef:
          result.fixType === 'skill-edit'
            ? `skill:${agentConfigId}`
            : result.fixType === 'task-change' && taskPatch
              ? `task:${taskPatch.scheduledTaskId}`
              : `profile:${agentConfigId}`,
        changeJson,
        dedupKey,
        // C6 (repair item 3) — converted ONCE here, at creation, through the
        // fixed named/versioned mapping. Never re-derived or re-parsed later
        // (proposal_evidence_builder.ts reads this durable field verbatim).
        diagnosisConfidence: mapDiagnosisConfidence(result.confidence),
        diagnosisConfidenceVersion: DIAGNOSIS_CONFIDENCE_MAPPING_VERSION,
      });
      logger.info(
        `[workflow-signal-generator] proposed ${kind} '${proposal.id}' for ${agentConfigId} (${result.rootCause}/${result.fixType})`,
      );
      created.push(proposal);
    } catch (err) {
      logger.warn(`[workflow-signal-generator] fix proposal persist failed for ${agentConfigId} (non-fatal): ${String(err)}`);
    }
  }

  return created;
}

export interface DiagnosisGeneratorDeps {
  proposalsRepo?: Pick<
    AgentOrgProposalsRepository,
    'createAsync' | 'existsByDedupKeyAsync' | 'listAttemptsForBaseAsync'
  >;
  configsRepo?: AgentConfigsRepository;
  /** LLM-driven diagnosis function. Defaults to the real opencode-backed one. */
  diagnose?: DiagnoseCall;
  /** Max LLM diagnosis calls per run. Default 10. */
  maxDiagnoseCalls?: number;
}

export interface DiagnosisGeneratorResult {
  created: AgentOrgProposal[];
}

/**
 * #971 — the LLM diagnosis lane entry point, called ADDITIVELY alongside the
 * deterministic {@link generateWorkflowSignalProposals} from the optimizer
 * run. Emits `refine-config` / `refine-scope` / `workflow-prompt-fix` /
 * `refine-task` proposals. NEVER throws — a diagnosis failure degrades to zero
 * proposals.
 */
export async function generateDiagnosisProposals(
  snapshot: OrgAuditSnapshot,
  deps: DiagnosisGeneratorDeps = {},
): Promise<DiagnosisGeneratorResult> {
  const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
  const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();
  const diagnose: DiagnoseCall = deps.diagnose ?? defaultDiagnose;
  const maxDiagnoseCalls = deps.maxDiagnoseCalls ?? DEFAULT_MAX_DIAGNOSE_CALLS;

  try {
    const created = await proposeFixFromSignals(
      snapshot.workflowFailureSignals ?? [],
      snapshot,
      configsRepo,
      proposalsRepo,
      diagnose,
      maxDiagnoseCalls,
    );
    return { created };
  } catch (err) {
    logger.warn(`[workflow-signal-generator] diagnosis pass FAILED (non-fatal): ${String(err)}`);
    return { created: [] };
  }
}
