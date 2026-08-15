/**
 * org_proposal_measure.ts — #821 (org-optimizer-05)
 *
 * The measure/keep/revert step of the low-risk auto-apply path. Given a
 * proposal already `status='measuring'` (i.e. `org_proposal_apply.applyProposal`
 * has already snapshotted + applied it), decide whether to KEEP it
 * (`status='active'`) or AUTO-REVERT it (`status='reverted'`, replaying
 * `before_snapshot_json` via `org_proposal_apply.revertProposal`).
 *
 * Per-kind metric (docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md §3):
 *
 *   - `tighten-scope` / `prune-scope` (mechanical, no LLM): keep iff
 *     scope-hygiene STRICTLY improves (fewer allowlist entries after the
 *     change than before — always true for a non-empty removal, so this is
 *     really a sanity check) AND the FUNCTIONAL GUARD passes: none of the
 *     removed names were actually exercised by the profile in the trailing
 *     window. The functional guard is the safety-critical half — a prune
 *     that removes something the profile is currently using must never be
 *     kept, however tidy the resulting allowlist looks.
 *
 *   - `refine-skill` / `consolidate-skill` / `refine-recipe` (body kinds):
 *     reuse the same purpose-anchored LLM scorer as the skill loop
 *     (`skill_refiner.scoreSkillBody`, injectable as `deps.scoreSkillBody`).
 *     Keep iff `post > baseline` (STRICTLY greater). A tie, a scorer error,
 *     or an unparseable score is NO improvement -> revert (fail-closed) —
 *     `scoreSkillBody` itself already fail-closes a throwing scorer to 0.
 *
 *     #852 — `consolidate-skill` specifically: `scope_hygiene_generator.ts`
 *     only ever emits the bare pairing signal ({skillIdA, skillIdB, titleA,
 *     titleB, similarity}), never a body. `org_proposal_apply.applyProposal`
 *     is where the body gets DRAFTED — see `skill_consolidation_drafter.ts`
 *     — reshaping `change_json` into this same `BodyRefinementChange` shape
 *     BEFORE the row ever reaches `measuring`. By the time `measureProposal`
 *     runs, a consolidate-skill row's `change_json` is indistinguishable
 *     from a `refine-skill` row's, so no kind-specific branch is needed
 *     here: `isBodyRefinementChange()` / `measureBodyRefinement()` below
 *     handle it via the exact same generic path. If a consolidate-skill
 *     proposal ever reaches this function still carrying the undrafted
 *     pairing shape (e.g. a caller invoked `measureProposal` directly,
 *     skipping `applyProposal`), `isBodyRefinementChange()` correctly
 *     returns false and this resolves to `'skipped'` — left in `measuring`
 *     rather than guessing, exactly like any other malformed payload.
 *
 * Every other kind (nothing should reach here outside those five — the
 * caller only invokes this on a row whose proposal is already `risk='low'`)
 * is treated as `skipped`: not enough information to safely decide, so we
 * do nothing rather than guess.
 *
 * Operational envelope (mirrors skill_measurement.ts):
 *   • NEVER throws — the caller (the optimizer loop) is fire-and-forget.
 *   • An unexpected error anywhere in the decision (e.g. an injected metric
 *     hook throwing) resolves to 'skipped', leaving the row in `measuring`
 *     for a later pass rather than guessing keep or revert.
 */

import { logger } from '../utils/logger';
import { alignMcpName } from './mcp_name_alignment';
import { revertProposal, type ApplyDeps, type RevertPatch } from './org_proposal_apply';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { TASK_PATCH_TEXT_FIELDS } from './org_diagnosis_types';
import type { AgentOrgProposal } from '../models/agent_org_proposal';
import type { ScoreCall, SkillPurpose } from './skill_refiner';
import type { ExercisedToolsTelemetry } from './org_exercised_tools_resolver';

export type MeasureOutcome = 'kept' | 'reverted' | 'skipped';

/**
 * #971-3 — outcome of a BEHAVIORAL re-run (refine-config / refine-scope). The
 * applier has already patched `agent_configs` and moved the row to `measuring`;
 * this replays a failing scenario under the patched profile and decides:
 *   • `completed`  — re-run finished WITHOUT the original failure signature -> KEEP
 *   • `failed`     — the original failure reproduced under the patch        -> REVERT
 *   • `infra-error`— engine down/timeout / nothing replayable — leave the row
 *                    `measuring` for a later sweep, never a guessy keep.
 */
