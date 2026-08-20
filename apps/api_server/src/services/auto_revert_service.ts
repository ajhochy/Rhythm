/**
 * D2.4 (#1434) — auto-revert with alert after all 3 repair attempts fail.
 *
 * Fires once D2.3's `runAutoRepairAsync` exhausts `MAX_REPAIR_ATTEMPTS` with
 * the guardrail still tripped. Restores the profile to its state BEFORE the
 * originally-applied proposal (`event.proposalId`) — undoing that change AND
 * every repair attempt on top of it — and records the full trail as an alert.
 *
 * ROOT-CAUSE FIX (#1434, second pass): restoration now routes through
 * `org_proposal_apply.ts`'s own `revertProposal` instead of hand-rolling the
 * `agentConfigFieldPatch` / `readAgentConfigField` / `projectAgentProfileAfterWrite`
 * sequence directly. The earlier design avoided `revertProposal` because its
 * `containsScopeBearingPayload` gate mis-detected EVERY refine-config
 * `changeJson` (`{configPatch:{agentConfigId,field,value}}`) as scope-bearing
 * — a bare `{agentConfigId, field, value}` object is itself detected as
 * scope-bearing regardless of its parent key — and refused every revert as
 * `'unsafe-legacy-scope'` before it could ever reach the real config-field
 * restore branch. That was a genuine bug IN `revertProposal`, not a reason to
 * bypass it: `revertProposal` now narrows past a genuinely validated
 * `configPatch` (`extractValidatedConfigPatch`, shared with
 * `org_proposal_apply_service.ts`'s apply-time preflight) before running the
 * scope-bearing check, so a real refine-config revert is no longer
 * misclassified. This service now reuses `revertProposal` directly, so both
 * the human `/revert` path (#857, `org_proposals_controller.ts`) and this
 * unattended auto-revert path share ONE config-field restore and ONE
 * whole-field-scope refusal (`UNSAFE_WHOLE_FIELD_SCOPE_FIELDS`) and can never
 * drift apart on either.
 *
 * `PostApplyEvent.preChangeSnapshotJson` — see its own doc comment — is
 * deliberately NOT the restoration source: it is documented as an opaque CAS
 * pointer, and `post_apply_events_repository.ts` runs it through
 * `redactSecrets` on write, same as `alert_payload_json`. `AgentOrgProposal.
 * beforeSnapshotJson` (what `revertProposal` actually restores from) is never
 * redacted (only `post_apply_events_repository.ts` calls `redactSecrets`;
 * `agent_org_proposals_repository.ts` does not), so it is the safe,
 * byte-exact restoration source. Using the (redacted) `preChangeSnapshotJson`
 * to restore a field would risk writing the literal string "[redacted]" into
 * a live agent_config if that field's prior value had ever looked
 * secret-shaped — a real hazard, just not one this service hits, because it
 * never restores from that column.
 *
 * CAS / drift detection: the proposal state machine only allows
 * `applied -> measuring` (never `applied -> reverted` directly — see
 * `ALLOWED_TRANSITIONS` in agent_org_proposals_repository.ts), and
 * `revertProposal` itself does not perform that hop (it expects a proposal
 * already sitting at a revertable status). This service therefore still
 * transitions `applied -> measuring` itself, with `expectedRevision` set to
 * the proposal's own revision (the SAME optimistic-concurrency primitive
 * `OrgProposalsController.approve()` and D2.3's `claimAppliedWithSnapshotAsync`
 * use) — the CAS drift check for issue-1434-c2. If the original proposal is
 * no longer sitting at `applied` (e.g. a human already reverted it via
 * org_proposals_controller, or the unrelated org-optimizer measure sweep
 * picked it up first) the pre-check below refuses, or the CAS transition
 * itself throws, and this records `revert_failed` with conflict details
 * instead of silently clobbering whatever state it is actually in. Only once
 * that hop commits does `revertProposal` run the actual restore (or refusal)
 * and the final `measuring -> reverted` transition.
 *
 * SECURITY (#1434 fix, still enforced): a whole-field revert of
 * `allowedMcpsJson` / `allowedSkillsJson` / `corePermissionsJson` — a
 * whole-field `ConfigFieldSnapshot` for one of those fields can't tell a safe
 * rollback apart from clobbering a LATER operator edit to that same
 * allowlist — is refused. This is no longer a separate check duplicated in
 * this file: `revertProposal` itself now returns `'unsafe-legacy-scope'` for
 * exactly this case (via its own `UNSAFE_WHOLE_FIELD_SCOPE_FIELDS` branch),
 * so the guarantee is enforced once, at the shared source, not re-implemented
 * here.
 *
 * ponytail: no config-VALUE-level CAS (comparing the live field byte-for-byte
 * against an "expected currently-applied" value before writing) — only the
 * proposal's own revision is guarded, matching every other non-scope revert
 * in this codebase (`revertProposal`'s plain `isConfigFieldSnapshot` branch
 * has none either). Upgrade to a value-guarded config write if a real
 * concurrent-edit-during-repair incident shows the proposal-revision guard
 * alone isn't enough.
 */

