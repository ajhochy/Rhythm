/**
 * org_audit_service.ts — issue #819 (org-optimizer-03).
 *
 * READ-ONLY snapshot of the whole agent org (profiles + scopes, skills,
 * recipes, delegation graph, webhook endpoints) plus recent activity signals
 * (denied-tool aggregates, allowlist drift), assembled into one structured
 * digest the org self-optimizer agent and its generators consume instead of
 * each re-querying the raw tables. See
 * docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md §4 for the full
 * signal-to-source mapping this centralizes.
 *
 * HARD INVARIANT: this module performs NO writes to any table. Every
 * repository call below is a list/get/count read. Do not add a write call
 * here — the optimizer's proposal/apply/measure/revert lifecycle is entirely
 * downstream of this snapshot (agent_org_proposals), never inside it.
 *
 * Cold-start (#746): `opencodeClient.isReady` is checked before ANY engine
 * call (`listMcp` / `listSkills`). When the engine is not ready, no engine
 * call is made and `engineAvailable=false` with an empty `drift[]` — never a
 * false "every allowlisted name is dead" verdict. Even when the engine IS
 * ready, an empty (but reachable) live MCP/skill set also produces no drift,
 * mirroring `mcp_name_alignment.alignMcpName`'s fail-open rule (empty live
 * set → never invent, never flag).
 */

import { randomUUID } from 'node:crypto';

import { logger } from '../utils/logger';
import { opencodeClient } from './opencode_engine';
import { alignMcpName } from './mcp_name_alignment';
import { resolveMcpServerIdentity } from './mcp_scope_name';
import { resolveExercisedTools } from './org_exercised_tools_resolver';
import { resolveProfileMcpScope, type ProfileMcpScopeShape } from './agent_profile_scope';
import {
  findUnknownMcpToolGrants,
  loadLiveMcpToolCatalog,
  type McpToolGrantDrift,
} from './mcp_tool_catalog_validation';
import { extractWorkflowFailureSignals, type WorkflowFailureSignal } from './workflow_failure_signal_extractor';
import { AgentConfigsRepository, type AgentConfig } from '../repositories/agent_configs_repository';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentCookbookRepository } from '../repositories/agent_cookbook_repository';
import { AgentWebhookEndpointsRepository } from '../repositories/agent_webhook_endpoints_repository';
import {
  AgentSessionsRepository,
  type SessionOwnershipFacet,
} from '../repositories/agent_sessions_repository';
import {
  DeniedToolEventsRepository,
  type DeniedToolEvent,
} from '../repositories/denied_tool_events_repository';
import {
  AgentCapabilityGapsRepository,
  type CapabilityGapRow,
} from '../repositories/agent_capability_gaps_repository';
import type { AgentSkill } from '../models/agent_skill';
import type { AgentCookbook } from '../repositories/agent_cookbook_repository';
import type { AgentWebhookEndpoint } from '../repositories/agent_webhook_endpoints_repository';
import type { AgentSession } from '../models/agent_session';

// ── Public digest shape ──────────────────────────────────────────────────

export interface ProfileScopeSnapshot {
  id: string;
  label: string;
  isManager: boolean;
  enabled: boolean;
  /**
   * MCP SERVER names the profile grants, resolved from EITHER stored shape via
   * the shared `resolveProfileMcpScope` (server-name array AND tools-map).
   * Empty means "grants no server" ONLY when `mcpScopeShape` is 'invalid' — for
   * 'unrestricted' it means "no allowlist at all, every server is available".
   * Read `mcpScopeShape` before concluding anything from an empty array.
   */
  allowedMcps: string[];
  /**
   * Which shape `allowed_mcps_json` used. 'unrestricted' = the column is NULL.
   * Present because `allowedMcps: []` is otherwise ambiguous between "no
   * restriction" and "nothing granted" — the ambiguity the optimizer read as
   * "this agent has no MCP access" and filed false scope proposals on.
   */
  mcpScopeShape: ProfileMcpScopeShape;
  /**
   * server → its explicit per-tool grants. An EMPTY array means EVERY tool of
   * that server (a `null` / `[]` value, or the server-name-array shape), never
   * "no tools".
   */
  allowedMcpTools: Record<string, string[]>;
  allowedSkills: string[];
  allowedDelegates: string[];
}