export type RerunOutcome =
  | { status: 'completed'; reason: string }
  | { status: 'failed'; reason: string }
  | { status: 'infra-error'; reason: string };

export interface RerunContext {
  /** agent_configs.id of the profile the applier already patched. */
  patchedProfileId: string;
  /** change_json.sessionIds — the flattened, de-duped replay list. */
  sessionIds: string[];
  /** Distinct failure categories from change_json.evidence[] (the "signature"). */
  categories: string[];
}

export type RerunScenario = (proposal: AgentOrgProposal, ctx: RerunContext) => Promise<RerunOutcome>;

/** Shape of the `changeJson` payload for an `agent_configs` scope mutation (mirrors org_proposal_apply.ts). */
interface AgentConfigScopeChange {
  agentConfigId: string;
  field: 'allowedMcpsJson' | 'allowedSkillsJson';
  remove?: string[];
  add?: string[];
}

function isAgentConfigScopeChange(v: unknown): v is AgentConfigScopeChange {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.agentConfigId === 'string' &&
    (c.field === 'allowedMcpsJson' || c.field === 'allowedSkillsJson')
  );
}

/** Shape of the `changeJson` payload for a body-scored kind (refine-skill etc). */
interface BodyRefinementChange {
  skillName?: string;
  recipeName?: string;
  priorBody: string;
  revisedBody: string;
  description?: string | null;
  whenToUse?: string | null;
}

function isBodyRefinementChange(v: unknown): v is BodyRefinementChange {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.priorBody === 'string' && typeof c.revisedBody === 'string';
}

export interface MeasureDeps extends ApplyDeps {
  /**
   * Resolve the set of tool/server names ACTUALLY exercised by the target
   * profile in the trailing window — the functional guard for
   * tighten-scope/prune-scope. Defaults to the REAL resolver
   * (#830 — {@link resolveExercisedTools}), which derives usage from
   * tool-call parts persisted on sessions run under the profile's scheduled
   * tasks (see that module's doc for the exact signal and its documented
   * approximation). The discriminated result keeps unavailable telemetry
   * distinct from a genuine empty observation. Legacy Set-returning test or
   * integration seams remain supported narrowly for compatibility.
   */
  exercisedTools?: (
    agentConfigId: string,
  ) => Promise<ExercisedToolsTelemetry | Set<string>>;
  /** Injectable purpose-anchored scorer (defaults to skill_refiner.scoreSkillBody's real impl). */
  scoreSkillBody?: ScoreCall;
  /**
   * #971-3 — injectable behavioral re-run for refine-config / refine-scope.
   * Defaults to {@link defaultRerunScenario} (real opencode headless replay +
   * workflow-failure-signal classification). Tests inject a deterministic
   * outcome so keep/revert/skip can be asserted without the engine.
   */
  rerunScenario?: RerunScenario;
}

/**
 * #830 — real default: derive exercised tools from the org_exercised_tools_resolver
 * (session tool-call-part telemetry), closing the #821 prune-guard stub that
 * previously always returned an empty set here.
 */
async function defaultExercisedTools(agentConfigId: string): Promise<ExercisedToolsTelemetry> {
  const { resolveExercisedTools } = await import('./org_exercised_tools_resolver');
  const { opencodeClient } = await import('./opencode_engine');
  try {
    if (!opencodeClient.isReady) throw new Error('engine not ready');
    const knownServerNames = Object.keys(await opencodeClient.listMcp());
    if (knownServerNames.length === 0) throw new Error('empty MCP catalog');
    return resolveExercisedTools(agentConfigId, undefined, knownServerNames);
  } catch {
    return {
      availability: 'unavailable',
      reason: 'catalog-unavailable',
      rawCallableNames: new Set<string>(),
      canonicalServerIds: new Set<string>(),
      knownServerIds: new Set<string>(),
      has: () => false,
    };
  }
}

/**
 * Measure a `measuring` proposal and KEEP or REVERT it. NEVER throws.
 */
