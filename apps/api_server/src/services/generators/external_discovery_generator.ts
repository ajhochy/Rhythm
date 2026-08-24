/**
 * external_discovery_generator.ts — #828 (org-optimizer-12).
 *
 * External discovery & adoption generator — the HIGHEST-risk, GATED,
 * provenance-mandatory lane of the org self-optimizer. Proposes adopting a
 * NEW external MCP server or skill in response to a concrete audit gap.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CRITICAL ARCHITECTURAL CONSTRAINT: this module COMPOSES existing sources.
 * It is NOT a crawler. It never makes an HTTP/npm/GitHub call itself.
 * ════════════════════════════════════════════════════════════════════════
 *
 * The actual searching (mcp-registry search_mcp_registry/suggest_connectors/
 * list_connectors, npm lookups, GitHub search, WebSearch/deep-research) is
 * performed by a SCOPED AGENT elsewhere (via MCP/skill calls) and handed to
 * this module as the `discoverCandidates` dependency. This generator's own
 * job is strictly: orchestrate the call, enforce the gap-grounding and
 * provenance-completeness gates, dedup against already-decided proposals,
 * cap results per run, and write `agent_org_proposals` rows. See
 * docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md and
 * docs/ai/decisions/2026-07-02-autonomy-and-vault-intent.md (external
 * discovery/adoption is one of only two human-gated lanes — the other is
 * new-agent creation — under the otherwise full-autonomy-with-rollback
 * policy).
 *
 * ── Acceptance criteria (issue #828), each enforced below ──────────────────
 *
 *  1. Every emitted `external-adoption` proposal references a concrete audit
 *     gap (`signal_ref` carries the `gapId`). A candidate whose `gapId` does
 *     not match any gap in the supplied audit snapshot is DROPPED — no
 *     "trending/popular" candidate is ever proposed ungrounded.
 *  2. Every proposal carries a COMPLETE `provenance_json` (source, stars OR
 *     downloads, last-updated, maintainer, license, install command). A
 *     candidate missing ANY required provenance field is DROPPED before a
 *     proposal is ever created — never emitted with a partial note for a
 *     human to backfill. The completeness check mirrors (and the emitted
 *     provenance_json satisfies) `org_proposal_apply_service.hasSecurityNote`
 *     / `requiresSecurityNote`, the real gate the review queue enforces at
 *     approval time.
 *  3. `risk='high'`, `external=1` — never auto-applied. `external: 1` alone
 *     forces `classifyProposalRisk` to 'high' independent of kind, but this
 *     module also sets `risk: 'high'` directly on the row for auditability.
 *  4. On approval, the registered applier (see
 *     {@link registerExternalAdoptionApplier}) routes an MCP candidate
 *     through the curated-MCP install path and re-runs the alignment guard;
 *     a skill candidate through the skill-create path. No bespoke install
 *     bypassing those guards is performed anywhere in this module.
 *  5. Callable on its own less-frequent schedule (the schedule wiring itself
 *     is #830 — out of scope here; this module exposes nothing but a plain
 *     async function, no cron/timer of its own), deduped against the
 *     already-suggested/rejected set (`existsByDedupKeyAsync`), and
 *     result-capped per run (`maxResults`, default {@link DEFAULT_MAX_RESULTS}).
 *
 * Operational envelope (mirrors org_proposal_apply.ts / org_proposal_measure.ts):
 *   • NEVER throws from {@link runExternalDiscoveryGenerator} — a failing
 *     `discoverCandidates` call (the scoped agent is unavailable, rate
 *     limited, etc.) degrades to zero candidates for this run, not a crash.
 */

import { logger } from '../../utils/logger';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import type { AgentOrgProposal } from '../../models/agent_org_proposal';
import type { OrgAuditGap } from '../org_audit_service';
import type {
  ProposalApplier,
  ProposalApplyResult,
} from '../org_proposal_apply_service';

// ── Candidate + provenance shapes ───────────────────────────────────────────

export type ExternalCandidateKind = 'mcp' | 'skill';

/**
 * The provenance note every candidate MUST carry in full. Mirrors the
 * `external-adoption` review-queue security-note contract
 * (source/stars-or-downloads/last-updated/maintainer/license/install-cmd).
 * `stars` and `downloads` are both optional individually, but AT LEAST ONE
 * of the two must be present (npm packages report downloads; GitHub repos
 * report stars) — see {@link isProvenanceComplete}.
 */
export interface ExternalCandidateProvenance {
  /** Where this candidate was found, e.g. 'npm', 'github', 'mcp-registry'. */
  source: string;
  stars?: number;
  downloads?: number;
  lastUpdated: string;
  maintainer: string;
  license: string;
  installCommand: string;
}

