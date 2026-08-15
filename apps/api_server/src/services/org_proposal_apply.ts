/**
 * org_proposal_apply.ts — #821 (org-optimizer-05)
 *
 * The low-risk AUTO-APPLY step of the org self-optimizer. Takes a
 * `agent_org_proposals` row already classified `risk='low'` by
 * `classifyProposalRisk` (#820), captures `before_snapshot_json` (the exact
 * prior value of whatever it is about to change), applies the change, and
 * transitions the row `proposed -> applied -> measuring` (the state machine
 * in `agent_org_proposals_repository.ts` permits `proposed -> applied`
 * directly — the auto-apply lane per the maintainer's full-autonomy-with-
 * rollback policy, docs/ai/decisions/2026-07-02-autonomy-and-vault-intent.md).
 *
 * `applyProposal` re-checks `classifyProposalRisk` itself rather than
 * trusting the row's stored `risk` column or the caller — this is the load-
 * bearing guard that keeps the auto path low-risk-only even if a caller bug
 * or a future queue regression tries to push a high-risk proposal through.
 *
 * `revertProposal` (used by #821's measure step, `org_proposal_measure.ts`,
 * on a non-improving change) restores non-scope snapshots and uses versioned
 * CAS + entry-level inverses for scope deltas before setting `status='reverted'`. The reverted row is NOT
 * deleted — it remains in the table so `existsByDedupKeyAsync` continues to
 * report the dedup_key as seen, preventing an apply/revert flip-flop loop
 * where the same change gets re-proposed every optimizer run.
 *
 * Direct scope-shaped payloads (`allowedMcpsJson` / `allowedSkillsJson`) are
 * refused defensively by the unattended entry point, independent of risk
 * classification. `refine-skill` / `consolidate-skill` /
 * `refine-recipe` proposals are also accepted here (their `changeJson` is
 * carried through to `measuring` unmodified — the LLM-scored measure step is
 * what determines keep/revert for those kinds; per the skill loop precedent
 * `skill_apply.ts` these kinds are typically applied by the skill loop
 * itself before this function is invoked, so this function's SNAPSHOT for
 * them is a "prior body" record already present on the change payload
 * rather than a live-system read).
 *
 * Operational envelope (mirrors skill_apply.ts):
 *   • NEVER throws — the caller (the optimizer loop) is fire-and-forget.
 *   • On any unexpected error (malformed changeJson, missing target, etc.),
 *     resolve to `{ status: 'skipped' }` rather than throwing or leaving the
 *     row in an inconsistent state.
 */

import { createHash } from 'node:crypto';

import { logger } from '../utils/logger';
import { classifyProposalRisk } from './org_risk_classifier';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import {
  AgentConfigsRepository,
  type AgentConfig,
  type AgentConfigInput,
} from '../repositories/agent_configs_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  AgentScheduledTasksRepository,
  type AgentScheduledTask,
} from '../repositories/agent_scheduled_tasks_repository';
import { writeAgentProfileFile } from './opencode_agent_writer';
import {
  writeManagedSkill,
  deleteManagedSkill,
  restoreManagedSkillBytes,
} from './rhythm_managed_skills';
import { CONFIG_PATCH_FIELDS, SCOPE_PATCH_FIELDS, TASK_PATCH_FIELDS } from './org_diagnosis_types';
import {
  isConsolidationPairingChange,
  draftConsolidationPayload,
  type DraftedConsolidationPayload,
} from './skill_consolidation_drafter';
import type { AgentOrgProposal } from '../models/agent_org_proposal';

export type ApplyOutcome = 'applied-ok' | 'refused-high-risk' | 'skipped';

export interface ApplyResult {
  status: ApplyOutcome;
  reason?: string;
}

/** Shape of the `changeJson` payload for an `agent_configs` scope mutation. */
interface AgentConfigScopeChange {
  agentConfigId: string;
  field: 'allowedMcpsJson' | 'allowedSkillsJson';
  /** Names to remove from the current allowlist (prune-scope / tighten-scope). */
  remove?: string[];
  /** Names to add to the current allowlist (broaden-scope — never reaches here; HIGH). */
  add?: string[];
}

type ScopeFieldName = AgentConfigScopeChange['field'];

const RESERVED_SCOPE_IDENTIFIERS = new Set(['__proto__', 'constructor', 'prototype']);

/** Reject JavaScript prototype-pollution identifiers at every scope boundary. */
export function isReservedScopeIdentifier(name: unknown): name is string {
  return typeof name === 'string' && RESERVED_SCOPE_IDENTIFIERS.has(name.trim());
}

export interface ScopeDeltaV2RemovedEntry {
  name: string;
  /** Exact array element or tools-map value removed by the apply. */
  priorValue: unknown;
  /** Original entry position, used to restore ordering without replaying the field. */
  priorIndex: number;
}