export async function measureProposal(
  proposal: AgentOrgProposal,
  deps: MeasureDeps = {},
): Promise<MeasureOutcome> {
  try {
    if (proposal.status !== 'measuring') {
      logger.warn(
        `[org-proposal-measure] '${proposal.id}' is not in status=measuring (got '${proposal.status}') — skipping`,
      );
      return 'skipped';
    }

    const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();

    if (proposal.kind === 'tighten-scope' || proposal.kind === 'prune-scope') {
      return await measureScopeChange(proposal, { ...deps, proposalsRepo });
    }

    if (
      proposal.kind === 'refine-skill' ||
      proposal.kind === 'consolidate-skill' ||
      proposal.kind === 'refine-recipe' ||
      // #971-4 — workflow-prompt-fix is a skill-body edit (the applier reshapes
      // its change_json into a BodyRefinementChange, mirroring consolidate-skill),
      // so the existing purpose-anchored LLM judge measures it unchanged.
      proposal.kind === 'workflow-prompt-fix'
    ) {
      return await measureBodyRefinement(proposal, { ...deps, proposalsRepo });
    }

    // #971-3 + Stage B — refine-config / refine-scope / external-adoption: the
    // fix is a config/scope/library mutation, not a text body, so there is
    // nothing to LLM-score. Measure BEHAVIORALLY — replay the failing scenario
    // (the capability-gap's sample session, under the wired agent) and keep iff
    // the original failure signature is gone.
    if (
      proposal.kind === 'refine-config' ||
      proposal.kind === 'refine-scope' ||
      proposal.kind === 'external-adoption'
    ) {
      return await measureBehavioralRerun(proposal, { ...deps, proposalsRepo });
    }

    // #981 — refine-task: a text edit (prompt/description) is LLM-judged (the
    // applier reshaped change_json into a BodyRefinementChange); a schedule or
    // binding edit is measured behaviorally (re-run the failing scenario).
    if (proposal.kind === 'refine-task') {
      return await measureRefineTask(proposal, { ...deps, proposalsRepo });
    }

    logger.warn(`[org-proposal-measure] unsupported kind '${proposal.kind}' for '${proposal.id}' — skipping`);
    return 'skipped';
  } catch (err) {
    logger.warn(`[org-proposal-measure] FAILED (non-fatal): ${String(err)}`);
    return 'skipped';
  }
}

/**
 * #981 — route a refine-task proposal to the right measure path by its patched
 * field: prompt/description (text) → LLM-judge via {@link measureBodyRefinement}
 * (the applier already reshaped change_json to carry priorBody/revisedBody);
 * cronExpression/scheduledTime/agentConfigId (schedule/binding) → behavioral
 * re-run via {@link measureBehavioralRerun}. An unreadable/legacy payload with
 * no taskPatch.field falls back to the behavioral path.
 */
async function measureRefineTask(
  proposal: AgentOrgProposal,
  deps: Required<Pick<MeasureDeps, 'proposalsRepo'>> & MeasureDeps,
): Promise<MeasureOutcome> {
  let change: Record<string, unknown> | null;
  try {
    change = proposal.changeJson ? (JSON.parse(proposal.changeJson) as Record<string, unknown>) : null;
  } catch (err) {
    logger.warn(`[org-proposal-measure] malformed changeJson for '${proposal.id}': ${String(err)}`);
    return 'skipped';
  }
  const taskPatch = change?.taskPatch;
  const field =
    taskPatch && typeof taskPatch === 'object' && !Array.isArray(taskPatch)
      ? (taskPatch as Record<string, unknown>).field
      : undefined;
  if (typeof field === 'string' && (TASK_PATCH_TEXT_FIELDS as readonly string[]).includes(field)) {
    return await measureBodyRefinement(proposal, deps);
  }
  return await measureBehavioralRerun(proposal, deps);
}

/**
 * Mechanical measure for tighten-scope/prune-scope: keep iff the allowlist
 * strictly shrank AND none of the removed names were actually exercised in
 * the trailing window (functional guard). Revert otherwise.
 */