/**
 * A single external candidate handed to this module by the scoped
 * discovery agent (via {@link DiscoverCandidatesFn}). `gapId` MUST be one of
 * the ids the caller's audit snapshot already produced — this module never
 * invents or accepts a freestanding "trending" signal.
 */
export interface ExternalCandidate {
  kind: ExternalCandidateKind;
  /** Package/server/skill name as the scoped agent found it. */
  name: string;
  /** The audit gap (org_audit_service.OrgAuditGap.gapId) this candidate addresses. */
  gapId: string;
  provenance: ExternalCandidateProvenance;
  /** Optional human-readable rationale from the scoped agent; falls back to a generated one. */
  rationale?: string;
  /** Optional explicit install command override (defaults to provenance.installCommand). */
  installCommand?: string;
  // ── Stage B (Plan B) — capability-gap adoption context ──────────────────
  /** Skill candidates: the raw SKILL.md URL the applier downloads the real body from. */
  downloadUrl?: string;
  /** The agent that needs this capability (from the capability-gap) — wired on adopt. */
  agentConfigId?: string;
  /** A representative session to replay for the behavioral measure. */
  sampleSessionId?: string;
  /** Intent tags → behavioral-measure failure categories. */
  categories?: string[];
}

/**
 * The scoped-agent seam: given the current audit gaps (for context — the
 * agent may use them to target its search), return candidate external
 * adoptions. Composes `mcp-registry` (search_mcp_registry / suggest_connectors
 * / list_connectors), npm, GitHub, and/or WebSearch/deep-research — ALL of
 * that composition happens OUTSIDE this module, inside whatever calls
 * `runExternalDiscoveryGenerator` (a scoped agent turn, a skill, or a test
 * double). This module only ever calls the function it is handed.
 */
export type DiscoverCandidatesFn = (gaps: OrgAuditGap[]) => Promise<ExternalCandidate[]>;

const DEFAULT_MAX_RESULTS = 5;

export interface RunGeneratorInput {
  /** The current org audit snapshot's gaps — candidates must reference one of these. */
  gaps: OrgAuditGap[];
  /** The scoped-agent discovery call (test doubles inject a deterministic list). */
  discoverCandidates: DiscoverCandidatesFn;
  /** Cap on proposals emitted THIS run. Defaults to {@link DEFAULT_MAX_RESULTS}. */
  maxResults?: number;
  /** Injectable proposals repo (defaults to a fresh AgentOrgProposalsRepository). */
  proposalsRepo?: AgentOrgProposalsRepository;
  /**
   * The audit run that produced `gaps`. Stamped on every emitted proposal so
   * the row is findable by the run that created it — without it the row is
   * invisible to per-run reporting and to deleteRunProposals cleanup.
   */
  auditRunId: string;
}

export interface RunGeneratorResult {
  emitted: number;
  droppedNoGap: number;
  droppedMissingProvenance: number;
  droppedDuplicate: number;
  errored: boolean;
}

/**
 * True iff `provenance` carries every required field (source, lastUpdated,
 * maintainer, license, installCommand) AND at least one of stars/downloads.
 * A candidate failing this check is dropped BEFORE any proposal is created
 * — never emitted for a human to "fill in the rest later".
 */
function isProvenanceComplete(p: ExternalCandidateProvenance | undefined | null): boolean {
  if (!p) return false;
  if (typeof p.source !== 'string' || !p.source.trim()) return false;
  if (typeof p.lastUpdated !== 'string' || !p.lastUpdated.trim()) return false;
  if (typeof p.maintainer !== 'string' || !p.maintainer.trim()) return false;
  if (typeof p.license !== 'string' || !p.license.trim()) return false;
  if (typeof p.installCommand !== 'string' || !p.installCommand.trim()) return false;
  const hasStars = typeof p.stars === 'number' && Number.isFinite(p.stars);
  const hasDownloads = typeof p.downloads === 'number' && Number.isFinite(p.downloads);
  if (!hasStars && !hasDownloads) return false;
  return true;
}

/** Build the `changeJson` payload the applier (issue-828-c4) will act on. */
function buildChangeJson(candidate: ExternalCandidate): string {
  return JSON.stringify({
    candidateKind: candidate.kind,
    serverName: candidate.kind === 'mcp' ? candidate.name : undefined,
    skillName: candidate.kind === 'skill' ? candidate.name : undefined,
    installCommand: candidate.installCommand ?? candidate.provenance.installCommand,
    // Stage B — the applier + behavioral measure read these.
    downloadUrl: candidate.downloadUrl,
    agentConfigId: candidate.agentConfigId,
    sampleSessionId: candidate.sampleSessionId,
    categories: candidate.categories,
  });
}

