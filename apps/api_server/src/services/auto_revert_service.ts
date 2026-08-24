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
 * ROOT-CAUSE FIX (second pass, independent review): `revertProposal`'s
 * `isConfigFieldSnapshot` branch now ALSO does config-VALUE-level CAS
 * (`compareAndSetConfigField`, org_proposal_apply.ts) whenever the snapshot
 * carries `expectedAppliedValue` — every snapshot this service's repair
 * proposals write does. The live `agent_configs` field is restored to
 * `priorValue` ONLY if it still equals the exact value the repair/apply
 * landed; a later operator (or another automation) edit to the SAME field
 * during monitoring is detected and refused (`'conflict'` from
 * `revertProposal`, surfaced here as `revert_failed`) rather than silently
 * overwritten. Legacy snapshots written before this field existed fall back
 * to the prior unconditional restore — there is no safe CAS target for them.
 */

import { createHash } from 'node:crypto';
import { logger } from '../utils/logger';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { PostApplyEventsRepository } from '../repositories/post_apply_events_repository';
import { parseRepairProposalIds, type PostApplyEvent, type PostApplyRevertStatus } from '../models/post_apply_event';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import {
  isConfigFieldSnapshot,
  revertProposal,
  type ConfigFieldSnapshot,
  type RevertConfigFieldOverride,
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

// ---------------------------------------------------------------------------
// Full-trail fingerprints (issue #1434) — deterministic SHA-256 identity/
// change fingerprints, never the raw field value or any diagnosis prose.
// ---------------------------------------------------------------------------

/**
 * Positional (never object-order-dependent) SHA-256 over a fixed `kind` tag
 * plus a small tuple of plain strings, NUL-separated. `\u0001null` marks an
 * absent value distinctly from the empty string so `(a, '')` and `(a, null)`
 * never collide.
 */
function fingerprintOf(kind: string, ...parts: (string | null)[]): string {
  const material = [kind, ...parts.map((p) => (p === null ? '\u0001null' : p))].join('\u0000');
  return createHash('sha256').update(material).digest('hex');
}

/** Identity of a (profile, field) target — never the value at that field. */
function targetIdentityFingerprint(agentConfigId: string, field: string): string {
  return fingerprintOf('target', agentConfigId, field);
}

/** The exact (profile, field, value) transition a change applied — never the raw value. */
function changeFingerprint(agentConfigId: string, field: string, value: string | null): string {
  return fingerprintOf('change', agentConfigId, field, value);
}

/** The exact value a single repair attempt landed — never the raw value. */
function valueFingerprint(value: string | null): string {
  return fingerprintOf('value', value);
}

/**
 * Best-effort target/change identity fingerprints for a proposal's own
 * `ConfigFieldSnapshot`. `null` for any other/unrecognized snapshot shape
 * (e.g. a scope-delta-v2/scope-state-v2 mutation, which already carries its
 * own `expectedAppliedHash` in scope_mutation_contract.ts) — never a
 * fabricated fingerprint for a shape this function does not understand.
 */
function configFieldFingerprints(
  beforeSnapshotJson: string | null,
): { targetFingerprint: string; changeFingerprint: string; valueFingerprint: string; field: string } | null {
  if (!beforeSnapshotJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(beforeSnapshotJson);
  } catch {
    return null;
  }
  if (!isConfigFieldSnapshot(parsed)) return null;
  const landedValue = parsed.expectedAppliedValue !== undefined ? parsed.expectedAppliedValue : parsed.priorValue;
  return {
    field: parsed.field,
    targetFingerprint: targetIdentityFingerprint(parsed.agentConfigId, parsed.field),
    changeFingerprint: changeFingerprint(parsed.agentConfigId, parsed.field, landedValue),
    valueFingerprint: valueFingerprint(landedValue),
  };
}

/** Trail entry for one repair attempt, safe to surface in an alert. */
interface RepairAttemptTrail {
  proposalId: string;
  status: string | null;
  /** Plain allowlisted field name (e.g. 'model') — never the value itself. */
  field?: string;
  /** SHA-256 of the exact value this repair attempted to land — never the raw value. */
  valueFingerprint?: string;
}

async function buildRepairTrail(
  event: PostApplyEvent,
  proposalsRepo: AgentOrgProposalsRepository,
): Promise<RepairAttemptTrail[]> {
  const ids = parseRepairProposalIds(event.repairProposalIdsJson);
  const trail: RepairAttemptTrail[] = [];
  for (const id of ids) {
    const repair = await proposalsRepo.findByIdAsync(id).catch(() => null);
    const fingerprints = configFieldFingerprints(repair?.beforeSnapshotJson ?? null);
    trail.push({
      proposalId: id,
      status: repair?.status ?? null,
      ...(fingerprints ? { field: fingerprints.field, valueFingerprint: fingerprints.valueFingerprint } : {}),
    });
  }
  return trail;
}

/**
 * ROOT-CAUSE FIX (second pass): the ORIGINAL proposal's own
 * `expectedAppliedValue` is stale once 1+ repair attempts have mutated the
 * SAME (agentConfigId, field) on top of it — D2.3's whole point is to layer
 * corrective mutations on the live field, and D2.4 must unwind the WHOLE
 * chain, not just the original apply. CAS-ing the final revert against the
 * ORIGINAL's own snapshot would treat every one of this system's OWN prior
 * repair writes as if it were an unrelated concurrent edit and refuse the
 * revert every time repairs actually ran. Walk the repair chain LAST-to-first
 * for the most recent attempt that ALSO targeted this exact field — its own
 * `expectedAppliedValue` is the correct "what should currently be live"
 * anchor. Returns `undefined` (no override — use the original's own value)
 * when no repair ever touched this exact field, so a genuine concurrent
 * human/other-automation edit is still detected exactly as before.
 */
async function resolveEffectiveAppliedValue(
  event: PostApplyEvent,
  original: ConfigFieldSnapshot,
  proposalsRepo: AgentOrgProposalsRepository,
): Promise<string | null | undefined> {
  const ids = parseRepairProposalIds(event.repairProposalIdsJson);
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const repair = await proposalsRepo.findByIdAsync(ids[i]).catch(() => null);
    if (!repair?.beforeSnapshotJson) continue;
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(repair.beforeSnapshotJson);
    } catch {
      continue;
    }
    if (
      isConfigFieldSnapshot(snapshot) &&
      snapshot.agentConfigId === original.agentConfigId &&
      snapshot.field === original.field
    ) {
      return snapshot.expectedAppliedValue;
    }
  }
  return undefined;
}