async function measureScopeChange(
  proposal: AgentOrgProposal,
  deps: Required<Pick<MeasureDeps, 'proposalsRepo'>> & MeasureDeps,
): Promise<MeasureOutcome> {
  const proposalsRepo = deps.proposalsRepo!;

  let change: unknown;
  try {
    change = proposal.changeJson ? JSON.parse(proposal.changeJson) : null;
  } catch (err) {
    logger.warn(`[org-proposal-measure] malformed changeJson for '${proposal.id}': ${String(err)}`);
    return 'skipped';
  }

  if (!isAgentConfigScopeChange(change)) {
    logger.warn(`[org-proposal-measure] '${proposal.id}' changeJson is not a scope change — skipping`);
    return 'skipped';
  }

  const removed = change.remove ?? [];
  if (removed.length === 0) {
    // Nothing was actually removed — no hygiene improvement to speak of.
    return await doRevert(proposal, deps);
  }

  const exercisedTools = deps.exercisedTools ?? defaultExercisedTools;
  const exercised = await exercisedTools(change.agentConfigId);

  // W2 governing rule: positive usage evidence is monotonic and canonical —
  // check it BEFORE looking at availability. Partial/unreadable coverage only
  // blocks a NEW negative inference; it must never erase an already-proven
  // positive veto (e.g. partial-structured-telemetry that still retained a
  // canonical hit from its covered sessions). Only once no removed name
  // matches do we fall back to skipping on unavailable telemetry.
  const guardFailed = removed.some((name) => {
    if (exercised instanceof Set) return exercised.has(name);
    if (exercised.canonicalServerIds.has(name)) return true;
    // Canonicalize the raw removal name (which may be an alias form, e.g.
    // `nfl-mcp` vs the live/canonical `nfl_mcp`) against the SAME live
    // catalog that canonicalized the successful calls, before comparing.
    const aligned = alignMcpName(name, exercised.knownServerIds);
    return aligned.matched && exercised.canonicalServerIds.has(aligned.resolved);
  });

  if (!guardFailed && !(exercised instanceof Set) && exercised.availability === 'unavailable') {
    logger.info(
      `[org-proposal-measure] '${proposal.id}' scope telemetry unavailable (${exercised.reason}) — leaving measuring`,
    );
    return 'skipped';
  }

  if (guardFailed) {
    logger.info(
      `[org-proposal-measure] functional guard FAILED for '${proposal.id}' — a removed scope was actually exercised`,
    );
    return await doRevert(proposal, deps, {
      measureReason: `scope-hygiene: functional guard failed — a removed entry (${removed.join(',')}) was exercised in the trailing window`,
    });
  }

  // Hygiene strictly improved (non-empty removal) and the functional guard
  // passed (nothing removed was in active use) -> keep.
  await proposalsRepo.updateStatusAsync(proposal.id, 'active', {
    measureReason: `scope-hygiene: removed ${removed.length} dead/unused entr${removed.length === 1 ? 'y' : 'ies'}; functional guard passed`,
  });
  logger.info(`[org-proposal-measure] KEPT scope change for '${proposal.id}'`);
  return 'kept';
}

/**
 * LLM-scored measure for refine-skill/consolidate-skill/refine-recipe: keep
 * iff post > baseline (STRICTLY greater) via the injected purpose-anchored
 * scorer. Ties and scorer errors are NO improvement -> revert (fail-closed).
 */
async function measureBodyRefinement(
  proposal: AgentOrgProposal,
  deps: Required<Pick<MeasureDeps, 'proposalsRepo'>> & MeasureDeps,
): Promise<MeasureOutcome> {
  const proposalsRepo = deps.proposalsRepo!;

  let change: unknown;
  try {
    change = proposal.changeJson ? JSON.parse(proposal.changeJson) : null;
  } catch (err) {
    logger.warn(`[org-proposal-measure] malformed changeJson for '${proposal.id}': ${String(err)}`);
    return 'skipped';
  }

  if (!isBodyRefinementChange(change)) {
    logger.warn(`[org-proposal-measure] '${proposal.id}' changeJson is not a body refinement — skipping`);
    return 'skipped';
  }

  const { scoreSkillBody: scorer } = await import('./skill_refiner');
  const scoreFn = deps.scoreSkillBody ?? scorer;

  const purpose: SkillPurpose = {
    name: change.skillName ?? change.recipeName ?? proposal.title,
    description: change.description ?? null,
    whenToUse: change.whenToUse ?? null,
  };

  const baseline = await scoreFn(purpose, change.priorBody ?? '');
  const post = await scoreFn(purpose, change.revisedBody ?? '');

  // 2026-07-11 incident — UNKNOWN IS NOT ZERO. Same hole skill_measurement.ts had: an
  // unknown BASELINE coerced to 0 made any post score look like an improvement
  // and KEPT an unmeasured change. Either score unknown → revert, which puts
  // the prior body back (the non-destructive direction here).
  const scoreUnavailable = baseline.unknown === true || post.unknown === true;
  const improved = !scoreUnavailable && post.score > baseline.score; // STRICTLY greater
  const reason = scoreUnavailable
    ? `baseline=${baseline.unknown ? 'unknown' : baseline.score} (${baseline.reason}); ` +
      `post=${post.unknown ? 'unknown' : post.score} (${post.reason}); ` +
      `decision=revert (score UNKNOWN — not a judgement about the change)`
    : `baseline=${baseline.score} (${baseline.reason}); post=${post.score} (${post.reason}); decision=${improved ? 'keep' : 'revert'}`;

  if (improved) {
    await proposalsRepo.updateStatusAsync(proposal.id, 'active', {
      baselineScore: baseline.score,
      postScore: post.score,
      measureReason: reason,
    });
    logger.info(`[org-proposal-measure] KEPT '${proposal.id}' (post ${post.score} > baseline ${baseline.score})`);
    return 'kept';
  }

  // Scores + reason are persisted as part of the SAME status-changing update
  // that performs the revert (updateStatusAsync only allows patch fields
  // alongside a real transition) — see doRevert's `patch` param.
  return await doRevert(proposal, deps, {
    baselineScore: baseline.score,
    postScore: post.score,
    measureReason: reason,
  });
}