import { logger } from '../utils/logger';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { PostApplyEventsRepository } from '../repositories/post_apply_events_repository';
import { parseRepairProposalIds, type PostApplyEvent, type PostApplyRevertStatus } from '../models/post_apply_event';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import {
  isConfigFieldSnapshot,
  readAgentConfigField,
  revertProposal,
  type RevertOutcome,
} from './org_proposal_apply';

export interface RunAutoRevertAsyncOptions {
  proposalsRepo?: AgentOrgProposalsRepository;
  configsRepo?: AgentConfigsRepository;
  eventsRepo?: PostApplyEventsRepository;
}

export type AutoRevertOutcome = 'reverted' | 'revert_failed' | 'not-tripped';

export interface RunAutoRevertAsyncResult {
  outcome: AutoRevertOutcome;
  event: PostApplyEvent;
  /** Present only when outcome === 'revert_failed'. */
  conflict?: Record<string, unknown>;
}

/** Trail entry for one repair attempt, safe to surface in an alert. */
interface RepairAttemptTrail {
  proposalId: string;
  status: string | null;
}

async function buildRepairTrail(
  event: PostApplyEvent,
  proposalsRepo: AgentOrgProposalsRepository,
): Promise<RepairAttemptTrail[]> {
  const ids = parseRepairProposalIds(event.repairProposalIdsJson);
  const trail: RepairAttemptTrail[] = [];
  for (const id of ids) {
    const repair = await proposalsRepo.findByIdAsync(id).catch(() => null);
    trail.push({
      proposalId: id,
      status: repair?.status ?? null,
    });
  }
  return trail;
}

function buildAlertPayload(
  event: PostApplyEvent,
  originalProposal: AgentOrgProposal | null,
  repairTrail: RepairAttemptTrail[],
  revert: { outcome: 'reverted' | 'revert_failed'; conflict?: Record<string, unknown> },
): string {
  return JSON.stringify({
    proposalId: event.proposalId,
    profileId: event.profileId,
    changeType: event.changeType,
    originalChange: originalProposal
      ? { kind: originalProposal.kind }
      : null,
    repairAttempts: repairTrail,
    revert,
    generatedAt: new Date().toISOString(),
  });
}

async function recordOutcome(
  eventsRepo: PostApplyEventsRepository,
  event: PostApplyEvent,
  revertStatus: PostApplyRevertStatus,
  alertPayloadJson: string,
): Promise<PostApplyEvent> {
  return (await eventsRepo.updateStatusAsync(event.proposalId, { revertStatus, alertPayloadJson })) ?? {
    ...event,
    revertStatus,
    alertPayloadJson,
  };
}

/**
 * Revert the profile targeted by a `tripped` PostApplyEvent to its
 * pre-change state, after D2.3's repair loop has exhausted all attempts. A
 * no-op when the event isn't currently tripped.
 */