function buildDedupKey(candidate: ExternalCandidate): string {
  return `external-adoption:${candidate.kind}:${candidate.name.trim().toLowerCase()}`;
}

/**
 * Run the external discovery generator once. NEVER throws — a failure
 * anywhere (including `discoverCandidates` itself throwing) degrades to a
 * zero-candidate, `errored: true` result for this run rather than crashing
 * the fire-and-forget optimizer loop (matches org_proposal_apply.ts /
 * org_proposal_measure.ts operational envelope).
 *
 * NOTE on scheduling (#830): this function takes no schedule/cron
 * parameters and starts no timer of its own — it is a plain callable the
 * (separate) schedule-wiring issue invokes on its own less-frequent cadence.
 */
export async function runExternalDiscoveryGenerator(
  input: RunGeneratorInput,
): Promise<RunGeneratorResult> {
  const result: RunGeneratorResult = {
    emitted: 0,
    droppedNoGap: 0,
    droppedMissingProvenance: 0,
    droppedDuplicate: 0,
    errored: false,
  };

  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
  const proposalsRepo = input.proposalsRepo ?? new AgentOrgProposalsRepository();
  const gapsById = new Map(input.gaps.map((g) => [g.gapId, g]));

  let candidates: ExternalCandidate[];
  try {
    candidates = await input.discoverCandidates(input.gaps);
  } catch (err) {
    logger.warn(`[external-discovery-generator] discoverCandidates FAILED (non-fatal): ${String(err)}`);
    result.errored = true;
    return result;
  }

  for (const candidate of candidates) {
    if (result.emitted >= maxResults) break;

    try {
      // 1. Gap-grounding gate (issue-828-c1) — DROP anything not tied to a
      //    real, currently-open audit gap. No "trending/popular" allowed.
      const gap = gapsById.get(candidate.gapId);
      if (!gap) {
        result.droppedNoGap++;
        logger.info(
          `[external-discovery-generator] dropped '${candidate.name}' — gapId '${candidate.gapId}' not in the current audit snapshot`,
        );
        continue;
      }

      // 2. Provenance-completeness gate (issue-828-c2) — DROP anything
      //    missing a required field. Never emitted "to be completed later".
      if (!isProvenanceComplete(candidate.provenance)) {
        result.droppedMissingProvenance++;
        logger.info(
          `[external-discovery-generator] dropped '${candidate.name}' — incomplete provenance`,
        );
        continue;
      }

      // 3. Dedup gate (issue-828-c5) — never re-propose an already-decided
      //    (or already-pending) candidate.
      const dedupKey = buildDedupKey(candidate);
      if (await proposalsRepo.existsByDedupKeyAsync(dedupKey)) {
        result.droppedDuplicate++;
        logger.info(
          `[external-discovery-generator] dropped '${candidate.name}' — already suggested/decided (dedup_key=${dedupKey})`,
        );
        continue;
      }

      // 4. Emit — risk='high', external=1 (issue-828-c3), never auto-applied.
      await proposalsRepo.createAsync({
        auditRunId: input.auditRunId,
        kind: 'external-adoption',
        risk: 'high',
        external: 1,
        title: `Adopt ${candidate.kind === 'mcp' ? 'MCP server' : 'skill'}: ${candidate.name}`,
        rationale:
          candidate.rationale ??
          `Addresses audit gap ${gap.gapId} (${gap.kind}): ${gap.evidence}`,
        signalRef: `gapId:${gap.gapId}`,
        targetRef: `${candidate.kind}:${candidate.name}`,
        changeJson: buildChangeJson(candidate),
        provenanceJson: JSON.stringify(candidate.provenance),
        dedupKey,
      });

      result.emitted++;
      logger.info(
        `[external-discovery-generator] proposed external-adoption for '${candidate.name}' (gap=${gap.gapId})`,
      );
    } catch (err) {
      // A single bad candidate must never abort the whole run.
      logger.warn(
        `[external-discovery-generator] failed to process candidate '${candidate.name}' (non-fatal): ${String(err)}`,
      );
    }
  }

  return result;
}

// ── Approval-time applier (issue-828-c4) ────────────────────────────────────

/** Result of installing a curated MCP server (mirrors OpencodeClientService.ensureCuratedMcps's shape). */
export interface InstallCuratedMcpResult {
  changed: boolean;
  registered: boolean;
  /**
   * #1114 — before_snapshot_json the external-adoption revert path would
   * replay (the needing agent's prior allowedMcpsJson), mirroring
   * InstallSkillResult.beforeSnapshotJson. Optional: a candidate install
   * with no agentConfigId (gap had no known requester) has nothing to wire
   * or snapshot.
   */
  beforeSnapshotJson?: string;
}