/**
 * Revert via org_proposal_apply.revertProposal, mapping its outcome to ours.
 * `patch` (audit fields — measureReason/baselineScore/postScore) is applied
 * in the SAME DB update that performs the `measuring -> reverted` status
 * transition, since the repository only accepts patch fields alongside a
 * real status change.
 */
async function doRevert(
  proposal: AgentOrgProposal,
  deps: MeasureDeps,
  patch?: RevertPatch,
): Promise<MeasureOutcome> {
  const outcome = await revertProposal(proposal, deps, patch);
  return outcome === 'reverted' ? 'reverted' : 'skipped';
}

// ═══════════════════════════════════════════════════════════════════════════
// #971-3 — BEHAVIORAL measure for refine-config / refine-scope.
//
// By the time this runs the applier has ALREADY patched `agent_configs` and set
// the row to `measuring` with a `beforeSnapshotJson`. There is no text body to
// LLM-score; the question is behavioral — does the profile that was failing now
// succeed under the patch? We replay the originating prompt from one of the
// diagnosis's `change_json.sessionIds` as a fresh headless session under the
// patched profile and classify the re-run with the SAME workflow-failure-signal
// predicate the extractor uses. Keep iff the original failure signature is gone;
// revert (through doRevert, so audit fields persist) if it reproduced; skip
// (leave `measuring`) on any infrastructure error — never a guessy keep.
// ═══════════════════════════════════════════════════════════════════════════

/** The subset of a diagnosis `change_json` the behavioral measure consumes. */
interface DiagnosisChange {
  affectedSkill?: string;
  fixType?: string;
  sessionIds?: string[];
  configPatch?: { agentConfigId?: string };
  scopePatch?: { agentConfigId?: string };
  evidence?: Array<{ category?: string }>;
}