export async function runAutoRevertAsync(
  event: PostApplyEvent,
  { proposalsRepo, configsRepo, eventsRepo }: RunAutoRevertAsyncOptions = {},
): Promise<RunAutoRevertAsyncResult> {
  if (event.guardrailStatus !== 'tripped') {
    return { outcome: 'not-tripped', event };
  }

  const proposals = proposalsRepo ?? new AgentOrgProposalsRepository();
  const configs = configsRepo ?? new AgentConfigsRepository();
  const events = eventsRepo ?? new PostApplyEventsRepository();

  const originalProposal = await proposals.findByIdAsync(event.proposalId);
  const repairTrail = await buildRepairTrail(event, proposals);

  const fail = async (conflict: Record<string, unknown>): Promise<RunAutoRevertAsyncResult> => {
    const alertPayloadJson = buildAlertPayload(event, originalProposal, repairTrail, {
      outcome: 'revert_failed',
      conflict,
    });
    const updated = await recordOutcome(events, event, 'revert_failed', alertPayloadJson);
    logger.warn(`[auto-revert] revert_failed for proposal '${event.proposalId}'`);
    return { outcome: 'revert_failed', event: updated, conflict };
  };

  if (!originalProposal) {
    return await fail({ reason: 'original-proposal-missing', proposalId: event.proposalId });
  }
  if (!originalProposal.beforeSnapshotJson) {
    return await fail({ reason: 'no-before-snapshot', proposalId: event.proposalId });
  }
  if (originalProposal.status !== 'applied' && originalProposal.status !== 'measuring') {
    // The only status this proposal should be in for the whole monitor ->
    // repair -> revert lifecycle. Anything else means it drifted away
    // (human revert, an unrelated measure sweep, etc.) while repairs ran.
    return await fail({
      reason: 'proposal-status-drifted',
      expectedStatus: 'applied-or-measuring',
      actualStatus: originalProposal.status,
      proposalId: event.proposalId,
    });
  }

  // The state machine only allows applied -> measuring (never applied ->
  // reverted directly) — this transition IS the CAS drift check: any
  // concurrent status/revision change on this exact row throws here.
  let measuring = originalProposal.status === 'measuring' ? originalProposal : null;
  if (!measuring) {
    try {
      measuring = await proposals.updateStatusAsync(
        originalProposal.id,
        'measuring',
        undefined,
        originalProposal.revision,
      );
    } catch {
      return await fail({
        reason: 'proposal-cas-conflict',
        proposalId: event.proposalId,
      });
    }
  }
  if (!measuring) {
    return await fail({ reason: 'original-proposal-vanished', proposalId: event.proposalId });
  }

  // Delegate the actual restore (or refusal) + the final
  // measuring -> reverted transition to the codebase's own generic revert
  // primitive — the SAME config-field restore and SAME whole-field-scope
  // refusal (UNSAFE_WHOLE_FIELD_SCOPE_FIELDS) the human /revert path (#857)
  // uses, so the two paths can never drift apart on either.
  const outcome: RevertOutcome = await revertProposal(measuring, {
    proposalsRepo: proposals,
    configsRepo: configs,
  });

  if (outcome === 'unsafe-legacy-scope') {
    // #1434 security fix, still enforced — now inside revertProposal itself
    // (UNSAFE_WHOLE_FIELD_SCOPE_FIELDS): a whole-field revert of
    // allowedMcpsJson/allowedSkillsJson/corePermissionsJson can't tell a
    // safe rollback apart from clobbering a LATER operator edit, so it's
    // refused before any write. Best-effort field name for the conflict
    // detail; the refusal itself already happened inside revertProposal.
    let field: string | undefined;
    try {
      const snapshot = JSON.parse(originalProposal.beforeSnapshotJson);
      if (isConfigFieldSnapshot(snapshot)) field = snapshot.field;
    } catch {
      // best-effort detail only — the outcome itself doesn't depend on this.
    }
    return await fail({ reason: 'unsafe-legacy-scope', field, proposalId: event.proposalId });
  }
  if (outcome !== 'reverted') {
    // 'skipped' (unparseable/unsupported snapshot or change_json) or
    // 'conflict' (only reachable via the scope-delta-v2 path, not the plain
    // ConfigFieldSnapshot shape this service's callers produce) — either
    // way, nothing was written; record it and stop.
    return await fail({ reason: `revert-${outcome}`, proposalId: event.proposalId });
  }

  // Independent post-write verification: re-read the live field and confirm
  // it now matches the pre-change snapshot (defense-in-depth on top of
  // revertProposal's own write, matching this service's original design).
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(originalProposal.beforeSnapshotJson);
  } catch {
    snapshot = null;
  }
  if (isConfigFieldSnapshot(snapshot)) {
    const target = configs.getById(snapshot.agentConfigId);
    const actual = target ? readAgentConfigField(target, snapshot.field) : undefined;
    if (actual !== snapshot.priorValue) {
      return await fail({
        reason: 'post-revert-verification-mismatch',
        field: snapshot.field,
        proposalId: event.proposalId,
      });
    }
  }

  const alertPayloadJson = buildAlertPayload(event, originalProposal, repairTrail, { outcome: 'reverted' });
  const updated = await recordOutcome(events, event, 'reverted', alertPayloadJson);
  logger.info(`[auto-revert] reverted proposal '${event.proposalId}' (profile '${event.profileId}')`);
  return { outcome: 'reverted', event: updated };
}