export interface SkillOverlapCandidate {
  skillIdA: string;
  skillIdB: string;
  titleA: string;
  titleB: string;
  /** Jaccard token overlap of the two titles, in [0, 1]. */
  similarity: number;
}

export interface DelegationEdge {
  fromProfileId: string;
  toProfileId: string;
}

export interface DeniedToolAggregate {
  /** Null when profile attribution could not be resolved for ANY event in this group. */
  agentConfigId: string | null;
  toolName: string;
  count: number;
}

export interface AllowlistDrift {
  profileId: string;
  /** 'mcp' | 'skill' — which allowlist column the name came from. */
  scopeKind: 'mcp' | 'mcp-tool' | 'skill';
  serverName?: string;
  name: string;
  matched: boolean;
}

/**
 * A detected gap the optimizer's generators tie proposals to. `evidence` is a
 * human-readable string (session ids / counts / task names) that doubles as
 * the raw material for a proposal's `signal_ref`. `gapId` is a STABLE hash
 * derived from `kind` + the identifying evidence fields — NOT a fresh
 * randomUUID() per run — so repeated audit runs over unchanged data agree on
 * the same id and downstream dedup (agent_org_proposals.dedup_key) works.
 */
export interface OrgAuditGap {
  gapId: string;
  kind: 'prune-scope' | 'tighten-scope' | 'webhook-wiring' | 'capability-gap';
  evidence: string;
  /**
   * capability-gap only — the agent that needs the capability plus the intent
   * + replay context the discovery seam, the applier, and the behavioral
   * measure all read. Absent on the three hygiene kinds.
   */
  agentConfigId?: string;
  sampleSessionId?: string;
  intentTitle?: string;
  intentProblem?: string;
  intentTags?: string[];
}

export interface OrgAuditSnapshot {
  auditRunId: string;
  generatedAt: string;
  /** False when the opencode engine was not ready at audit time (#746 cold-start). */
  engineAvailable: boolean;
  profiles: ProfileScopeSnapshot[];
  skills: AgentSkill[];
  skillOverlapCandidates: SkillOverlapCandidate[];
  recipes: AgentCookbook[];
  delegationEdges: DelegationEdge[];
  webhookEndpoints: AgentWebhookEndpoint[];
  deniedToolAggregates: DeniedToolAggregate[];
  drift: AllowlistDrift[];
  gaps: OrgAuditGap[];
  /**
   * #934 — recurring agent-workflow failure signals (workflow_failure_signal_extractor.ts,
   * #933). Always an array — `[]` when none were detected or the extractor
   * degraded (it never throws), never omitted/null, so consumers can rely on
   * `.length`/iteration without a null check.
   */
  workflowFailureSignals: WorkflowFailureSignal[];
}

export type SuccessfulUseEvidence =
  | {
      availability: 'available';
      canonicalPairs: Set<string>;
      /**
       * Profile ids whose own resolveExercisedTools call came back
       * unavailable (W2: no global suppression). detectTightenGaps must
       * treat these profiles' telemetry as unknown while still judging
       * every other, fully-covered profile on its own evidence.
       */
      unavailableProfileIds: Set<string>;
    }
  | { availability: 'unavailable' };

// ── Helpers ───────────────────────────────────────────────────────────────

function parseJsonStringArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function toProfileScopeSnapshot(config: AgentConfig): ProfileScopeSnapshot {
  // MCP scope is read through the SHARED resolver, never `parseJsonStringArray`:
  // that helper returns [] for the tools-map shape ({"gitnexus":null,...}) and
  // for NULL alike, so a fully-scoped live profile was reported as having no MCP
  // access — which is what the LLM diagnosis lane quoted back as
  // "allowedMcps: [] (empty)" while inventing a missing-scope root cause.
  const mcpScope = resolveProfileMcpScope(config.allowedMcpsJson ?? null, config.id, config.label);
  return {
    id: config.id,
    label: config.label,
    isManager: config.isManager,
    enabled: config.enabled,
    allowedMcps: mcpScope.servers,
    mcpScopeShape: mcpScope.shape,
    allowedMcpTools: mcpScope.toolsByServer,
    allowedSkills: parseJsonStringArray(config.allowedSkillsJson),
    allowedDelegates: parseJsonStringArray(config.allowedDelegatesJson),
  };
}