async function measureBehavioralRerun(
  proposal: AgentOrgProposal,
  deps: Required<Pick<MeasureDeps, 'proposalsRepo'>> & MeasureDeps,
): Promise<MeasureOutcome> {
  const proposalsRepo = deps.proposalsRepo!;

  let change: DiagnosisChange | null;
  try {
    change = proposal.changeJson ? (JSON.parse(proposal.changeJson) as DiagnosisChange) : null;
  } catch (err) {
    logger.warn(`[org-proposal-measure] malformed changeJson for '${proposal.id}': ${String(err)}`);
    return 'skipped';
  }
  if (!change) {
    logger.warn(`[org-proposal-measure] '${proposal.id}' has no changeJson — skipping behavioral measure`);
    return 'skipped';
  }

  // The applier re-resolved and patched THIS profile — trust the patch's
  // agentConfigId (server-resolved), falling back to the diagnosis's affectedSkill.
  const patchedProfileId =
    change.configPatch?.agentConfigId ?? change.scopePatch?.agentConfigId ?? change.affectedSkill;
  const sessionIds = Array.isArray(change.sessionIds)
    ? change.sessionIds.filter((s): s is string => typeof s === 'string')
    : [];
  const categories = [
    ...new Set(
      (change.evidence ?? []).map((e) => e?.category).filter((c): c is string => typeof c === 'string'),
    ),
  ];

  if (!patchedProfileId || sessionIds.length === 0) {
    // Nothing to reproduce -> we cannot behaviorally decide. Leave `measuring`
    // (a later sweep may have more luck) rather than guessing keep/revert.
    // ponytail: these proposals always carry a profile + replay list from the
    // diagnosis brain; this only fires for a malformed/legacy payload.
    logger.warn(
      `[org-proposal-measure] '${proposal.id}' missing patched profile or replay sessionIds — leaving measuring`,
    );
    return 'skipped';
  }

  const rerun = deps.rerunScenario ?? defaultRerunScenario;
  let outcome: RerunOutcome;
  try {
    outcome = await rerun(proposal, { patchedProfileId, sessionIds, categories });
  } catch (err) {
    // A throwing re-run is treated as infrastructure failure (skip), matching
    // the module's fail-toward-another-pass envelope — never a guessy keep.
    logger.warn(`[org-proposal-measure] re-run threw for '${proposal.id}' (non-fatal): ${String(err)}`);
    return 'skipped';
  }

  if (outcome.status === 'infra-error') {
    logger.info(`[org-proposal-measure] '${proposal.id}' behavioral re-run skipped (infra): ${outcome.reason}`);
    return 'skipped';
  }

  if (outcome.status === 'failed') {
    return await doRevert(proposal, deps, {
      measureReason: `behavioral re-run reproduced the original failure: ${outcome.reason}`,
    });
  }

  await proposalsRepo.updateStatusAsync(proposal.id, 'active', {
    measureReason: `behavioral re-run completed without the original failure signature: ${outcome.reason}`,
  });

  // Stage B — an adopted external skill that measured clean RESOLVES its
  // originating capability-gap (signalRef carries `gapId:<dedup_key>`). On a
  // revert (below) the gap deliberately stays `open` for a future adopt attempt.
  if (proposal.kind === 'external-adoption') {
    try {
      const dedupKey = (proposal.signalRef ?? '').replace(/^gapId:/, '').trim();
      if (dedupKey) {
        const { AgentCapabilityGapsRepository } = await import(
          '../repositories/agent_capability_gaps_repository'
        );
        await new AgentCapabilityGapsRepository().resolveByDedupKeyAsync(dedupKey);
      }
    } catch (err) {
      logger.warn(`[org-proposal-measure] resolve capability-gap failed for '${proposal.id}' (non-fatal): ${String(err)}`);
    }
  }

  logger.info(`[org-proposal-measure] KEPT '${proposal.id}' (behavioral re-run clean)`);
  return 'kept';
}

/**
 * Real behavioral re-run: replay the originating prompt from the first
 * replayable session as a FRESH headless session under the patched profile
 * (same createSession + empty-mcpAllowlist pattern as the diagnosis
 * `defaultDiagnose`), then classify the re-run against the original failure
 * categories using the workflow-failure-signal extractor's own detectors.
 *
 * ponytail: the empty mcpAllowlist keeps the tool surface bounded (avoids the
 * Gemini 512-declaration cap) exactly like defaultDiagnose — the trade-off is a
 * coarse probe (a task that genuinely needed tools can't fully run tool-less),
 * so this reliably catches the linguistic failure signatures (retry-loop,
 * unverified-claim, tool-unavailable, empty/errored output) and gives anything
 * that completes cleanly the benefit of the doubt. Human revert (#857) and the
 * re-diagnosis loop (#5) are the backstops for a false keep.
 */