/** Versioned, entry-level scope rollback record. */
export interface ScopeDeltaV2Snapshot {
  version: 'scope-delta-v2';
  target: { type: 'agent_config'; id: string };
  field: ScopeFieldName;
  /** Normalized exact removal request bound to change_json and integrityHash. */
  requestedRemove: string[];
  removedEntries: ScopeDeltaV2RemovedEntry[];
  /** Exact serialized field value written by apply; this is the CAS expectation. */
  expectedAppliedValue: string;
  /** Exact-match CAS material for expectedAppliedValue alone (kept for that narrow check). */
  expectedAppliedHash: string;
  /**
   * SHA-256 over the canonical {version, target, field, requestedRemove,
   * removedEntries, expectedAppliedValue} tuple — every field a revert reads to decide WHAT to
   * write back. Unlike {@link expectedAppliedHash} (which only covers
   * `expectedAppliedValue`), this catches tampering of `target`, `field`, or
   * `removedEntries` (e.g. a rewritten priorValue/priorIndex/name) even when
   * `expectedAppliedValue` itself is untouched. Validated FIRST, before any
   * read/CAS/write, so a tampered or hand-edited snapshot is refused closed.
   */
  integrityHash: string;
}

/**
 * Broad direct-shape recognition retained only for unattended refusal and
 * legacy revert detection. It must never authorize a scope mutation.
 */
function isDirectAgentConfigScopePayload(v: unknown): v is AgentConfigScopeChange {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.agentConfigId === 'string' &&
    (c.field === 'allowedMcpsJson' || c.field === 'allowedSkillsJson')
  );
}

// ── Shared agent_config field mechanics (#971 refine-config / refine-scope) ──
//
// The refine-config (ConfigPatch scalar swap) and refine-scope (ScopePatch
// add/remove) appliers live in org_proposal_appliers_wiring.ts (the approve
// lane), but their SNAPSHOT + RESTORE mechanics live here so revertProposal
// and both appliers share one definition of "read a field" / "write a field"
// and can never drift. Both kinds snapshot the same shape —
// {agentConfigId, field, priorValue} — so a single revert branch restores
// either one.

/** Union of every agent_configs field the two patch shapes can target. */
export type ConfigFieldName =
  | (typeof CONFIG_PATCH_FIELDS)[number]
  | (typeof SCOPE_PATCH_FIELDS)[number];

/** The before_snapshot_json shape refine-config AND refine-scope both write. */
export interface ConfigFieldSnapshot {
  agentConfigId: string;
  field: ConfigFieldName;
  /** Prior value in the same representation {@link readAgentConfigField} yields. */
  priorValue: string | null;
}

const CONFIG_FIELD_NAMES = new Set<string>([...CONFIG_PATCH_FIELDS, ...SCOPE_PATCH_FIELDS]);

export function isConfigFieldName(v: unknown): v is ConfigFieldName {
  return typeof v === 'string' && CONFIG_FIELD_NAMES.has(v);
}

export function isConfigFieldSnapshot(v: unknown): v is ConfigFieldSnapshot {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.agentConfigId === 'string' &&
    isConfigFieldName(c.field) &&
    'priorValue' in c &&
    (typeof c.priorValue === 'string' || c.priorValue === null)
  );
}

/**
 * Read one logical field off a live agent_configs row in the representation
 * the snapshot/restore round-trip uses. `model` has no single column — it is
 * the `modelProvider`/`modelId` pair the REST config path renders as
 * `provider/model`; the scope/list fields are their raw JSON strings.
 */
export function readAgentConfigField(config: AgentConfig, field: ConfigFieldName): string | null {
  switch (field) {
    case 'model':
      return config.modelProvider && config.modelId
        ? `${config.modelProvider}/${config.modelId}`
        : (config.modelId ?? null);
    case 'allowedMcpsJson':
      return config.allowedMcpsJson ?? null;
    case 'allowedSkillsJson':
      return config.allowedSkillsJson ?? null;
    case 'corePermissionsJson':
      return config.corePermissionsJson ?? null;
    case 'allowedDelegatesJson':
      return config.allowedDelegatesJson ?? null;
    case 'system_prompt':
      return config.systemPrompt ?? null;
  }
}

/**
 * Build the AgentConfigsRepository.update() patch that sets `field` to `value`.
 * For `model`, a `provider/model` string is split on the FIRST slash into the
 * two columns; a slash-less value is stored as `modelId` with a null provider.
 * ponytail: first-slash split — model ids with embedded slashes (e.g.
 * "openrouter/anthropic/claude") keep only the first segment as provider;
 * upgrade to a provider allowlist if such ids appear in real patches.
 */
export function agentConfigFieldPatch(
  field: ConfigFieldName,
  value: string | null,
): Partial<AgentConfigInput> {
  switch (field) {
    case 'model': {
      if (value == null || value.trim() === '') return { modelProvider: null, modelId: null };
      const slash = value.indexOf('/');
      return slash > 0
        ? { modelProvider: value.slice(0, slash), modelId: value.slice(slash + 1) }
        : { modelProvider: null, modelId: value };
    }
    case 'allowedMcpsJson':
      return { allowedMcpsJson: value };
    case 'allowedSkillsJson':
      return { allowedSkillsJson: value };
    case 'corePermissionsJson':
      return { corePermissionsJson: value };
    case 'allowedDelegatesJson':
      return { allowedDelegatesJson: value };
    case 'system_prompt':
      return { systemPrompt: value };
  }
}

/**
 * Set-arithmetic on a JSON string[] allowlist: start from `priorJson`, drop
 * every name in `remove`, append every name in `add` not already present
 * (order-stable). Returns a JSON array string used by human-gated scope
 * appliers and V2 snapshot/revert mechanics.
 */