/** Result of running the skill-adopt path for an adopted external skill. */
export interface InstallSkillResult {
  created: boolean;
  /** before_snapshot_json the external-adoption revert path replays (agent allowlist + adopted skill name). */
  beforeSnapshotJson?: string;
  /** Reshaped change_json (DiagnosisChange-compatible) the behavioral measure reads. */
  changeJson?: string;
}

/** Result of re-running the alignment guard after install. */
export interface AlignmentCheckResult {
  aligned: boolean;
  reason?: string;
}

/** Shape of the `changeJson` payload this generator writes (see {@link buildChangeJson}). */
interface ExternalAdoptionChange {
  candidateKind: ExternalCandidateKind;
  serverName?: string;
  skillName?: string;
  installCommand?: string;
  downloadUrl?: string;
  agentConfigId?: string;
  sampleSessionId?: string;
  categories?: string[];
}

function isExternalAdoptionChange(v: unknown): v is ExternalAdoptionChange {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return c.candidateKind === 'mcp' || c.candidateKind === 'skill';
}

/**
 * #1114 — resolve the capability-gap a proposal's `signalRef` (`gapId:<dedup_
 * key>`) points at. Mirrors org_proposal_measure.ts's identical resolve call
 * on the skill path's `active` transition (same dynamic import, to avoid
 * pulling the repository — and its own dependents — into every module that
 * imports this generator). Never throws; a resolve failure is logged and
 * swallowed, matching AgentCapabilityGapsRepository.resolveByDedupKeyAsync's
 * own no-op-on-unknown-key contract.
 */
async function resolveOriginatingGap(proposal: AgentOrgProposal): Promise<void> {
  try {
    const dedupKey = (proposal.signalRef ?? '').replace(/^gapId:/, '').trim();
    if (!dedupKey) return;
    const { AgentCapabilityGapsRepository } = await import(
      '../../repositories/agent_capability_gaps_repository'
    );
    await new AgentCapabilityGapsRepository().resolveByDedupKeyAsync(dedupKey);
  } catch (err) {
    logger.warn(
      `[external-discovery-generator] resolve capability-gap failed for '${proposal.id}' (non-fatal): ${String(err)}`,
    );
  }
}

/**
 * Dependencies the applier needs at approval time. Production callers wire
 * these to the REAL curated-MCP install path (`OpencodeClientService
 * .ensureCuratedMcps`), the real skill-create path, and the real alignment
 * guard (`mcp_name_alignment.alignMcpName` against the live engine list, or
 * an equivalent for skills). Tests inject fakes — this module never talks to
 * the engine or the filesystem directly, only through these seams.
 */
export interface ExternalAdoptionApplyDeps {
  installCuratedMcp: (input: {
    serverName: string;
    installCommand?: string;
    /**
     * #1114 — the agent that needs this MCP server (from the originating
     * capability-gap). When present, the REAL implementation wires the
     * server into JUST this agent's allowedMcpsJson (secretary-MCP-scope
     * lesson: a curated install must never leave a newly-adopted server
     * globally enabled for every agent). Absent for a gap with no known
     * requester — install proceeds but wires nothing.
     */
    agentConfigId?: string;
  }) => Promise<InstallCuratedMcpResult>;
  installSkill: (input: {
    skillName: string;
    downloadUrl?: string;
    agentConfigId?: string;
    sampleSessionId?: string;
    categories?: string[];
  }) => Promise<InstallSkillResult>;
  /** Re-run the alignment guard AFTER install, before declaring success. */
  checkAlignment: (input: {
    candidateKind: ExternalCandidateKind;
    name: string;
  }) => Promise<AlignmentCheckResult>;
}