// Exported for the USO B4 (#1031) routing test — the default is otherwise
// reached only via measureProposal (rerunScenario injection is the test seam
// for the outer keep/revert logic; this seam covers the run()-routing itself).
export const defaultRerunScenario: RerunScenario = async (proposal, ctx) => {
  try {
    const { AgentSessionMessagesRepository } = await import(
      '../repositories/agent_session_messages_repository'
    );
    const messagesRepo = new AgentSessionMessagesRepository();

    // Resolve the originating prompt: the first non-empty `input` message of the
    // first replayable session in the list.
    let replayPrompt: string | null = null;
    let sourceSessionId: string | null = null;
    for (const sid of ctx.sessionIds) {
      const firstInput = messagesRepo
        .listBySession(sid)
        .find((m) => m.role === 'input' && m.strippedText.trim().length > 0);
      if (firstInput) {
        replayPrompt = firstInput.strippedText;
        sourceSessionId = sid;
        break;
      }
    }
    if (!replayPrompt) {
      return {
        status: 'infra-error',
        reason: `no replayable prompt found in sessions ${ctx.sessionIds.slice(0, 3).join(',')}`,
      };
    }

    const { resolveRunModel, run } = await import('./agent_runner');
    // Resolve the PATCHED profile's model so a refine-config model swap is what
    // the re-run actually exercises (falls back to MRU/default if unset).
    const model = resolveRunModel(ctx.patchedProfileId);

    // USO B4 (#1031): route the behavioral re-run through AgentRunner.run so it
    // becomes an OBSERVABLE self_improvement session (category-scoped, recorded
    // in agent_sessions) instead of a headless opencode prompt. mcpRole tags the
    // run to the patched profile (log attribution + detector profile-matching);
    // allowedMcpsJson '{}' reproduces the empty mcpServers:{}+allowedToolsJson:'{}'
    // surface the old createSession used — the same bounded, tool-less probe.
    // run() ensures the engine is ready and extracts the assistant text into
    // .result (identical filter-text/join/trim as the old parts extraction, with
    // a listMessages fallback), so the keep/revert measurement below is unchanged.
    const res = await run({
      prompt: replayPrompt,
      sessionName: `proposal-measure-rerun:${proposal.id ?? ctx.patchedProfileId}`,
      category: 'self_improvement',
      modelOverride: model,
      mcpRole: ctx.patchedProfileId,
      allowedMcpsJson: '{}',
    });
    // status:'error' folds together every old infra failure (engine down,
    // no session created, prompt returned no response) into the infra-error path.
    if (res.status === 'error') {
      return {
        status: 'infra-error',
        reason: res.error ?? `re-run failed for ${ctx.patchedProfileId} (engine error/timeout)`,
      };
    }

    const rerunSessionId = res.sessionId;
    const outputText = res.result;

    // Extractor's own "real output" floor (MIN_OUTPUT_CHARS=20): an empty/near-
    // empty turn is the `transport-empty` failure classification — the agent
    // produced nothing usable under the patch.
    if (outputText.length < 20) {
      return {
        status: 'failed',
        reason: `re-run of ${sourceSessionId} produced no substantive output (session ${rerunSessionId})`,
      };
    }

    const classification = await classifyRerunFailure(
      rerunSessionId,
      ctx.patchedProfileId,
      ctx.categories,
      messagesRepo,
    );
    if (classification.status === 'reproduced') {
      return {
        status: 'failed',
        reason: `re-run of ${sourceSessionId} under ${ctx.patchedProfileId} still shows [${classification.categories.join(',')}] (session ${rerunSessionId})`,
      };
    }
    if (classification.status === 'inconclusive') {
      return {
        status: 'infra-error',
        reason: `re-run of ${sourceSessionId} under ${ctx.patchedProfileId} inconclusive: ${classification.reason} (session ${rerunSessionId})`,
      };
    }
    return {
      status: 'completed',
      reason: `re-run of ${sourceSessionId} under ${ctx.patchedProfileId} produced ${outputText.length} chars with no [${ctx.categories.join(',') || 'diagnosed'}] signature (session ${rerunSessionId})`,
    };
  } catch (err) {
    return { status: 'infra-error', reason: `re-run threw (treated as infra): ${String(err)}` };
  }
};

/** Outcome of classifying a rerun session against the ORIGINAL failure categories. */
export type RerunClassification =
  | { status: 'reproduced'; categories: string[] }
  | { status: 'clean' }
  | { status: 'inconclusive'; reason: string };

