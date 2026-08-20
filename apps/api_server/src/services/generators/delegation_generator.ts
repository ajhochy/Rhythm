/**
 * delegation_generator.ts — #825 (org-optimizer-09)
 *
 * Produces `grant-delegation` / `expand-delegation` proposals when a manager
 * profile is repeatedly redoing work that belongs to an existing specialist,
 * or has abandoned a delegable sub-task it could have handed off. Both kinds
 * are HIGH risk per `org_risk_classifier.ts` (`grant-delegation` and
 * `expand-delegation` are in `HIGH_RISK_KINDS`) — this generator NEVER
 * auto-applies; it only ever produces `status: 'proposed'` rows for the
 * human review queue (org-optimizer-10, #826).
 *
 * Signal shape (`DelegationRedoSignal`) is intentionally NOT sourced from
 * `org_audit_service.ts` — that module's `OrgAuditGap.kind` union
 * (`'prune-scope' | 'tighten-scope' | 'webhook-wiring'`) does not yet cover a
 * delegation-redo signal, and this issue's ownership is scoped to this file
 * only (no edits to org_audit_service.ts). The signal is instead an
 * injectable input this generator consumes — the eventual caller (the
 * optimizer loop, wired in a later issue) is responsible for detecting
 * "manager repeatedly redoing specialist work" from session/task history and
 * shaping it into this input.
 *
 * Two acceptance-critical guards, both re-checked here at PROPOSAL time
 * (§AC2/AC3) and AGAIN at APPLY time by {@link registerDelegationApplier}
 * (§AC4), because a proposal can sit in the human queue for a while and the
 * org can change underneath it:
 *
 *   - Target eligibility: only existing, enabled, `isAgent` configs; never
 *     the manager itself (no self-delegation); never an edge that would put
 *     the manager beyond `MAX_DELEGATION_DEPTH` (mirrors
 *     `agent_delegation_service.ts`'s cap of 2 — see
 *     docs/ai/decisions/2026-06-25-delegation-depth.md). This module cannot
 *     import that constant (it is not exported and this issue's ownership
 *     forbids editing agent_delegation_service.ts), so the same value is
 *     re-declared here with an explicit citation; a future change to the cap
 *     must update both call sites.
 *   - Manager-only target_ref: only a profile with `isManager === true` is a
 *     valid proposal `target_ref` — a non-manager signal never produces a
 *     delegation proposal, because a non-manager has no `allowed_delegates_json`
 *     to grant/expand in the first place.
 */

import { AppError } from '../../errors/app_error';
import {
  AgentConfigsRepository,
  agentConfigExecutionBlockReason,
  type AgentConfig,
} from '../../repositories/agent_configs_repository';
import type { AgentOrgProposal } from '../../models/agent_org_proposal';
import type { ProposalApplier, ProposalApplyResult } from '../org_proposal_apply_service';

/**
 * Mirrors `agent_delegation_service.ts`'s MAX_DELEGATION_DEPTH. See the
 * module doc comment above for why this cannot be imported directly.
 */
const MAX_DELEGATION_DEPTH = 2;

/**
 * A detected signal: `managerConfigId` has repeatedly redone work that
 * `specialistConfigId` could have handled, or abandoned a delegable
 * sub-task matching that specialist's scope. `occurrences` is the evidence
 * count (session ids / redo counts) the caller collected; it is carried
 * through into the proposal's `rationale` / `signalRef` but this generator
 * does not itself impose a minimum threshold — that policy belongs to
 * whatever detector produces the signal.
 */
export interface DelegationRedoSignal {
  /** The manager profile that should gain (or expand) a delegation edge. */
  managerConfigId: string;
  /** The specialist profile the manager should be allowed to delegate to. */
  specialistConfigId: string;
  /** Evidence count backing the signal (e.g. redo/abandon occurrences). */
  occurrences: number;
  /** Human-readable evidence string, carried into signal_ref. */
  evidence: string;
}

export interface GeneratedDelegationProposal {
  kind: 'grant-delegation' | 'expand-delegation';
  risk: 'high';
  title: string;
  rationale: string;
  signalRef: string;
  /** Always the manager config — delegation proposals never target the specialist. */
  targetRef: string;
  /** `{ agentConfigId, add: string[] }` — the target id(s) to add to allowed_delegates_json. */
  changeJson: string;
  dedupKey: string;
}

interface ParsedAllowedDelegates {
  set: Set<string>;
}

function parseAllowedDelegates(json: string | null): ParsedAllowedDelegates {
  if (!json) return { set: new Set() };
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return { set: new Set() };
    return {
      set: new Set(
        parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== ''),
      ),
    };
  } catch {
    return { set: new Set() };
  }
}

