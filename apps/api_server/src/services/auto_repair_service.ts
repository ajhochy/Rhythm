/**
 * D2.3 (#1433) — the bounded 3-strike auto-repair service.
 *
 * Covers: attempt 1 succeeding leaves the original change in place with the
 * repair recorded; attempt 1 failing tries attempt 2 (and a subsequent
 * success stops there); all 3 attempts failing triggers auto-revert (D2.4
 * stub); every attempt is recorded in PostApplyEvent; no raw secrets in the
 * evidence handed to the diagnosis pipeline.
 *
 * Each attempt: (1) call the injected `diagnose` (the #971 LLM-diagnosis
 * lane's `DiagnoseCall` contract) for a fresh fix, (2) for a `config-change`
 * diagnosis, re-resolve `configPatch.agentConfigId` server-side (the LLM's
 * emitted id is NEVER trusted — mirrors `workflow_signal_generator.ts`'s
 * `resolveConfigPatch`), record a real `refine-config` proposal, and mutate
 * the live `agent_configs` row, (3) claim the proposal `applied` through
 * `AgentOrgProposalsRepository.claimAppliedWithSnapshotAsync` — the same
 * optimistic-concurrency (CAS) primitive `OrgProposalsController.approve()`
 * uses for a human-approved apply, (4) re-check the guardrail: does an error
 * outcome exist at/after THIS attempt's own re-check floor
 * (`now + attempt * REPAIR_RECHECK_EPSILON_MS`, strictly increasing per
 * attempt so a fix's own after-effects are what get judged, never a stale
 * breach an earlier attempt already failed against).
 */

import { AgentConfigsRepository, type AgentConfigInput } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import { PostApplyEventsRepository } from '../repositories/post_apply_events_repository';
import { MAX_REPAIR_ATTEMPTS, type PostApplyEvent } from '../models/post_apply_event';
import { classifyProposalRisk } from './org_risk_classifier';
import { agentConfigFieldPatch, readAgentConfigField } from './org_proposal_apply';
import { resolveProfileMcpScope } from './agent_profile_scope';
import { resolveCoreCapabilitySurface } from './profile_capability_surface';
import {
  diagnosisToProposalKind,
  type DiagnoseCall,
  type DiagnosisContext,
} from './generators/workflow_signal_generator';
import { CONFIG_PATCH_FIELDS, type ConfigPatch, type DiagnosisResult } from './org_diagnosis_types';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Global auto-revert trigger registry (D2.5 / D2.4 boundary)
// ---------------------------------------------------------------------------

type AutoRevertTrigger = (props: { proposalId: string }) => Promise<void> | void;

let globalAutoRevertTrigger: AutoRevertTrigger | undefined;

export function registerAutoRevertTrigger(
  trigger: AutoRevertTrigger,
): void {
  globalAutoRevertTrigger = trigger;
}

export function resetAutoRevertTriggerForTests(): void {
  globalAutoRevertTrigger = undefined;
}

// ---------------------------------------------------------------------------
// Guardrail re-check timing
// ---------------------------------------------------------------------------

/**
 * ponytail: global lock-style constant, not a real monitoring wait. Each
 * attempt's re-check floor advances by this many ms so a breach an EARLIER
 * attempt already failed against never gets re-blamed on a LATER attempt's
 * fix — the only property that matters is that it strictly increases per
 * attempt. Upgrade to the real `DEFAULT_MONITORING_WINDOW_MS` wait (D2.2) if
 * this lane ever needs a genuine wall-clock cool-down between attempts.
 */
const REPAIR_RECHECK_EPSILON_MS = 1;

/** System actor id for a fully-automated apply — mirrors `LOCAL_OPERATOR_ACTOR_ID` in org_proposals_controller.ts. */
const AUTO_REPAIR_ACTOR_ID = 0;

/**
 * Re-resolve a (fully untrusted) `configPatch` and pin its `agentConfigId` to
 * the event's own failing profile — never the LLM-emitted id. Returns
 * undefined on any malformed shape or if the target profile no longer
 * exists. Mirrors `workflow_signal_generator.ts`'s unexported
 * `resolveConfigPatch` (duplicated rather than exported — that module's
 * control flow is intentionally untouched by this issue).
 */