/**
 * Register the `external-adoption` apply step into the shared
 * `org_proposal_apply_service` plugin seam (`registerProposalApplier`),
 * per this issue's ownership note: apply/validate logic for external
 * adoption lives INSIDE this generator file, exported as a registration
 * function, rather than editing org_proposal_apply_service.ts directly
 * (that file's control flow is #830's to wire).
 *
 * The registered applier:
 *   - MCP candidates: calls `deps.installCuratedMcp` (the ONLY sanctioned
 *     install path — the real implementation is
 *     `OpencodeClientService.ensureCuratedMcps`, which itself performs the
 *     idempotent-merge-into-opencode.json + live-register dance; no bespoke
 *     install is performed here).
 *   - Skill candidates: calls `deps.installSkill` (the skill-create path).
 *   - EITHER WAY, after install, `deps.checkAlignment` is re-run and MUST
 *     report `aligned: true` or the applier throws — approval never
 *     succeeds on a server/skill that installed but didn't actually align
 *     with the live engine (the exact hazard `mcp_name_alignment.ts`
 *     documents for scope entries).
 *   - `measurable: false` — external adoption is a one-shot install, not a
 *     measure/keep/revert candidate; the row's terminal state after a
 *     successful apply is `applied` (never `active` via the measure loop).
 *
 * `registerFn` is `registerProposalApplier` from `org_proposal_apply_service`
 * — injected so callers (and this module's own tests) never import that
 * service's mutable global registry by side effect alone; it is always
 * explicit at the call site.
 */
export function registerExternalAdoptionApplier(
  registerFn: (kind: string, applier: ProposalApplier) => void,
  deps: ExternalAdoptionApplyDeps,
): void {
  const applier: ProposalApplier = async (
    proposal: AgentOrgProposal,
  ): Promise<ProposalApplyResult> => {
    let change: unknown;
    try {
      change = proposal.changeJson ? JSON.parse(proposal.changeJson) : null;
    } catch (err) {
      throw new Error(
        `external-adoption apply for '${proposal.id}': unparseable change_json: ${String(err)}`,
      );
    }

    if (!isExternalAdoptionChange(change)) {
      throw new Error(
        `external-adoption apply for '${proposal.id}': change_json is not a recognized external-adoption payload`,
      );
    }

    if (change.candidateKind === 'mcp') {
      const serverName = change.serverName;
      if (!serverName) {
        throw new Error(
          `external-adoption apply for '${proposal.id}': changeJson.serverName is required for an mcp candidate`,
        );
      }
      // The ONLY sanctioned install path — no bespoke install here.
      const installResult = await deps.installCuratedMcp({
        serverName,
        installCommand: change.installCommand,
        agentConfigId: change.agentConfigId,
      });
      if (!installResult.changed && !installResult.registered) {
        throw new Error(
          `external-adoption apply for '${proposal.id}': curated-MCP install reported no change and no registration`,
        );
      }

      const alignment = await deps.checkAlignment({ candidateKind: 'mcp', name: serverName });
      if (!alignment.aligned) {
        throw new Error(
          `external-adoption apply for '${proposal.id}': post-install alignment guard failed for '${serverName}'${
            alignment.reason ? ` (${alignment.reason})` : ''
          }`,
        );
      }

      // #1114 — MCP adoption is `measurable: false` (a one-shot install, not
      // a behavioral measure/keep/revert candidate — there is no downloaded
      // body or replayable session shape for it, unlike a skill). Its
      // terminal state is `applied`, which never reaches org_proposal_
      // measure.ts's `active`-transition resolve call (the skill path's own
      // gap-resolution site). Resolve the originating capability-gap HERE,
      // immediately on a successful install+align, so a gap is never left
      // dangling `open` just because its fix took the MCP branch.
      await resolveOriginatingGap(proposal);

      return { measurable: false, beforeSnapshotJson: installResult.beforeSnapshotJson };
    }

    // candidateKind === 'skill'
    const skillName = change.skillName;
    if (!skillName) {
      throw new Error(
        `external-adoption apply for '${proposal.id}': changeJson.skillName is required for a skill candidate`,
      );
    }
    const installResult = await deps.installSkill({
      skillName,
      downloadUrl: change.downloadUrl,
      agentConfigId: change.agentConfigId,
      sampleSessionId: change.sampleSessionId,
      categories: change.categories,
    });
    if (!installResult.created) {
      throw new Error(
        `external-adoption apply for '${proposal.id}': skill adopt path reported no creation for '${skillName}'`,
      );
    }

    const alignment = await deps.checkAlignment({ candidateKind: 'skill', name: skillName });
    if (!alignment.aligned) {
      throw new Error(
        `external-adoption apply for '${proposal.id}': post-install alignment guard failed for '${skillName}'${
          alignment.reason ? ` (${alignment.reason})` : ''
        }`,
      );
    }

    // Stage B — the adopted skill is measurable: the row advances to `measuring`
    // and the behavioral loop replays the intent's session under the wired
    // agent. The deps supply the before-snapshot (for revert) and the reshaped
    // change_json (for the behavioral measure).
    return {
      measurable: true,
      beforeSnapshotJson: installResult.beforeSnapshotJson,
      changeJson: installResult.changeJson,
    };
  };

  registerFn('external-adoption', applier);
}
