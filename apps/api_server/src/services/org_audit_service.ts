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

import { opencodeClient } from './opencode_engine';
import { alignMcpName } from './mcp_name_alignment';
import { AgentConfigsRepository, type AgentConfig } from '../repositories/agent_configs_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentCookbookRepository } from '../repositories/agent_cookbook_repository';
import { AgentWebhookEndpointsRepository } from '../repositories/agent_webhook_endpoints_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  DeniedToolEventsRepository,
  type DeniedToolEvent,
} from '../repositories/denied_tool_events_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import {
  extractWorkflowFailureSignals,
  type WorkflowFailureSignal,
} from './workflow_failure_signal_extractor';
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
  allowedMcps: string[];
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
  scopeKind: 'mcp' | 'skill';
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
  kind: 'prune-scope' | 'tighten-scope' | 'webhook-wiring';
  evidence: string;
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
  workflowFailureSignals: WorkflowFailureSignal[];
}

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
  return {
    id: config.id,
    label: config.label,
    isManager: config.isManager,
    enabled: config.enabled,
    allowedMcps: parseJsonStringArray(config.allowedMcpsJson),
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
 * Resolve a `denied_tool_events` row's profile when `agent_config_id` is
 * null (the #838 bridge-seam gap) by joining through `session_id ->
 * agent_sessions.mcpRole`, validated against a real `agent_configs.id`
 * (mirrors the resolution the bridge itself performs, documented in
 * denied_tool_events_repository.ts's module header).
 */
function resolveAgentConfigId(
  event: DeniedToolEvent,
  sessionsById: Map<string, AgentSession>,
  validConfigIds: Set<string>,
): string | null {
  if (event.agentConfigId && validConfigIds.has(event.agentConfigId)) {
    return event.agentConfigId;
  }
  if (!event.sessionId) return null;
  const session = sessionsById.get(event.sessionId);
  if (!session) return null;
  if (session.mcpRole && validConfigIds.has(session.mcpRole)) return session.mcpRole;
  if (session.agentKind && validConfigIds.has(session.agentKind)) return session.agentKind;
  return null;
}

function aggregateDeniedTool(
  events: DeniedToolEvent[],
  sessionsRepo: AgentSessionsRepository,
  validConfigIds: Set<string>,
): DeniedToolAggregate[] {
  const sessionsById = new Map<string, AgentSession>();
  for (const event of events) {
    if (event.sessionId && !sessionsById.has(event.sessionId)) {
      const session = sessionsRepo.findById(event.sessionId);
      if (session) sessionsById.set(event.sessionId, session);
    }
  }

  const counts = new Map<string, DeniedToolAggregate>();
  for (const event of events) {
    const agentConfigId = resolveAgentConfigId(event, sessionsById, validConfigIds);
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
      gapId: stableGapId('prune-scope', d.profileId, d.scopeKind, d.name),
      kind: 'prune-scope' as const,
      evidence: `profile=${d.profileId} scopeKind=${d.scopeKind} deadName=${d.name}`,
    }));
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
 */
export function detectTightenGaps(
  profiles: ProfileScopeSnapshot[],
  liveMcpNames: Set<string>,
  deniedPairs: Set<string>,
  sessionCountByProfile: Map<string, number>,
  observationDaysByProfile: Map<string, number>,
): OrgAuditGap[] {
  if (liveMcpNames.size === 0) return [];
  const gaps: OrgAuditGap[] = [];
  for (const profile of profiles) {
    const sessionCount = sessionCountByProfile.get(profile.id) ?? 0;
    const observationDays = observationDaysByProfile.get(profile.id) ?? 0;
    if (sessionCount < MIN_TIGHTEN_ACTIVITY_COUNT) continue;
    if (observationDays < MIN_TIGHTEN_OBSERVATION_DAYS) continue;
    for (const name of profile.allowedMcps) {
      const { resolved, matched } = alignMcpName(name, liveMcpNames);
      if (!matched) continue; // dead names are prune candidates, not tighten
      const deniedKey = `${profile.id}::${resolved}`;
      if (deniedPairs.has(deniedKey)) continue; // it WAS exercised (denied counts as exercised-attempt)
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
  const messagesRepo = new AgentSessionMessagesRepository();

  const configs = configsRepo.list();
  const profiles = configs.map(toProfileScopeSnapshot);
  const validConfigIds = new Set(configs.map((c) => c.id));

  const skills = skillsRepo.list();
  const skillOverlapCandidates = findSkillOverlapCandidates(skills);

  const recipes = await cookbookRepo.listAllAsync();
  const webhookEndpoints = await webhookRepo.listAsync();
  const delegationEdges = buildDelegationEdges(profiles);

  const sessions = sessionsRepo.listAll(1000, { includeArchived: true });
  const sessionIds = sessions.map((s) => s.id);
  const messages = messagesRepo.listBySessionIds(sessionIds);
  const workflowFailureSignals = extractWorkflowFailureSignals(sessions, messages);

  const sessionCountByProfile = new Map<string, number>();
  for (const session of sessions) {
    if (!session.mcpRole) continue;
    sessionCountByProfile.set(
      session.mcpRole,
      (sessionCountByProfile.get(session.mcpRole) ?? 0) + 1,
    );
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
  const deniedToolAggregates = aggregateDeniedTool(deniedEvents, sessionsRepo, validConfigIds);
  const deniedPairs = new Set(
    deniedToolAggregates
      .filter((d) => d.agentConfigId !== null)
      .map((d) => `${d.agentConfigId}::${d.toolName}`),
  );

  // ── Engine-gated section (#746 cold-start guard) ─────────────────────────
  const engineAvailable = opencodeClient.isReady;
  let drift: AllowlistDrift[] = [];
  let liveMcpNames = new Set<string>();

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
      for (const profile of profiles) {
        for (const name of profile.allowedMcps) {
          const { matched } = alignMcpName(name, liveMcpNames);
          if (!matched) {
            drift.push({ profileId: profile.id, scopeKind: 'mcp', name, matched: false });
          }
        }
      }
    }
    // Note: liveNames.size === 0 (engine reachable, no servers registered) is
    // intentionally left with NO drift rows — mirrors alignMcpName's fail-open
    // rule; we cannot judge "dead" against an empty live set.
  }

  const gaps: OrgAuditGap[] = [
    ...detectPruneGaps(drift),
    ...detectTightenGaps(profiles, liveMcpNames, deniedPairs, sessionCountByProfile, observationDaysByProfile),
    ...detectWebhookGaps(sessions, webhookEndpoints),
  ];

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