function resolveRepairConfigPatch(
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

/**
 * Build the `AgentConfigsRepository.update()` patch for a resolved
 * `ConfigPatch`. ponytail: `model` is stored verbatim (no provider/model
 * split like the human-approved `refine-config` applier's
 * `agentConfigFieldPatch` does) — this lane's diagnosis always emits a
 * single `provider/model` identifier string and nothing downstream of an
 * auto-repair reads `modelProvider` separately; upgrade to the shared split
 * if that ever changes.
 */
function buildRepairConfigUpdate(patch: ConfigPatch): Partial<AgentConfigInput> {
  if (patch.field === 'model') return { modelProvider: null, modelId: patch.value };
  return agentConfigFieldPatch(patch.field, patch.value);
}

/** Build the full `DiagnosisContext` the #971 diagnosis lane's `DiagnoseCall` contract requires. */
function buildRepairDiagnosisContext(
  profileId: string,
  configsRepo: AgentConfigsRepository,
): DiagnosisContext {
  const agentConfig = configsRepo.getById(profileId) ?? null;
  return {
    affectedSkill: profileId,
    // No workflow-failure-signal evidence feeds this lane — it is triggered
    // by a post-apply guardrail trip (D2.2), a different signal source.
    signals: [],
    profile: null,
    agentConfig,
    mcpScope: resolveProfileMcpScope(
      agentConfig?.allowedMcpsJson ?? null,
      profileId,
      agentConfig?.label ?? null,
    ),
    coreCapabilities: agentConfig ? resolveCoreCapabilitySurface(agentConfig) : { actions: {}, granted: [] },
    skillBody: null,
    deniedTools: [],
    delegationOutbound: [],
    delegationInbound: [],
    priorAttempts: [],
  };
}

// ---------------------------------------------------------------------------
// runAutoRepairAsync
// ---------------------------------------------------------------------------

export interface RunAutoRepairAsyncOptions {
  diagnosis: { diagnose: DiagnoseCall; configsRepo: AgentConfigsRepository };
  /** Defaults to `new Date()`. */
  now?: Date;
  /** Per-call override for the global trigger registered via {@link registerAutoRevertTrigger}. */
  triggerAutoRevert?: AutoRevertTrigger;
}

export interface RunAutoRepairAsyncResult {
  outcome: 'repaired' | 'exhausted' | 'deferred' | 'not-tripped';
  attempts: number;
  event: PostApplyEvent;
}

/**
 * Run the bounded 3-strike repair loop for one currently-`tripped`
 * PostApplyEvent. A no-op (0 attempts) when the event isn't tripped.
 */
export async function runAutoRepairAsync(
  event: PostApplyEvent,
  { diagnosis, now = new Date(), triggerAutoRevert }: RunAutoRepairAsyncOptions,
): Promise<RunAutoRepairAsyncResult> {
  if (event.guardrailStatus !== 'tripped') {
    return { outcome: 'not-tripped', attempts: 0, event };
  }

  const { diagnose, configsRepo } = diagnosis;
  const eventsRepo = new PostApplyEventsRepository();
  const proposalsRepo = new AgentOrgProposalsRepository();
  const outcomesRepo = new AgentRunOutcomesRepository();

  const repairIds: string[] = [];
  let latestEvent = event;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    const ctx = buildRepairDiagnosisContext(event.profileId, configsRepo);
    let result: DiagnosisResult | null;
    try {
      result = await diagnose(ctx);
    } catch {
      // A transient engine/provider failure is not evidence that the applied
      // change is bad. Leave the event tripped for a later scheduler sweep.
      return { outcome: 'deferred', attempts: attempt - 1, event: latestEvent };
    }

    if (result && result.fixType === 'config-change') {
      const patch = resolveRepairConfigPatch(result.configPatch, event.profileId, configsRepo);
      if (patch) {
        const kind = diagnosisToProposalKind(result) ?? 'refine-config';
        const auditChangeJson = JSON.stringify({
          source: 'auto-repair-service',
          profileId: event.profileId,
          field: patch.field,
          valueSha256: createHash('sha256').update(patch.value).digest('hex'),
        });

        const proposal = await proposalsRepo.createAsync({
          kind,
          risk: classifyProposalRisk({ kind, changeJson: auditChangeJson }),
          status: 'proposed',
          title: `Post-apply repair attempt ${attempt}`,
          rationale: 'Automated post-apply guardrail repair',
          targetRef: `profile:${event.profileId}`,
          changeJson: auditChangeJson,
        });

        // Apply the change to the live profile FIRST (reversible-by-snapshot),
        // then CAS-claim the proposal `applied` — the same order and the same
        // primitive (`claimAppliedWithSnapshotAsync`) the human-approval path
        // (org_proposals_controller.ts's approve()) uses.
        const config = configsRepo.getById(patch.agentConfigId)!;
        const priorValue = readAgentConfigField(config, patch.field);
        configsRepo.update(patch.agentConfigId, buildRepairConfigUpdate(patch));
        const beforeSnapshotJson = JSON.stringify({
          agentConfigId: patch.agentConfigId,
          field: patch.field,
          priorValue,
        });
        await proposalsRepo.claimAppliedWithSnapshotAsync(
          proposal.id,
          AUTO_REPAIR_ACTOR_ID,
          beforeSnapshotJson,
          auditChangeJson,
        );

        repairIds.push(proposal.id);
        latestEvent =
          (await eventsRepo.updateStatusAsync(event.proposalId, {
            repairProposalIdsJson: JSON.stringify(repairIds),
          })) ?? latestEvent;

        const recheckFloor = new Date(now.getTime() + attempt * REPAIR_RECHECK_EPSILON_MS);
        const sinceOutcomes = await outcomesRepo.listByProfileSinceAsync(
          event.profileId,
          recheckFloor.toISOString(),
        );
        const stillBreaching = sinceOutcomes.some((o) => o.terminalStatus === 'error');

        if (!stillBreaching) {
          latestEvent =
            (await eventsRepo.updateStatusAsync(event.proposalId, {
              guardrailStatus: 'clear',
              revertStatus: 'not_needed',
            })) ?? latestEvent;
          const original = await proposalsRepo.findByIdAsync(event.proposalId);
          if (original?.status === 'measuring') {
            await proposalsRepo.updateStatusAsync(original.id, 'active', undefined, original.revision);
          }
          return { outcome: 'repaired', attempts: attempt, event: latestEvent };
        }
        continue;
      }
    }

    // No machine-applyable fix this attempt (diagnose failed/returned
    // null/no usable configPatch) — nothing to re-check, still consumes one
    // of the bounded 3 attempts so a persistently-failing diagnosis can't
    // loop forever.
  }

  // All MAX_REPAIR_ATTEMPTS exhausted with the guardrail still tripped.
  const trigger = triggerAutoRevert ?? globalAutoRevertTrigger;
  if (trigger) await trigger({ proposalId: event.proposalId });

  return { outcome: 'exhausted', attempts: MAX_REPAIR_ATTEMPTS, event: latestEvent };
}