export function computeScopeList(
  priorJson: string | null,
  patch: { add?: string[]; remove?: string[] },
): string {
  // A profile may store `allowed_mcps_json` as a TOOLS-MAP
  // ({"gitnexus":null,"rhythm":["rhythm_ping",...]}) instead of a server-name
  // array. `safeParseStringArray` yields [] for that shape, so the array path
  // below would REPLACE the whole map with `["<added name>"]` — silently
  // destroying every other server grant and all per-tool narrowing on the
  // profile. Set arithmetic on the map's own keys keeps the shape (and the
  // sibling grants) intact; an added server gets [] = all its tools, the same
  // meaning the array shape carries.
  const priorMap = parseScopeMap(priorJson);
  if (priorMap) {
    const next = Object.create(null) as Record<string, unknown>;
    for (const [name, value] of Object.entries(priorMap)) {
      Object.defineProperty(next, name, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    for (const name of patch.remove ?? []) delete next[name];
    for (const name of patch.add ?? []) if (!(name in next)) next[name] = [];
    return JSON.stringify(next);
  }

  const current = priorJson ? safeParseStringArray(priorJson) : [];
  const removeSet = new Set(patch.remove ?? []);
  const next = current.filter((name) => !removeSet.has(name));
  for (const name of patch.add ?? []) {
    if (!next.includes(name)) next.push(name);
  }
  return JSON.stringify(next);
}

function hashScopeValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeRequestedRemove(remove: readonly string[]): string[] {
  return [...new Set(remove)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Canonical integrity material for a V2 snapshot: every field a revert reads
 * to decide what to write back, in a fixed key order so the hash is stable
 * regardless of how the snapshot was constructed or re-serialized.
 */
function scopeDeltaIntegrityMaterial(input: {
  version: 'scope-delta-v2';
  target: { type: 'agent_config'; id: string };
  field: ScopeFieldName;
  requestedRemove: string[];
  removedEntries: ScopeDeltaV2RemovedEntry[];
  expectedAppliedValue: string;
}): string {
  return JSON.stringify({
    version: input.version,
    target: { type: input.target.type, id: input.target.id },
    field: input.field,
    requestedRemove: input.requestedRemove,
    removedEntries: input.removedEntries.map((e) => ({
      name: e.name,
      priorValue: e.priorValue,
      priorIndex: e.priorIndex,
    })),
    expectedAppliedValue: input.expectedAppliedValue,
  });
}

function computeScopeIntegrityHash(input: {
  version: 'scope-delta-v2';
  target: { type: 'agent_config'; id: string };
  field: ScopeFieldName;
  requestedRemove: string[];
  removedEntries: ScopeDeltaV2RemovedEntry[];
  expectedAppliedValue: string;
}): string {
  return hashScopeValue(scopeDeltaIntegrityMaterial(input));
}

/**
 * Build the V2 delta before a scope mutation. It records only entries the
 * mutation actually removes plus the exact post-apply value used for CAS.
 */
export function createScopeDeltaV2Snapshot(
  agentConfigId: string,
  field: ScopeFieldName,
  priorValue: string | null,
  remove: string[],
): ScopeDeltaV2Snapshot {
  const reserved = remove.find(isReservedScopeIdentifier);
  if (reserved !== undefined) {
    throw new Error(`Reserved scope identifier '${reserved.trim()}' is not allowed`);
  }
  const removeSet = new Set(remove);
  const priorMap = parseScopeMap(priorValue);
  let removedEntries: ScopeDeltaV2RemovedEntry[];

  if (priorMap) {
    removedEntries = Object.entries(priorMap).flatMap(([name, value], priorIndex) =>
      removeSet.has(name) ? [{ name, priorValue: value, priorIndex }] : [],
    );
  } else {
    const priorArray = priorValue ? safeParseStringArray(priorValue) : [];
    removedEntries = priorArray.flatMap((name, priorIndex) =>
      removeSet.has(name) ? [{ name, priorValue: name, priorIndex }] : [],
    );
  }

  const version = 'scope-delta-v2' as const;
  const target = { type: 'agent_config' as const, id: agentConfigId };
  const requestedRemove = normalizeRequestedRemove(remove);
  const expectedAppliedValue = computeScopeList(priorValue, { remove });
  return {
    version,
    target,
    field,
    requestedRemove,
    removedEntries,
    expectedAppliedValue,
    expectedAppliedHash: hashScopeValue(expectedAppliedValue),
    integrityHash: computeScopeIntegrityHash({ version, target, field, requestedRemove, removedEntries, expectedAppliedValue }),
  };
}

function isScopeDeltaV2Snapshot(v: unknown): v is ScopeDeltaV2Snapshot {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  const target = c.target as Record<string, unknown> | undefined;
  if (
    c.version !== 'scope-delta-v2' ||
    target?.type !== 'agent_config' ||
    typeof target.id !== 'string' ||
    (c.field !== 'allowedMcpsJson' && c.field !== 'allowedSkillsJson') ||
    !Array.isArray(c.removedEntries) ||
    !Array.isArray(c.requestedRemove) ||
    typeof c.expectedAppliedValue !== 'string' ||
    typeof c.expectedAppliedHash !== 'string' ||
    typeof c.integrityHash !== 'string'
  ) {
    return false;
  }
  const requestedRemove = c.requestedRemove as unknown[];
  if (
    requestedRemove.length === 0 ||
    !requestedRemove.every(
      (name) => typeof name === 'string' && name.length > 0 && !isReservedScopeIdentifier(name),
    )
  ) {
    return false;
  }
  const requestedNames = requestedRemove as string[];
  if (
    new Set(requestedNames).size !== requestedNames.length ||
    JSON.stringify(normalizeRequestedRemove(requestedNames)) !== JSON.stringify(requestedNames)
  ) {
    return false;
  }
  const names = new Set<string>();
  for (const entry of c.removedEntries) {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as Record<string, unknown>;
    if (
      typeof e.name !== 'string' ||
      !e.name ||
      isReservedScopeIdentifier(e.name) ||
      !('priorValue' in e) ||
      !Number.isInteger(e.priorIndex) ||
      (e.priorIndex as number) < 0
    ) {
      return false;
    }
    // Reject a snapshot claiming to remove the same entry twice — either a
    // construction bug or a tampered payload, never a legitimate delta.
    if (names.has(e.name)) return false;
    names.add(e.name);
  }
  return JSON.stringify(normalizeRequestedRemove([...names])) === JSON.stringify(requestedNames);
}

/**
 * Recompute the integrity hash over the snapshot's OWN fields and compare —
 * catches tampering of `target`/`field`/`removedEntries` that a CAS check on
 * `expectedAppliedValue` alone would miss.
 */
function scopeDeltaIntegrityHolds(snapshot: ScopeDeltaV2Snapshot): boolean {
  return (
    computeScopeIntegrityHash({
      version: snapshot.version,
      target: snapshot.target,
      field: snapshot.field,
      requestedRemove: snapshot.requestedRemove,
      removedEntries: snapshot.removedEntries,
      expectedAppliedValue: snapshot.expectedAppliedValue,
    }) === snapshot.integrityHash
  );
}

/**
 * When the proposal's live `change_json` still carries the original
 * `{agentConfigId, field}` targeting, it must agree with the snapshot's own
 * target/field. A mismatch means the snapshot and the row's change_json have
 * drifted apart (tampering, or a manual edit) — fail closed rather than
 * mutate whatever the snapshot alone claims.
 */
function scopeDeltaMatchesChangeJson(snapshot: ScopeDeltaV2Snapshot, change: unknown): boolean {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return false;
  const c = change as Record<string, unknown>;
  if (c.agentConfigId !== snapshot.target.id || c.field !== snapshot.field) return false;
  if (c.add !== undefined || !Array.isArray(c.remove)) return false;
  const remove = c.remove;
  if (
    !remove.every(
      (name) => typeof name === 'string' && name.length > 0 && !isReservedScopeIdentifier(name),
    )
  ) return false;
  const names = remove as string[];
  if (new Set(names).size !== names.length) return false;
  return (
    JSON.stringify(normalizeRequestedRemove(names)) === JSON.stringify(snapshot.requestedRemove)
  );
}

function invertScopeDelta(snapshot: ScopeDeltaV2Snapshot): string | null {
  let applied: unknown;
  try {
    applied = JSON.parse(snapshot.expectedAppliedValue);
  } catch {
    return null;
  }

  const removed = [...snapshot.removedEntries].sort((a, b) => a.priorIndex - b.priorIndex);
  if (Array.isArray(applied)) {
    if (!applied.every((value) => typeof value === 'string')) return null;
    const restored = [...applied] as string[];
    for (const entry of removed) {
      // Array-shaped scope columns have no separate "value" — the entry's
      // name IS the restored element, so priorValue must equal name exactly.
      if (
        typeof entry.priorValue !== 'string' ||
        entry.priorValue !== entry.name ||
        restored.includes(entry.name)
      ) {
        return null;
      }
      restored.splice(Math.min(entry.priorIndex, restored.length), 0, entry.priorValue);
    }
    return JSON.stringify(restored);
  }

  if (applied && typeof applied === 'object') {
    const entries = Object.entries(applied as Record<string, unknown>);
    for (const entry of removed) {
      if (entries.some(([name]) => name === entry.name)) return null;
      entries.splice(
        Math.min(entry.priorIndex, entries.length),
        0,
        [entry.name, entry.priorValue],
      );
    }
    const restored = Object.create(null) as Record<string, unknown>;
    for (const [name, value] of entries) {
      Object.defineProperty(restored, name, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return JSON.stringify(restored);
  }

  return null;
}

// ── Shared skill-body revert snapshot (#971 workflow-prompt-fix / #976 refine-skill) ──

/** The before_snapshot_json shape workflow-prompt-fix AND refine-skill write. */
export interface SkillBodyRevertSnapshot {
  skillId: string;
  /** Semantic source body used by the body-measure path. */
  priorBody: string | null;
  /** Exact pre-apply DB value, kept separate from the file source of truth. */
  priorDbBody?: string | null;
  priorStatus: string;
  /** Absent on legacy snapshots created before #1082. */
  managedFileWasPresent?: boolean;
  /** Base64 of the complete pre-apply SKILL.md, including frontmatter/whitespace. */
  managedFileBytesBase64?: string | null;
}

export function isSkillBodyRevertSnapshot(v: unknown): v is SkillBodyRevertSnapshot {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  const legacyFieldsValid =
    typeof c.skillId === 'string' &&
    ('priorBody' in c) &&
    (typeof c.priorBody === 'string' || c.priorBody === null) &&
    typeof c.priorStatus === 'string';
  if (!legacyFieldsValid) return false;

  if ('priorDbBody' in c && typeof c.priorDbBody !== 'string' && c.priorDbBody !== null) {
    return false;
  }
  if (!('managedFileWasPresent' in c)) return true;
  if (typeof c.managedFileWasPresent !== 'boolean') return false;
  return c.managedFileWasPresent
    ? typeof c.managedFileBytesBase64 === 'string'
    : c.managedFileBytesBase64 === null;
}

// ── Shared agent_scheduled_tasks field mechanics (#981 refine-task) ──────────
//
// The refine-task applier (a TaskPatch scalar swap on one agent_scheduled_tasks
// row) lives in org_proposal_appliers_wiring.ts (the approve lane), but its
// SNAPSHOT + RESTORE mechanics live here so revertProposal and the applier
// share one definition of "read a task field" / "write a task field" and can
// never drift — the exact mirror of refine-config's ConfigFieldSnapshot above.

/** The before_snapshot_json shape refine-task writes. */
export interface ScheduledTaskFieldSnapshot {
  scheduledTaskId: string;
  field: (typeof TASK_PATCH_FIELDS)[number];
  /** Prior value in the same representation {@link readScheduledTaskField} yields. */
  priorValue: string | null;
}

const TASK_FIELD_NAMES = new Set<string>([...TASK_PATCH_FIELDS]);

export function isScheduledTaskFieldSnapshot(v: unknown): v is ScheduledTaskFieldSnapshot {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.scheduledTaskId === 'string' &&
    typeof c.field === 'string' &&
    TASK_FIELD_NAMES.has(c.field) &&
    'priorValue' in c &&
    (typeof c.priorValue === 'string' || c.priorValue === null)
  );
}

/** Read one editable field off a live agent_scheduled_tasks row (string repr). */
export function readScheduledTaskField(
  task: AgentScheduledTask,
  field: (typeof TASK_PATCH_FIELDS)[number],
): string | null {
  switch (field) {
    case 'prompt':
      return task.prompt ?? null;
    case 'description':
      return task.description ?? null;
    case 'cronExpression':
      return task.cronExpression ?? null;
    case 'scheduledTime':
      return task.scheduledTime ?? null;
    case 'agentConfigId':
      return task.agentConfigId ?? null;
  }
}

/** The update-patch type AgentScheduledTasksRepository.updateAsync accepts. */
export type ScheduledTaskUpdatePatch = Parameters<AgentScheduledTasksRepository['updateAsync']>[1];

/**
 * Build the AgentScheduledTasksRepository.updateAsync() patch that sets `field`
 * to `value`. The TaskPatch field names are exactly the repo's update-input
 * keys, so this is a direct 1:1 assignment (no split logic like `model`). The
 * cast admits a `null` prior value (revert of a task whose field was null);
 * updateAsync coerces it back to a SQL NULL bind.
 */
export function scheduledTaskFieldPatch(
  field: (typeof TASK_PATCH_FIELDS)[number],
  value: string | null,
): ScheduledTaskUpdatePatch {
  return { [field]: value } as ScheduledTaskUpdatePatch;
}

export interface ApplyDeps {
  /** Injectable proposals repo (defaults to a fresh AgentOrgProposalsRepository). */
  proposalsRepo?: AgentOrgProposalsRepository;
  /** Injectable configs repo (defaults to a fresh AgentConfigsRepository). */
  configsRepo?: AgentConfigsRepository;
  /** Injectable skills repo — used by consolidate-skill apply/revert (#852). */
  skillsRepo?: AgentSkillsRepository;
  /** Injectable scheduled-tasks repo — used by refine-task revert (#981). */
  tasksRepo?: AgentScheduledTasksRepository;
}

/**
 * Apply a low-risk proposal: snapshot -> mutate -> status='measuring'.
 * NEVER throws. Re-validates risk via {@link classifyProposalRisk} — refuses
 * (and makes NO changes) if the proposal is high-risk by that predicate,
 * regardless of what `proposal.risk` says.
 */
export async function applyProposal(
  proposal: AgentOrgProposal,
  deps: ApplyDeps = {},
): Promise<ApplyResult> {
  try {
    const risk = classifyProposalRisk({
      kind: proposal.kind,
      changeJson: proposal.changeJson,
      external: proposal.external,
    });
    if (risk === 'high') {
      logger.info(
        `[org-proposal-apply] refused '${proposal.id}' (kind=${proposal.kind}) — classified high-risk`,
      );
      return { status: 'refused-high-risk' };
    }

    const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
    let change: unknown;
    try {
      change = proposal.changeJson ? JSON.parse(proposal.changeJson) : null;
    } catch (err) {
      logger.warn(
        `[org-proposal-apply] malformed changeJson for '${proposal.id}' (non-fatal): ${String(err)}`,
      );
      return { status: 'skipped', reason: 'malformed-change-json' };
    }

    if (isDirectAgentConfigScopePayload(change)) {
      logger.info(
        `[org-proposal-apply] refused direct scope payload for '${proposal.id}' — human approval required`,
      );
      return { status: 'refused-high-risk' };
    }

    // #852 — consolidate-skill: scope_hygiene_generator.ts only ever emits
    // the pairing shape ({skillIdA, skillIdB, titleA, titleB, similarity}),
    // never a pre-drafted body. Draft it HERE, at apply time, so the
    // resulting change_json is already a BodyRefinementChange by the time
    // the proposal reaches 'measuring' (see skill_consolidation_drafter.ts
    // module doc for why apply-time is the right place: it is the one point
    // both the auto lane and a future human-approved lane pass through).
    if (proposal.kind === 'consolidate-skill' && isConsolidationPairingChange(change)) {
      return await applyConsolidateSkillChange(proposal, change, {
        proposalsRepo,
        skillsRepo: deps.skillsRepo,
      });
    }

    // Non-scope kinds (refine-skill/refine-recipe; consolidate-skill already
    // pre-drafted above): the
    // change payload already carries its own prior/revised bodies (see
    // module doc comment). Snapshot the whole payload as before_snapshot_json
    // verbatim — the measure step (#821 org_proposal_measure.ts) reads the
    // prior body back out of it — and move straight to measuring.
    const updated = await proposalsRepo.updateStatusAsync(proposal.id, 'applied', {
      beforeSnapshotJson: proposal.changeJson ?? JSON.stringify({}),
    });
    if (!updated) {
      return { status: 'skipped', reason: 'proposal-not-found' };
    }
    await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');

    logger.info(`[org-proposal-apply] applied '${proposal.id}' (kind=${proposal.kind}) -> measuring`);
    return { status: 'applied-ok' };
  } catch (err) {
    logger.warn(`[org-proposal-apply] FAILED (non-fatal): ${String(err)}`);
    return { status: 'skipped', reason: String(err) };
  }
}

/** Shape of the before_snapshot_json a consolidate-skill apply writes (#852). */
interface ConsolidateSkillRevertSnapshot {
  survivorSkillId: string;
  survivorPriorBody: string | null;
  survivorPriorStatus: string;
  retiredSkillId: string;
  retiredPriorBody: string | null;
  retiredPriorStatus: string;
}

function isConsolidateSkillRevertSnapshot(v: unknown): v is ConsolidateSkillRevertSnapshot {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.survivorSkillId === 'string' && typeof c.retiredSkillId === 'string';
}

/** Shape of the before_snapshot_json the external-adoption skill applier writes (Stage B). */
interface ExternalAdoptionRevertSnapshot {
  externalAdoption: true;
  adoptedSkillName: string;
  skillWasAbsent: boolean;
  agentConfigId: string | null;
  priorAllowedSkillsJson: string | null;
}

function isExternalAdoptionRevertSnapshot(v: unknown): v is ExternalAdoptionRevertSnapshot {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return c.externalAdoption === true && typeof c.adoptedSkillName === 'string';
}

/**
 * The tools-map form of a scope column ({"server":[...]|null}), or null when the
 * value is absent, an array, or unparseable (the array path handles those).
 */
function parseScopeMap(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function safeParseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * #852 — Apply a consolidate-skill proposal: resolve both source skills,
 * draft the merged body (skill_consolidation_drafter.ts), write it onto the
 * SURVIVOR (skill A) immediately, retire the redundant skill (skill B,
 * `status='retired'`) immediately, snapshot BOTH skills' pre-merge state
 * into `before_snapshot_json`, reshape `change_json` into the
 * `BodyRefinementChange` shape `org_proposal_measure.ts` recognizes, and
 * transition to `measuring`.
 *
 * Applying the merge (and the retirement) up front — rather than waiting for
 * the measure step to decide — mirrors the `refine-skill` precedent (the
 * skill loop applies before `org_proposal_apply` runs; see this module's
 * doc comment) and is what makes `measureBodyRefinement`'s "score priorBody
 * vs revisedBody" comparison meaningful: `priorBody` is scored as a
 * completely separate concern (the score call takes an explicit body
 * argument, it does not read the live skill), so applying early has no
 * effect on the measure comparison itself, only on how quickly the merge is
 * visible if a caller reads the live skill mid-`measuring`.
 *
 * A missing source skill (deleted since the proposal was generated) is a
 * skip, not a failure — the pairing signal is now stale.
 */
async function applyConsolidateSkillChange(
  proposal: AgentOrgProposal,
  change: { skillIdA: string; skillIdB: string },
  deps: { proposalsRepo: AgentOrgProposalsRepository; skillsRepo?: AgentSkillsRepository },
): Promise<ApplyResult> {
  const { proposalsRepo } = deps;
  const skillsRepo = deps.skillsRepo ?? new AgentSkillsRepository();

  const skillA = skillsRepo.getById(change.skillIdA);
  const skillB = skillsRepo.getById(change.skillIdB);
  if (!skillA || !skillB) {
    logger.warn(
      `[org-proposal-apply] consolidate-skill '${proposal.id}' references a missing skill (a=${change.skillIdA}, b=${change.skillIdB}) — skipping`,
    );
    return { status: 'skipped', reason: 'target-not-found' };
  }

  const drafted: DraftedConsolidationPayload = draftConsolidationPayload(skillA, skillB);

  // Snapshot BOTH skills' pre-merge state — the survivor's prior body/status
  // AND the retired skill's full row content — so revert can restore both.
  const beforeSnapshot = JSON.stringify({
    survivorSkillId: drafted.survivorSkillId,
    survivorPriorBody: skillA.body ?? null,
    survivorPriorStatus: skillA.status,
    retiredSkillId: drafted.retiredSkillId,
    retiredPriorBody: drafted.retiredPriorBody,
    retiredPriorStatus: drafted.retiredPriorStatus,
  });

  // The BodyRefinementChange-shaped payload measureBodyRefinement will read,
  // PLUS the retirement metadata a later revert needs (additive fields the
  // measure step's isBodyRefinementChange()/measureBodyRefinement() simply
  // ignore — see skill_consolidation_drafter.ts's DraftedConsolidationPayload
  // doc comment).
  const draftedChangeJson = JSON.stringify(drafted);

  // 1. Snapshot + reshape change_json FIRST — reversible by construction.
  const snapshotted = await proposalsRepo.updateStatusAsync(proposal.id, 'applied', {
    beforeSnapshotJson: beforeSnapshot,
    changeJson: draftedChangeJson,
  });
  if (!snapshotted) {
    return { status: 'skipped', reason: 'proposal-not-found' };
  }

  // 2. Mutate the live skills: write the merged body onto the survivor,
  //    retire the redundant one. Never throws — a write failure here is
  //    reported as skipped (the snapshot already recorded above still makes
  //    a later best-effort revert possible for whichever half succeeded).
  try {
    skillsRepo.update(drafted.survivorSkillId, { body: drafted.revisedBody });
    skillsRepo.update(drafted.retiredSkillId, { status: 'retired' });
  } catch (err) {
    logger.warn(
      `[org-proposal-apply] consolidate-skill '${proposal.id}' failed writing merged/retired skills (non-fatal): ${String(err)}`,
    );
    return { status: 'skipped', reason: 'skill-write-failed' };
  }

  // 3. Advance to measuring.
  await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');

  logger.info(
    `[org-proposal-apply] applied consolidate-skill for '${proposal.id}' (survivor=${drafted.survivorSkillId}, retired=${drafted.retiredSkillId}) -> measuring`,
  );
  return { status: 'applied-ok' };
}

export type RevertOutcome = 'reverted' | 'skipped' | 'conflict' | 'unsafe-legacy-scope';

/** Audit fields the measure step may want persisted alongside the revert transition. */
export interface RevertPatch {
  baselineScore?: number | null;
  postScore?: number | null;
  measureReason?: string | null;
}

/**
 * Restore a measuring proposal to its `before_snapshot_json` state and mark
 * it `reverted`. NEVER throws. The row is retained (not deleted) so the
 * dedup guard continues to treat the change as seen. `patch` (optional) is
 * applied in the SAME update that performs the status transition, so a
 * caller (e.g. the LLM-scored measure step) can persist baseline/post scores
 * and a reason atomically with the revert.
 */
export async function revertProposal(
  proposal: AgentOrgProposal,
  deps: ApplyDeps = {},
  patch?: RevertPatch,
): Promise<RevertOutcome> {
  try {
    const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
    const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();
    const isScopeRemovalKind = proposal.kind === 'tighten-scope' || proposal.kind === 'prune-scope';

    if (!proposal.beforeSnapshotJson) {
      logger.warn(`[org-proposal-apply] no before_snapshot_json for '${proposal.id}' — cannot revert`);
      return isScopeRemovalKind ? 'unsafe-legacy-scope' : 'skipped';
    }

    let snapshot: Record<string, unknown>;
    try {
      snapshot = JSON.parse(proposal.beforeSnapshotJson);
    } catch (err) {
      logger.warn(`[org-proposal-apply] unparseable snapshot for '${proposal.id}': ${String(err)}`);
      return isScopeRemovalKind ? 'unsafe-legacy-scope' : 'skipped';
    }

    let change: unknown = null;
    try {
      change = proposal.changeJson ? JSON.parse(proposal.changeJson) : null;
    } catch {
      change = null;
    }

    if (isScopeRemovalKind && !isScopeDeltaV2Snapshot(snapshot)) {
      logger.warn(`[org-proposal-apply] refusing invalid/legacy scope revert for '${proposal.id}'`);
      return 'unsafe-legacy-scope';
    }

    if (isScopeDeltaV2Snapshot(snapshot)) {
      if (!scopeDeltaIntegrityHolds(snapshot)) {
        logger.warn(`[org-proposal-apply] scope snapshot integrity conflict for '${proposal.id}'`);
        return 'conflict';
      }
      if (hashScopeValue(snapshot.expectedAppliedValue) !== snapshot.expectedAppliedHash) {
        logger.warn(`[org-proposal-apply] scope snapshot integrity conflict for '${proposal.id}'`);
        return 'conflict';
      }
      if (!scopeDeltaMatchesChangeJson(snapshot, change)) {
        logger.warn(`[org-proposal-apply] scope snapshot/change_json target mismatch for '${proposal.id}'`);
        return 'conflict';
      }
      const restoredValue = invertScopeDelta(snapshot);
      if (restoredValue === null) return 'conflict';
      const restored = configsRepo.compareAndSetScopeField(
        snapshot.target.id,
        snapshot.field,
        snapshot.expectedAppliedValue,
        restoredValue,
      );
      if (!restored) {
        logger.warn(`[org-proposal-apply] scope CAS conflict for '${proposal.id}'`);
        return 'conflict';
      }
      const projection = writeAgentProfileFile(restored);
      if (projection === 'blocked' || projection === 'failed') {
        const compensated = configsRepo.compareAndSetScopeField(
          snapshot.target.id,
          snapshot.field,
          restoredValue,
          snapshot.expectedAppliedValue,
        );
        logger.warn(
          `[org-proposal-apply] scope revert projection ${projection} for '${proposal.id}'; ` +
          (compensated
            ? 'restored the exact applied scope'
            : 'compensation lost a concurrent update; reconciliation required'),
        );
        return 'conflict';
      }
    } else if (proposal.kind === 'external-adoption' && isExternalAdoptionRevertSnapshot(snapshot)) {
      // Undo the adopt: remove the skill we wrote (only if WE created it —
      // never delete a pre-existing engine-owned library skill), and restore
      // the agent's prior allowlist + resync its file. The capability-gap is
      // left `open` (measure only resolves it on a keep) so a later run can try
      // again.
      if (snapshot.skillWasAbsent && snapshot.adoptedSkillName) {
        deleteManagedSkill(snapshot.adoptedSkillName);
      }
      if (snapshot.agentConfigId) {
        configsRepo.update(snapshot.agentConfigId, {
          allowedSkillsJson: snapshot.priorAllowedSkillsJson ?? null,
        });
        const restored = configsRepo.getById(snapshot.agentConfigId);
        if (restored) writeAgentProfileFile(restored);
      }
    } else if (
      isConfigFieldSnapshot(snapshot) &&
      (snapshot.field === 'allowedMcpsJson' || snapshot.field === 'allowedSkillsJson')
    ) {
      logger.warn(`[org-proposal-apply] refusing legacy whole-field scope revert for '${proposal.id}'`);
      return 'unsafe-legacy-scope';
    } else if (isConfigFieldSnapshot(snapshot)) {
      // #971 — refine-config (scalar swap) AND refine-scope (add/remove) both
      // snapshot {agentConfigId, field, priorValue}; restore the field to its
      // prior value and re-project the opencode agent file the same way the
      // REST config-update path does after any config mutation.
      configsRepo.update(snapshot.agentConfigId, agentConfigFieldPatch(snapshot.field, snapshot.priorValue));
      const restored = configsRepo.getById(snapshot.agentConfigId);
      if (restored) writeAgentProfileFile(restored);
    } else if (isScheduledTaskFieldSnapshot(snapshot)) {
      // #981 — refine-task: restore the scheduled-task field the applier
      // overwrote to its exact prior value via updateAsync (no raw SQL).
      const tasksRepo = deps.tasksRepo ?? new AgentScheduledTasksRepository();
      await tasksRepo.updateAsync(
        snapshot.scheduledTaskId,
        scheduledTaskFieldPatch(snapshot.field, snapshot.priorValue),
      );
    } else if (isDirectAgentConfigScopePayload(change)) {
      // Legacy auto-scope snapshots replayed a whole field. Without an exact
      // post-apply value they cannot distinguish safe rollback from clobbering
      // a later operator edit, so they fail closed.
      logger.warn(`[org-proposal-apply] refusing legacy whole-field scope revert for '${proposal.id}'`);
      return 'unsafe-legacy-scope';
    } else if (proposal.kind === 'consolidate-skill' && isConsolidateSkillRevertSnapshot(snapshot)) {
      // #852 — restore BOTH skills to their exact pre-merge state: the
      // survivor's original body/status, and the retired skill's original
      // body/status (undoing the retirement, not just the body write).
      const skillsRepo = deps.skillsRepo ?? new AgentSkillsRepository();
      skillsRepo.update(snapshot.survivorSkillId, {
        body: snapshot.survivorPriorBody,
        status: snapshot.survivorPriorStatus,
      });
      skillsRepo.update(snapshot.retiredSkillId, {
        body: snapshot.retiredPriorBody,
        status: snapshot.retiredPriorStatus,
      });
    } else if (
      (proposal.kind === 'workflow-prompt-fix' || proposal.kind === 'refine-skill') &&
      isSkillBodyRevertSnapshot(snapshot)
    ) {
      // #971 / #976 / #1082 — restore the DB and managed file from their
      // separate pre-apply snapshots. The file is authoritative and is
      // restored as raw bytes so custom frontmatter and whitespace survive.
      const skillsRepo = deps.skillsRepo ?? new AgentSkillsRepository();
      const priorDbBody =
        snapshot.priorDbBody !== undefined ? snapshot.priorDbBody : snapshot.priorBody;
      skillsRepo.update(snapshot.skillId, {
        body: priorDbBody,
        status: snapshot.priorStatus,
      });
      const skill = skillsRepo.getById(snapshot.skillId);
      if (skill) {
        try {
          if (snapshot.managedFileWasPresent === true) {
            restoreManagedSkillBytes(
              skill.title,
              Buffer.from(snapshot.managedFileBytesBase64!, 'base64'),
            );
          } else {
            // Legacy snapshots and #1082's explicit missing-file case both
            // recreate a managed file from the semantic snapshot. Crucially,
            // this fallback is never used when an original file was present.
            writeManagedSkill({
              name: skill.title,
              description: skill.description ?? undefined,
              body: snapshot.priorBody ?? priorDbBody ?? '',
            });
          }
        } catch (err) {
          logger.warn(`[org-proposal-apply] revert: managed-skill restore failed for '${skill.title}' (non-fatal): ${String(err)}`);
        }
      }
    }
    // Other non-scope kinds (refine-recipe) carry no live-system side effect to
    // undo here; reverting the proposal's OWN status is still the correct
    // action for the dedup guard.

    await proposalsRepo.updateStatusAsync(proposal.id, 'reverted', patch);
    logger.info(`[org-proposal-apply] reverted '${proposal.id}' (kind=${proposal.kind})`);
    return 'reverted';
  } catch (err) {
    logger.warn(`[org-proposal-apply] revert FAILED (non-fatal): ${String(err)}`);
    return 'skipped';
  }
}