/**
 * Compute the manager's structural depth in the CURRENT delegation graph:
 * the length of the longest chain of `allowed_delegates_json` edges that
 * terminates at `managerId` when walked backwards (i.e. how many hops
 * `managerId` already is from a top-level manager nobody delegates to). A
 * manager nobody delegates to is depth 0 (mirrors `agent_delegation_service`'s
 * "root caller starts at depth 0"). This is deliberately derived from the
 * LIVE graph (never from caller-supplied input) because depth is a
 * structural property of `agent_configs` rows, and trusting an untrusted
 * `managerDepth` field would let a crafted signal bypass the depth cap.
 *
 * Cycle-safe: a `visiting` set prevents infinite recursion if the graph
 * (incorrectly) contains a cycle; a node caught mid-cycle contributes 0 extra
 * hops from that branch rather than looping.
 */
function computeManagerDepth(managerId: string, allConfigs: AgentConfig[]): number {
  const byId = new Map(allConfigs.map((c) => [c.id, c]));

  function depthOf(id: string, visiting: Set<string>): number {
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let maxParentDepth = -1;
    for (const config of allConfigs) {
      const { set: delegates } = parseAllowedDelegates(config.allowedDelegatesJson);
      if (delegates.has(id) && byId.has(config.id)) {
        maxParentDepth = Math.max(maxParentDepth, depthOf(config.id, visiting));
      }
    }
    return maxParentDepth + 1;
  }

  return depthOf(managerId, new Set());
}

/**
 * Eligibility guard shared by proposal-time generation and apply-time
 * re-validation: a target must exist, be enabled, be `isAgent`, must not be
 * the manager itself, and granting the edge must not put the manager's own
 * structural depth (see {@link computeManagerDepth}) at or beyond the cap —
 * i.e. the manager must have room for at least one more delegation hop
 * beneath it.
 */
function isEligibleTarget(
  manager: AgentConfig,
  target: AgentConfig | null,
  managerDepth: number,
): { eligible: boolean; reason?: string } {
  if (!target) return { eligible: false, reason: 'target profile does not exist' };
  if (target.id === manager.id) {
    return { eligible: false, reason: 'self-delegation is not allowed' };
  }
  const blockReason = agentConfigExecutionBlockReason(target);
  if (blockReason) return { eligible: false, reason: blockReason };
  if (!target.isAgent) return { eligible: false, reason: 'target profile is not an agent' };
  if (managerDepth >= MAX_DELEGATION_DEPTH) {
    return { eligible: false, reason: 'delegation depth limit exceeded' };
  }
  return { eligible: true };
}

/**
 * Generate delegation proposals from a batch of redo/abandon signals.
 *
 * Per-signal rules (all fail-closed — an ineligible signal produces NO
 * proposal, never a degraded one):
 *   - The manager MUST have `isManager === true` (AC3: only managers are
 *     valid `target_ref`s; a non-manager signal is silently skipped).
 *   - The target specialist must pass {@link isEligibleTarget} (AC2).
 *   - `kind` is `expand-delegation` if the specialist id is already present
 *     in the manager's `allowedDelegatesJson` (edge exists but under-used /
 *     needs reinforcement is out of this generator's evidence model, so in
 *     practice this only fires when the caller's signal detector already
 *     knows the edge exists yet redo is still happening); otherwise
 *     `grant-delegation` (no edge yet).
 *   - `risk` is always `'high'` — both kinds are in `HIGH_RISK_KINDS`
 *     (org_risk_classifier.ts); this generator hardcodes it rather than
 *     calling the classifier so the acceptance criterion ("one ... proposal
 *     (HIGH)") holds even if this module is ever exercised standalone.
 */
export function generateDelegationProposals(
  signals: DelegationRedoSignal[],
  configs: AgentConfig[],
): GeneratedDelegationProposal[] {
  const byId = new Map(configs.map((c) => [c.id, c]));
  const proposals: GeneratedDelegationProposal[] = [];

  for (const signal of signals) {
    const manager = byId.get(signal.managerConfigId);
    if (!manager) continue; // unknown manager — no evidence to act on
    if (!manager.isManager) continue; // AC3: non-managers never get a delegation proposal

    const target = byId.get(signal.specialistConfigId) ?? null;
    const managerDepth = computeManagerDepth(manager.id, configs);
    const { eligible } = isEligibleTarget(manager, target, managerDepth);
    if (!eligible || !target) continue; // AC2: ineligible target — no proposal

    const { set: existingDelegates } = parseAllowedDelegates(manager.allowedDelegatesJson);
    const kind: GeneratedDelegationProposal['kind'] = existingDelegates.has(target.id)
      ? 'expand-delegation'
      : 'grant-delegation';

    const verb = kind === 'grant-delegation' ? 'Grant' : 'Expand';
    proposals.push({
      kind,
      risk: 'high',
      title: `${verb} delegation: ${manager.label} -> ${target.label}`,
      rationale: `${manager.label} has repeatedly redone or abandoned work matching ${target.label}'s scope (${signal.occurrences} occurrence(s)). ${verb === 'Grant' ? 'Granting' : 'Expanding'} delegation would let ${manager.label} hand this work to ${target.label} directly.`,
      signalRef: signal.evidence,
      // Delegation proposals always target the MANAGER config — the change
      // is a mutation of the manager's own allowed_delegates_json, never the
      // specialist's row.
      targetRef: `agent_config:${manager.id}`,
      changeJson: JSON.stringify({
        agentConfigId: manager.id,
        // NOTE: this key name is intentionally `allowed_delegates_json` (not
        // `add`) so org_risk_classifier.ts's change-shape hard-rule override
        // (`changeShapeIsHardRuledHigh`) independently forces this payload to
        // HIGH even if some future caller mislabels `kind` — see
        // org_risk_classifier.ts's ParsedChange.allowed_delegates_json.
        allowed_delegates_json: { add: [target.id] },
      }),
      dedupKey: `${kind}:${manager.id}:${target.id}`,
    });
  }

  return proposals;
}