/** Jaccard token overlap over lowercased whitespace-split title tokens. */
function titleSimilarity(a: string, b: string): number {
  const ta = new Set(a.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 1));
  const tb = new Set(b.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const SKILL_OVERLAP_THRESHOLD = 0.5;

/**
 * #857 data-sufficiency guard for the tighten-scope ("never invoked") signal.
 *
 * The live-run failure this closes: with almost no usage history (minutes of
 * uptime, a single session), EVERY granted tool looks "never invoked" —
 * indistinguishable from a tool proven unused over a meaningful window. A
 * profile below either floor is "unobserved", not "unused", and must never
 * produce a tighten-scope gap. Both are configurable via env for operators
 * who want a stricter/looser bar without a code change; defaults are
 * deliberately conservative (a week of wall-clock age AND a double-digit
 * session count) given the cost of a wrong auto-applied prune.
 *
 * Scope: this guard applies ONLY to the usage-based tighten-scope signal.
 * `detectPruneGaps` (a dead/drifted allowlist name — a correctness fix, not a
 * usage judgement) is intentionally NEVER gated by this window.
 */
export const MIN_TIGHTEN_OBSERVATION_DAYS = Number(process.env.ORG_OPTIMIZER_MIN_OBSERVATION_DAYS ?? 7);
export const MIN_TIGHTEN_ACTIVITY_COUNT = Number(process.env.ORG_OPTIMIZER_MIN_ACTIVITY_COUNT ?? 10);

function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return 0;
  const ms = Date.now() - then;
  return ms <= 0 ? 0 : ms / (24 * 60 * 60 * 1000);
}

function findSkillOverlapCandidates(skills: AgentSkill[]): SkillOverlapCandidate[] {
  const out: SkillOverlapCandidate[] = [];
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const similarity = titleSimilarity(skills[i].title, skills[j].title);
      if (similarity >= SKILL_OVERLAP_THRESHOLD) {
        out.push({
          skillIdA: skills[i].id,
          skillIdB: skills[j].id,
          titleA: skills[i].title,
          titleB: skills[j].title,
          similarity,
        });
      }
    }
  }
  return out;
}

function buildDelegationEdges(profiles: ProfileScopeSnapshot[]): DelegationEdge[] {
  const edges: DelegationEdge[] = [];
  for (const profile of profiles) {
    for (const toProfileId of profile.allowedDelegates) {
      edges.push({ fromProfileId: profile.id, toProfileId });
    }
  }
  return edges;
}

/**
 * Authoritative profile ownership for both activity and denied telemetry.
 * Scheduled-task ownership is exclusive: once a session names a scheduled
 * task, only that task's valid owner may win and every conflicting fallback
 * is ignored. True interactive sessions retain the explicit-event then exact
 * mcpRole/legacy-agentKind compatibility order; a missing session can use
 * only a valid explicit event owner.
 */
function resolveAgentConfigOwnership(
  // Narrowed to the fields actually read, so both the full `AgentSession` rows
  // used for denied-tool attribution and the cheap `SessionOwnershipFacet` rows
  // used for uncapped counting can flow through one resolver.
  session: SessionOwnershipFacet | null,
  explicitAgentConfigId: string | null,
  scheduledTaskOwnerById: ReadonlyMap<string, string | null>,
  validConfigIds: Set<string>,
): string | null {
  if (!session) {
    return explicitAgentConfigId && validConfigIds.has(explicitAgentConfigId)
      ? explicitAgentConfigId
      : null;
  }

  if (session.scheduledTaskId) {
    const scheduledOwner = scheduledTaskOwnerById.get(session.scheduledTaskId);
    return scheduledOwner && validConfigIds.has(scheduledOwner) ? scheduledOwner : null;
  }

  if (explicitAgentConfigId && validConfigIds.has(explicitAgentConfigId)) {
    return explicitAgentConfigId;
  }
  if (session.mcpRole && validConfigIds.has(session.mcpRole)) return session.mcpRole;
  if (session.agentKind && validConfigIds.has(session.agentKind)) return session.agentKind;
  return null;
}