function buildAlertPayload(
  event: PostApplyEvent,
  originalProposal: AgentOrgProposal | null,
  repairTrail: RepairAttemptTrail[],
  revert: { outcome: 'reverted' | 'revert_failed'; conflict?: Record<string, unknown> },
): string {
  const originalFingerprints = configFieldFingerprints(originalProposal?.beforeSnapshotJson ?? null);
  return JSON.stringify({
    proposalId: event.proposalId,
    profileId: event.profileId,
    changeType: event.changeType,
    originalChange: originalProposal
      ? {
          kind: originalProposal.kind,
          // Deterministic SHA-256 identity/change fingerprints (issue #1434
          // full-trail requirement) — omitted (not fabricated) when the
          // original's snapshot isn't a recognized ConfigFieldSnapshot
          // (e.g. a scope-delta-v2/scope-state-v2 mutation).
          ...(originalFingerprints
            ? {
                targetFingerprint: originalFingerprints.targetFingerprint,
                changeFingerprint: originalFingerprints.changeFingerprint,
              }
            : {}),
        }
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
  let configFieldOverride: RevertConfigFieldOverride | undefined;
  try {
    const originalSnapshot = JSON.parse(originalProposal.beforeSnapshotJson);
    if (isConfigFieldSnapshot(originalSnapshot)) {
      const effective = await resolveEffectiveAppliedValue(event, originalSnapshot, proposals);
      if (effective !== undefined) configFieldOverride = { expectedCurrentValue: effective };
    }
  } catch {
    // best-effort only — revertProposal falls back to the original
    // snapshot's own expectedAppliedValue (or the legacy unconditional
    // restore) if this can't be computed.
  }
  const outcome: RevertOutcome = await revertProposal(
    measuring,
    { proposalsRepo: proposals, configsRepo: configs },
    undefined,
    configFieldOverride,
  );

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
    // 'conflict' — either a genuine CAS mismatch (the plain ConfigFieldSnapshot
    // path, or the scope-delta-v2 path) OR, since the D2 post-apply lifecycle
    // repair fix, a config-field restore that landed in the database but
    // whose profile-file projection is not yet settled
    // (landConfigFieldWithProjection, org_proposal_apply.ts) — either way,
    // nothing durable was terminalized; record it and stop. The proposal is
    // still sitting at `measuring` (revertProposal never reached its own
    // terminal `reverted` transition), so this is always consistent with
    // `revert_failed` here — never `reverted` + `revert_failed`.
    return await fail({ reason: `revert-${outcome}`, proposalId: event.proposalId });
  }

  // ROOT-CAUSE FIX (D2 post-apply lifecycle repair, finding #3): this used to
  // ALSO re-read the live field here and fail independently if it didn't
  // match — a SEPARATE verification running AFTER revertProposal had already
  // committed its own `measuring -> reverted` transition. That left a window
  // (revertProposal's internal awaits) where a genuine concurrent edit could
  // land between revertProposal's own write and this external check, which
  // would then report `revert_failed` for a proposal ALREADY marked
  // `reverted` — a directly contradictory durable state. revertProposal's
  // `isConfigFieldSnapshot` branch now performs the value CAS AND the
  // projection-settlement check itself, BEFORE its own terminal transition
  // (see `landConfigFieldWithProjection`), so by the time `outcome === 'reverted'`
  // is observed here, verification has already happened, in the same
  // synchronous span as the write. No parallel restore/verify path is
  // hand-rolled here anymore.
  const alertPayloadJson = buildAlertPayload(event, originalProposal, repairTrail, { outcome: 'reverted' });
  const updated = await recordOutcome(events, event, 'reverted', alertPayloadJson);
  logger.info(`[auto-revert] reverted proposal '${event.proposalId}' (profile '${event.profileId}')`);
  return { outcome: 'reverted', event: updated };
}