// ── Apply-time re-validation + write (registered into org_proposal_apply_service) ──

interface DelegationChangePayload {
  agentConfigId: string;
  allowed_delegates_json: { add: string[] };
}

function parseChangePayload(changeJson: string | null): DelegationChangePayload | null {
  if (!changeJson) return null;
  try {
    const parsed: unknown = JSON.parse(changeJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.agentConfigId !== 'string' || !obj.agentConfigId.trim()) return null;
    const addBlock = obj.allowed_delegates_json;
    if (!addBlock || typeof addBlock !== 'object' || Array.isArray(addBlock)) return null;
    const add = (addBlock as Record<string, unknown>).add;
    if (!Array.isArray(add) || add.some((v) => typeof v !== 'string')) return null;
    return { agentConfigId: obj.agentConfigId, allowed_delegates_json: { add: add as string[] } };
  } catch {
    return null;
  }
}

/**
 * Registry seam this module plugs into (`org_proposal_apply_service.ts`'s
 * `registerProposalApplier`). Typed narrowly here (rather than importing the
 * whole module) so this file only depends on the specific function shape it
 * needs — kept intentionally structural to avoid a circular import between
 * the generator and the apply-service registry module.
 */
export interface DelegationApplierRegistry {
  registerProposalApplier(kind: string, applier: ProposalApplier): void;
}

/**
 * Register the `grant-delegation` / `expand-delegation` apply step into the
 * given registry (normally `org_proposal_apply_service.ts`, imported by
 * whichever bootstrap wires generators — the #830 round, per this issue's
 * ownership notes; this file must not import/edit that module's control flow
 * itself beyond the registry interface).
 *
 * AC4 — "Never auto-applied; apply (on approval) edits allowed_delegates_json
 * via the repo and RE-VALIDATES auth rules + depth at apply time (not just
 * proposal time)": the applier re-runs the exact same eligibility guard
 * ({@link isEligibleTarget}) plus the manager's `isManager` check against the
 * CURRENT state of `agent_configs` — never trusting whatever was true when
 * the proposal was created. A proposal that was valid at proposal time but
 * has since drifted (target disabled, manager demoted, depth now exceeded,
 * or — defense in depth — a malformed/tampered change payload naming the
 * manager itself as the target) is refused, not silently applied.
 */
export function registerDelegationApplier(
  registry: DelegationApplierRegistry,
  deps: { configsRepo?: AgentConfigsRepository } = {},
): void {
  const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();

  const applier: ProposalApplier = (proposal: AgentOrgProposal): ProposalApplyResult => {
    const payload = parseChangePayload(proposal.changeJson);
    if (!payload) {
      throw AppError.badRequest('delegation proposal change_json is malformed or missing');
    }

    const manager = configsRepo.getById(payload.agentConfigId);
    if (!manager) {
      throw AppError.badRequest('delegation proposal target manager profile does not exist');
    }
    if (!manager.isManager) {
      throw AppError.forbidden('manager profile is no longer a manager; delegation refused');
    }

    const beforeSnapshotJson = JSON.stringify({
      agentConfigId: manager.id,
      field: 'allowedDelegatesJson',
      priorValue: manager.allowedDelegatesJson,
    });

    const { set: existingDelegates } = parseAllowedDelegates(manager.allowedDelegatesJson);
    const nextDelegates = new Set(existingDelegates);
    const allConfigs = configsRepo.list();
    const managerDepth = computeManagerDepth(manager.id, allConfigs);

    for (const targetId of payload.allowed_delegates_json.add) {
      const target = configsRepo.getById(targetId);
      const { eligible, reason } = isEligibleTarget(manager, target, managerDepth);
      if (!eligible) {
        throw AppError.forbidden(
          `delegation target '${targetId}' failed apply-time re-validation: ${reason ?? 'ineligible'}`,
        );
      }
      nextDelegates.add(targetId);
    }

    configsRepo.update(manager.id, {
      allowedDelegatesJson: JSON.stringify([...nextDelegates]),
    });

    return {
      measurable: false,
      beforeSnapshotJson,
      postApplyTarget: { profileId: manager.id, changeType: 'tool' },
    };
  };

  registry.registerProposalApplier('grant-delegation', applier);
  registry.registerProposalApplier('expand-delegation', applier);
}