function aggregateDeniedTool(
  events: DeniedToolEvent[],
  sessionsById: Map<string, AgentSession>,
  sessionsRepo: AgentSessionsRepository,
  scheduledTaskOwnerById: ReadonlyMap<string, string | null>,
  validConfigIds: Set<string>,
): DeniedToolAggregate[] {
  const counts = new Map<string, DeniedToolAggregate>();
  for (const event of events) {
    let session = event.sessionId ? (sessionsById.get(event.sessionId) ?? null) : null;
    if (!session && event.sessionId) {
      session = sessionsRepo.findById(event.sessionId);
      if (session) sessionsById.set(event.sessionId, session);
    }
    const agentConfigId = resolveAgentConfigOwnership(
      session,
      event.agentConfigId,
      scheduledTaskOwnerById,
      validConfigIds,
    );
    const key = `${agentConfigId ?? '(unattributed)'}::${event.toolName}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { agentConfigId, toolName: event.toolName, count: 1 });
    }
  }
  return [...counts.values()];
}

/** Stable id: not a random UUID — a deterministic hash of kind + evidence key parts. */
function stableGapId(kind: string, ...parts: string[]): string {
  // A tiny, dependency-free deterministic string hash (FNV-1a), sufficient
  // for a stable, collision-resistant-enough dedup key — cryptographic
  // strength is not required here, only run-to-run stability.
  const input = [kind, ...parts].join('::');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${kind}:${(hash >>> 0).toString(16)}`;
}

function detectPruneGaps(drift: AllowlistDrift[]): OrgAuditGap[] {
  return drift
    .filter((d) => !d.matched)
    .map((d) => ({
      gapId: stableGapId('prune-scope', d.profileId, d.scopeKind, d.serverName ?? '', d.name),
      kind: 'prune-scope' as const,
      evidence: d.scopeKind === 'mcp-tool'
        ? `profile=${d.profileId} scopeKind=mcp-tool serverName=${d.serverName} deadName=${d.name}`
        : `profile=${d.profileId} scopeKind=${d.scopeKind} deadName=${d.name}`,
    }));
}

export async function reportMcpToolGrantDrift(engineUrl?: string): Promise<McpToolGrantDrift[]> {
  const configs = new AgentConfigsRepository().list();
  const catalog = await loadLiveMcpToolCatalog(engineUrl);
  return configs.flatMap((config) =>
    findUnknownMcpToolGrants(config.allowedMcpsJson, config.id, catalog),
  );
}

/**
 * A tighten-scope gap: a profile's live, matched MCP allowlist entry that has
 * zero denied-tool events AND zero sessions attributed to that profile that
 * could plausibly have exercised it — the "granted but never used" signal
 * (decision doc §4).
 *
 * #857 data-sufficiency guard: "never invoked" is only a valid prune signal
 * once the profile has been observed for AT LEAST `MIN_TIGHTEN_OBSERVATION_DAYS`
 * (wall-clock age since the profile/grant was created, via
 * `observationDaysByProfile`) AND has AT LEAST `MIN_TIGHTEN_ACTIVITY_COUNT`
 * recorded sessions. A profile below EITHER floor is under-observed, not
 * over-scoped — no gap is emitted for it at all (not even a low-confidence
 * one), matching the issue's "no data at all must NEVER produce a prune"
 * requirement. A profile with a long history but a genuinely unused tool
 * still produces a gap exactly as before.
 *
 * W2 fix: successful-use evidence is profile-granular. `successfulUse.availability
 * === 'unavailable'` means the catalog/engine itself was unreachable (no MCP
 * names to judge against at all) and still suppresses every gap. But when the
 * catalog is live, one profile's own telemetry being unavailable
 * (`unavailableProfileIds`) must ONLY suppress tighten judgements for THAT
 * profile — an unrelated, well-covered, genuinely-zero-use profile still gets
 * judged on its own evidence rather than being dragged down by a sibling.
 */
export function detectTightenGaps(
  profiles: ProfileScopeSnapshot[],
  liveMcpNames: Set<string>,
  deniedPairs: Set<string>,
  sessionCountByProfile: Map<string, number>,
  observationDaysByProfile: Map<string, number>,
  successfulUse: SuccessfulUseEvidence = { availability: 'unavailable' },
): OrgAuditGap[] {
  if (liveMcpNames.size === 0) return [];
  if (successfulUse.availability === 'unavailable') return [];
  const gaps: OrgAuditGap[] = [];
  for (const profile of profiles) {
    if (successfulUse.unavailableProfileIds.has(profile.id)) continue;
    const sessionCount = sessionCountByProfile.get(profile.id) ?? 0;
    const observationDays = observationDaysByProfile.get(profile.id) ?? 0;
    if (sessionCount < MIN_TIGHTEN_ACTIVITY_COUNT) continue;
    if (observationDays < MIN_TIGHTEN_OBSERVATION_DAYS) continue;
    for (const name of profile.allowedMcps) {
      const { resolved, matched } = alignMcpName(name, liveMcpNames);
      if (!matched) continue; // dead names are prune candidates, not tighten
      const deniedKey = `${profile.id}::${resolved}`;
      if (deniedPairs.has(deniedKey)) continue; // it WAS exercised (denied counts as exercised-attempt)
      if (successfulUse.canonicalPairs.has(deniedKey)) continue;
      gaps.push({
        gapId: stableGapId('tighten-scope', profile.id, resolved),
        kind: 'tighten-scope',
        evidence: `profile=${profile.id} neverInvokedTool=${resolved} sessionCount=${sessionCount} observationDays=${Math.floor(observationDays)}`,
      });
    }
  }
  return gaps;
}

const WEBHOOK_PATTERN_MIN_COUNT = 3;

/**
 * A webhook-wiring gap: a recurring `task_title` pattern across sessions with
 * no `agent_webhook_endpoints` row wiring it (decision doc §4's "recurring
 * inbound-trigger pattern" signal). Grouping is a simple exact-title count —
 * good enough for a v1 gap surfaced for human triage, not an auto-apply.
 */
function detectWebhookGaps(
  sessions: AgentSession[],
  webhookEndpoints: AgentWebhookEndpoint[],
): OrgAuditGap[] {
  const wiredNames = new Set(webhookEndpoints.map((w) => w.name.toLowerCase()));
  const counts = new Map<string, { count: number; sessionIds: string[] }>();
  for (const session of sessions) {
    const title = session.taskTitle?.trim();
    if (!title) continue;
    const entry = counts.get(title) ?? { count: 0, sessionIds: [] };
    entry.count += 1;
    entry.sessionIds.push(session.id);
    counts.set(title, entry);
  }

  const gaps: OrgAuditGap[] = [];
  for (const [title, { count, sessionIds }] of counts) {
    if (count < WEBHOOK_PATTERN_MIN_COUNT) continue;
    if (wiredNames.has(title.toLowerCase())) continue; // already wired
    gaps.push({
      gapId: stableGapId('webhook-wiring', title),
      kind: 'webhook-wiring',
      evidence: `pattern="${title}" count=${count} sessionIds=${sessionIds.join(',')}`,
    });
  }
  return gaps;
}

/**
 * Surface every OPEN agent_capability_gaps row (emitted by the harvester's
 * ladder step 3 — no adequate library skill for a distilled intent) as a
 * capability-gap OrgAuditGap the external-discovery generator can ground a
 * proposal on. Read-only: this snapshot builder never writes. The row's stable
 * dedup_key IS the gapId, so the generator's dedup + signal_ref chain aligns
 * with the gap without a second hash. Never throws — a repo failure degrades to
 * zero capability gaps for this run.
 *
 * Deviation from the plan: `AgentCapabilityGapsRepository` (#983, already on
 * this branch) returns `CapabilityGapRow` with `intentTags: string[] | null`
 * ALREADY parsed (no `intentTagsJson` string field on the model — that raw
 * column only exists internally as `CapabilityGapDbRow`), so this reads the
 * real exported row type directly instead of re-parsing JSON.
 */
function detectCapabilityGaps(rows: CapabilityGapRow[]): OrgAuditGap[] {
  return rows.map((r) => ({
    gapId: r.dedupKey,
    kind: 'capability-gap' as const,
    evidence: `capability-gap intent="${r.intentTitle}" agent=${r.agentConfigId ?? '(unassigned)'} sampleSession=${r.sampleSessionId ?? '(none)'}`,
    agentConfigId: r.agentConfigId ?? undefined,
    sampleSessionId: r.sampleSessionId ?? undefined,
    intentTitle: r.intentTitle,
    intentProblem: r.intentProblem ?? undefined,
    intentTags: r.intentTags ?? [],
  }));
}

// ── Entry point ───────────────────────────────────────────────────────────

/**
 * Build the read-only org audit snapshot. Never writes to any table.
 *
 * Engine calls (`listMcp`/`listSkills`) are gated on `opencodeClient.isReady`
 * (#746 cold-start guard) — when not ready, no engine call is made and drift
 * detection is skipped entirely (`engineAvailable=false`, `drift=[]`), never
 * producing a false "dead name" verdict from an unavailable engine.
 */
export async function buildOrgAuditSnapshot(): Promise<OrgAuditSnapshot> {
  const configsRepo = new AgentConfigsRepository();
  const skillsRepo = new AgentSkillsRepository();
  const cookbookRepo = new AgentCookbookRepository();
  const webhookRepo = new AgentWebhookEndpointsRepository();
  const sessionsRepo = new AgentSessionsRepository();
  const deniedRepo = new DeniedToolEventsRepository();

  const configs = configsRepo.list();
  const profiles = configs.map(toProfileScopeSnapshot);
  const validConfigIds = new Set(configs.map((c) => c.id));

  const skills = skillsRepo.list();
  const skillOverlapCandidates = findSkillOverlapCandidates(skills);

  const recipes = await cookbookRepo.listAllAsync();
  const webhookEndpoints = await webhookRepo.listAsync();
  const delegationEdges = buildDelegationEdges(profiles);

  const sessions = sessionsRepo.listAll(1000, { includeArchived: true });

  // W2: scheduled ownership beats mcp_role. A session tied to a scheduled
  // task (agent_scheduled_tasks.agent_config_id) belongs ONLY to that task's
  // owner for activity-counting purposes, even if its `mcp_role` column
  // (stale, or written by a legacy/interactive-labelled path) names a
  // different profile — otherwise a batch of sessions scheduled for profile A
  // could inflate profile B's observation floor and let B's telemetry look
  // observed/available-empty (or B could steal A's activity) purely off a
  // conflicting mcp_role value.
  const scheduledTasks = await new AgentScheduledTasksRepository().listAllAsync();
  const scheduledTaskOwnerById = new Map<string, string | null>();
  for (const task of scheduledTasks) scheduledTaskOwnerById.set(task.id, task.agentConfigId);

  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const sessionCountByProfile = new Map<string, number>();
  const sessionIdsByProfile = new Map<string, Set<string>>();
  // Counted from the UNCAPPED ownership read, not from `sessions` above.
  // `listAll` is `ORDER BY created_at DESC LIMIT 1000`: past 1000 sessions it
  // silently drops the older ones, so an older-but-qualifying profile's runs
  // vanish from the count, the observation floor (sessionCount >= 10) is never
  // met, and the audit confidently reports zero proposals when the truth is
  // that it never looked. `sessions` stays bounded because its only remaining
  // job is to warm the denied-tool attribution cache below, which self-heals
  // via findById on a miss.
  for (const session of sessionsRepo.listOwnershipFacets()) {
    // #1004: only sessions that ACTUALLY EXECUTED count toward the tighten-scope
    // observation floor. A run stuck at 'starting' or that 'error'ed never invoked
    // any tool — counting it lets "never invoked" masquerade as "unused" when the
    // agent simply never ran, which is how the optimizer over-pruned live agents'
    // MCPs. Under-counting only makes pruning MORE conservative (the safe direction).
    if (session.status === 'starting' || session.status === 'error') continue;

    const ownerId = resolveAgentConfigOwnership(
      session,
      null,
      scheduledTaskOwnerById,
      validConfigIds,
    );
    if (!ownerId) continue;
    sessionCountByProfile.set(ownerId, (sessionCountByProfile.get(ownerId) ?? 0) + 1);
    const ownedIds = sessionIdsByProfile.get(ownerId) ?? new Set<string>();
    ownedIds.add(session.id);
    sessionIdsByProfile.set(ownerId, ownedIds);
  }

  // #857 — observation window per profile: wall-clock age since the profile
  // (and therefore its scope grants) was created. This is the best available
  // proxy for "how long has this grant had a chance to be exercised" — there
  // is no separate per-scope-entry grant timestamp, only the profile row's
  // own created_at.
  const observationDaysByProfile = new Map<string, number>();
  for (const config of configs) {
    observationDaysByProfile.set(config.id, daysSince(config.createdAt));
  }

  const deniedEvents = await deniedRepo.listAllAsync();
  const deniedToolAggregates = aggregateDeniedTool(
    deniedEvents,
    sessionsById,
    sessionsRepo,
    scheduledTaskOwnerById,
    validConfigIds,
  );

  // Open capability gaps (Plan A) — read-only surface into this snapshot.
  let capabilityGapRows: CapabilityGapRow[] = [];
  try {
    capabilityGapRows = await new AgentCapabilityGapsRepository().listOpenAsync();
  } catch (err) {
    logger.warn(`[org-audit] listOpen capability gaps failed (non-fatal): ${String(err)}`);
    capabilityGapRows = [];
  }

  // ── Engine-gated section (#746 cold-start guard) ─────────────────────────
  const engineAvailable = opencodeClient.isReady;
  let drift: AllowlistDrift[] = [];
  let liveMcpNames = new Set<string>();
  let deniedPairs = new Set<string>();
  let successfulUse: SuccessfulUseEvidence = { availability: 'unavailable' };

  if (engineAvailable) {
    try {
      const mcpStatus = await opencodeClient.listMcp();
      liveMcpNames = new Set(Object.keys(mcpStatus));
    } catch {
      // Engine reported ready but the call failed — treat as unavailable for
      // drift purposes (liveMcpNames stays empty -> alignMcpName fails open).
      liveMcpNames = new Set();
    }

    if (liveMcpNames.size > 0) {
      deniedPairs = new Set(
        deniedToolAggregates.flatMap((aggregate) => {
          if (!aggregate.agentConfigId) return [];
          const serverId = resolveMcpServerIdentity(aggregate.toolName, liveMcpNames);
          return serverId ? [`${aggregate.agentConfigId}::${serverId}`] : [];
        }),
      );

      // W2 fix: a single profile's unavailable telemetry (e.g. an
      // unrelated preset with unreadable structured rows) must not blank
      // out successful-use evidence for every OTHER profile — collect
      // canonical pairs per available profile and track unavailable ones
      // separately so detectTightenGaps can skip judging only those.
      const canonicalPairs = new Set<string>();
      const unavailableProfileIds = new Set<string>();
      for (const profile of profiles) {
        const telemetry = await resolveExercisedTools(
          profile.id,
          undefined,
          liveMcpNames,
          sessionIdsByProfile.get(profile.id) ?? [],
        );
        if (telemetry.availability === 'unavailable') {
          unavailableProfileIds.add(profile.id);
          continue;
        }
        for (const serverId of telemetry.canonicalServerIds) {
          canonicalPairs.add(`${profile.id}::${serverId}`);
        }
      }
      successfulUse = { availability: 'available', canonicalPairs, unavailableProfileIds };

      for (const profile of profiles) {
        for (const name of profile.allowedMcps) {
          const { matched } = alignMcpName(name, liveMcpNames);
          if (!matched) {
            drift.push({ profileId: profile.id, scopeKind: 'mcp', name, matched: false });
          }
        }
      }

      try {
        const toolCatalog = await loadLiveMcpToolCatalog();
        for (const config of configs) {
          for (const entry of findUnknownMcpToolGrants(config.allowedMcpsJson, config.id, toolCatalog)) {
            drift.push({
              profileId: entry.profileId,
              scopeKind: 'mcp-tool',
              serverName: entry.serverName,
              name: entry.toolName,
              matched: false,
            });
          }
        }
      } catch {
        // Tool-level drift is unjudgeable when the catalog endpoint is unavailable.
      }
    }
    // Note: liveNames.size === 0 (engine reachable, no servers registered) is
    // intentionally left with NO drift rows — mirrors alignMcpName's fail-open
    // rule; we cannot judge "dead" against an empty live set.
  }

  const gaps: OrgAuditGap[] = [
    ...detectPruneGaps(drift),
    ...detectTightenGaps(
      profiles,
      liveMcpNames,
      deniedPairs,
      sessionCountByProfile,
      observationDaysByProfile,
      successfulUse,
    ),
    ...detectWebhookGaps(sessions, webhookEndpoints),
    ...detectCapabilityGaps(capabilityGapRows),
  ];

  // #934 — workflow_failure_signal_extractor.ts is itself read-only and never
  // throws (see its own module doc); still wrapped defensively here so a
  // future change to that module can never turn this READ-ONLY snapshot
  // builder into a throwing one. A degraded/failed extraction resolves to
  // `[]`, never omits the field or surfaces an error to callers.
  let workflowFailureSignals: WorkflowFailureSignal[] = [];
  try {
    workflowFailureSignals = await extractWorkflowFailureSignals();
  } catch {
    workflowFailureSignals = [];
  }

  return {
    auditRunId: randomUUID(),
    generatedAt: new Date().toISOString(),
    engineAvailable,
    profiles,
    skills,
    skillOverlapCandidates,
    recipes,
    delegationEdges,
    webhookEndpoints,
    deniedToolAggregates,
    drift,
    gaps,
    workflowFailureSignals,
  };
}