/**
 * Reuse the workflow-failure-signal extractor's OWN detectors to classify a
 * fresh re-run session — no duplicated failure heuristics.
 *
 * W3 final review corrective — this used to synthesize a fake two-message
 * session (`partsJson: null`) instead of loading the rerun's ACTUAL persisted
 * messages. `extractToolAttempts` (the retry-loop detector's ONLY evidence
 * source) requires real `partsJson`, so that synthetic double could NEVER
 * carry structured tool-attempt evidence — a reproduced retry-loop was
 * therefore invisible to this classifier, and every retry-loop diagnosis
 * proposal was silently kept regardless of whether the patch actually fixed
 * anything. This now loads the rerun session's real messages via
 * `AgentSessionMessagesRepository.listBySession` (the existing seam) and runs
 * every detector, including retry-loop, against that real evidence.
 *
 * Raw prompt/output text can still support the TEXT-based detectors
 * (hallucinated-claim, unverified-claim, tool-unavailable-attempted,
 * repeated-correction, delegate-result) because those read real message
 * `strippedText` either way — but it can never substitute for retry-loop's
 * structured tool-attempt evidence, so retry-loop is judged ONLY on what
 * `extractToolAttempts` finds in the real persisted parts.
 *
 * Returns:
 *   - `reproduced` — a category from the original failure signature actually
 *     reproduced under the patch (a REAL retry-loop signal, not a guess).
 *   - `inconclusive` — the original categories include 'retry-loop' but this
 *     rerun has NO readable structured tool-attempt evidence at all (a
 *     tool-less/bare probe can't exercise the built-in tools a retry-loop
 *     would show up on) — the caller must leave the proposal `measuring`,
 *     never treat this as a clean pass.
 *   - `clean` — nothing reproduced, AND (when 'retry-loop' was an original
 *     category) valid persisted tool-attempt evidence existed and showed no
 *     retry loop — a genuine, evidence-backed pass.
 */
export async function classifyRerunFailure(
  sessionId: string,
  profileId: string,
  categories: string[],
  messagesRepo: import('../repositories/agent_session_messages_repository').AgentSessionMessagesRepository,
): Promise<RerunClassification> {
  try {
    const extractor = await import('./workflow_failure_signal_extractor');
    const messages = messagesRepo.listBySession(sessionId);

    const now = new Date().toISOString();
    // Minimal read-only double — only the fields the detectors touch matter.
    const session = {
      id: sessionId,
      status: 'idle',
      mcpRole: profileId,
      agentKind: 'claude-code',
      parentSessionId: null,
      taskTitle: null,
      lastActivityAt: now,
      updatedAt: now,
      createdAt: now,
    } as unknown as import('../models/agent_session').AgentSession;

    const getMessages = () => messages;

    const detectors = [
      extractor.detectRetryLoopSignals,
      extractor.detectHallucinatedClaimSignals,
      extractor.detectUnverifiedClaimSignals,
      extractor.detectToolUnavailableSignals,
      extractor.detectRepeatedCorrectionSignals,
      extractor.detectDelegateResultSignals,
    ];

    const detectedCategories = new Set<string>();
    for (const detect of detectors) {
      try {
        for (const signal of detect([session], getMessages)) detectedCategories.add(signal.category);
      } catch {
        // A single detector failing must not mask the others.
      }
    }

    const reproduced = categories.filter((c) => detectedCategories.has(c));
    if (reproduced.length > 0) {
      return { status: 'reproduced', categories: reproduced };
    }

    // W3 final architectural corrective — consume the SAME shared strict
    // parser detectRetryLoopSignals itself uses (persisted_tool_evidence.ts),
    // not a length check on the narrow extractToolAttempts compatibility
    // export. A nonzero attempt count is NOT proof of a clean pass: one
    // persisted pending/fresh-running/timed-out/errored/completed-MCP-error
    // attempt is exactly nonzero-length while being zero evidence of a
    // genuine success. 'clean' requires evidence integrity to be valid AND at
    // least one producer-valid TERMINAL SUCCESS (completed, isError!==true).
    if (categories.includes('retry-loop')) {
      const { parsePersistedToolEvidence, isTerminalSuccess } = await import('./persisted_tool_evidence');
      const evidence = parsePersistedToolEvidence(messages);
      if (evidence.integrity !== 'valid' || !evidence.attempts.some(isTerminalSuccess)) {
        return {
          status: 'inconclusive',
          reason: `original failure includes retry-loop but rerun session ${sessionId} has no producer-valid terminal tool success evidence`,
        };
      }
    }

    return { status: 'clean' };
  } catch (err) {
    logger.warn(`[org-proposal-measure] classifyRerunFailure failed (non-fatal): ${String(err)}`);
    return { status: 'inconclusive', reason: `classifyRerunFailure threw: ${String(err)}` };
  }
}
