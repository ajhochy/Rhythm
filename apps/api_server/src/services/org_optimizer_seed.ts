/**
 * org_optimizer_seed.ts — Issue #830 (org-optimizer-14, the KEYSTONE issue).
 *
 * Seeds the recurring "Org Self-Optimizer" as a name-guarded scheduled task
 * (mirrors `agentMemoryService.seedConsolidationTask()`), plus a second,
 * less-frequent scheduled task that drives the external-discovery pass
 * (decision doc §6). Both tasks are bound to their own narrowly-scoped agent
 * profile (`agent_configs` row) whose id and MCP tool grants come from a
 * REAL `.mcp-roles/<role>.mcp.json` file — this module both READS the role
 * file (for the tool-grant map, mirroring `ministry_recipes_seed.ts`) and,
 * unlike that seed, also CREATES the `agent_configs` row itself the first
 * time it runs (idempotent by the role file's own hardcoded `agentConfigId`),
 * because unlike the ministry recipes' secretary/worship-planning profiles
 * (pre-existing, human-created via the agent designer), the org-optimizer
 * profiles do not exist until this seed creates them.
 *
 * Design notes (decision doc §1/§6/§8, docs/ai/generated-issues/
 * org-optimizer-14-seeded-cron-task.md):
 *
 *  • Idempotency: scheduled tasks are guarded by NAME ("Org Self-Optimizer" /
 *    "Org External Discovery"), exactly mirroring
 *    `agentMemoryService.seedConsolidationTask()`'s own guard. The bound
 *    `agent_configs` row is guarded by ID (the role file's `agentConfigId`,
 *    a fixed UUID checked out at generation time — see the role files'
 *    header comments) via `AgentConfigsRepository.getById`.
 *  • Cadence: internal audit task is `daily` @ 02:00 (same slot as the
 *    memory-consolidation seed, chosen to run in the same low-traffic
 *    window); external-discovery task is `weekly` — deliberately LESS
 *    frequent per §6 ("throttle it ... less frequent than the internal
 *    audit"). Both times/cadences are the seed DEFAULTS; a human can edit
 *    the resulting scheduled-task rows afterward (this seed never
 *    overwrites an existing row — same non-clobber discipline as every
 *    other backfill/seed in this codebase).
 *  • Safety envelope carried in the PROMPT text (not enforced by this
 *    module, which only inserts rows): build the audit snapshot, run the
 *    generators, write deduped proposals, low-risk auto-applies, high-risk
 *    stays queued; respect the #746 cold-start window
 *    (`skill_extractor.isEngineColdStart` gates the same LLM-driven
 *    subsystems this run would use); cap proposals/LLM-calls/external-results
 *    per run so a single run cannot spiral.
 *  • Never throws — a missing/malformed role file or a DB error skips ONLY
 *    the affected task for this pass and is retried next boot (mirrors
 *    `ministry_recipes_seed.ts`'s per-recipe try/catch discipline). Boot
 *    must never be blocked by this seed.
 *  • Local-only: no-ops entirely under Postgres (agent_scheduled_tasks /
 *    agent_configs scoping is a local-SQLite agent-execution surface, same
 *    rule as every other seed in this family).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { recordSeedMarker, seedMarkerExists } from './seed_once';

// ── .mcp-roles reader (READ-ONLY for the tool-grant map; mirrors
// ministry_recipes_seed.ts's resolution strategy, generalized to a role name
// param since this seed has two roles instead of a fixed set). ─────────────

const MCP_ROLES_DIR = () =>
  process.env.MCP_ROLES_DIR ?? path.join(__dirname, '..', '..', '..', '..', '.mcp-roles');

interface McpRoleFile {
  agentConfigId: string;
  description?: string;
  mcpServers: Record<string, { inherit?: boolean; allowedTools?: string[] }>;
  allowedSkills?: string[];
}

function canonicalMcpToolsMap(roleFile: McpRoleFile): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [serverName, serverConfig] of Object.entries(roleFile.mcpServers)) {
    result[serverName] = Array.isArray(serverConfig.allowedTools)
      ? serverConfig.allowedTools.filter(
          (tool): tool is string => typeof tool === 'string' && tool.trim().length > 0,
        )
      : [];
  }
  return result;
}

function allowedSkillsScopeJson(roleFile: McpRoleFile): string | null {
  const skills = (roleFile.allowedSkills ?? []).filter(
    (skill): skill is string => typeof skill === 'string' && skill.trim().length > 0,
  );
  return skills.length > 0 ? JSON.stringify(skills) : null;
}

/**
 * Read a `.mcp-roles/<role>.mcp.json` file. Returns null (never throws) when
 * the file is absent or malformed — a missing role file must not block boot;
 * the affected task is simply skipped for this pass (retried next boot).
 */
function readRoleFile(role: string): McpRoleFile | null {
  try {
    const p = path.join(MCP_ROLES_DIR(), `${role}.mcp.json`);
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    if (
      !parsed ||
      typeof parsed.agentConfigId !== 'string' ||
      !parsed.mcpServers ||
      typeof parsed.mcpServers !== 'object'
    ) {
      return null;
    }
    return {
      agentConfigId: parsed.agentConfigId,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      mcpServers: parsed.mcpServers,
      allowedSkills: Array.isArray(parsed.allowedSkills) ? parsed.allowedSkills : undefined,
    };
  } catch (err) {
    logger.warn(`[org-optimizer-seed] could not read role file "${role}" (non-fatal): ${String(err)}`);
    return null;
  }
}

// ── Seeded prompts ──────────────────────────────────────────────────────────

const AUDIT_PROMPT = `You are the Org Self-Optimizer for Rhythm.

Your job, every run:
1. Build a fresh org audit snapshot (agent profiles + scopes, skills, the
   delegation graph, recipes, webhook wiring, and denied-tool telemetry).
2. Run the internal generators over that snapshot (scope hygiene, recipe,
   new-agent, delegation) to produce candidate proposals.
3. Write each candidate as a row in the proposal queue, DEDUPED against
   already-proposed/applied/rejected changes — never re-propose the same
   idea twice.
4. LOW-RISK proposals (tighten-scope, prune-scope, refine-skill,
   consolidate-skill, refine-recipe) auto-apply, get measured, and are kept
   or reverted automatically.
5. HIGH-RISK proposals (create-agent, grant-delegation, expand-delegation,
   broaden-scope, create-recipe, webhook-wiring) are left in the review
   queue for a human to approve or reject — NEVER apply these yourself.

Respect the engine cold-start window: if the opencode engine has not been
ready for at least 90 seconds, skip this run and try again next time it is
scheduled — do not force a run against a cold engine.

Per-run caps (never exceed these in a single run): at most 20 new proposals,
at most 40 LLM-scoring calls. Stop early and report a partial run rather than
exceeding a cap.

Report a short summary: gaps found, proposals written, how many auto-applied
vs queued.`;

const EXTERNAL_DISCOVERY_PROMPT = `You are the Org Self-Optimizer's external-discovery pass for Rhythm.

Your job, every run (weekly — this is intentionally less frequent than the
daily internal audit, since external search is expensive and noisy):
1. Read the most recent internal audit's DETECTED gaps (a recurring task with
   no good tool, a missing capability, or a repeated denied-tool pattern).
   Only act on gaps that are already on record — never invent a gap.
2. For each gap, search existing discovery sources ONLY — the mcp-registry
   MCP (search_mcp_registry / suggest_connectors / list_connectors), plus
   web/deep research when useful. Do not build or invoke any bespoke crawler.
3. For each strong candidate that fills a specific gap, write ONE
   external-adoption proposal citing the gap id (signal_ref) and a complete
   provenance/security note: source, stars/downloads, last-updated,
   maintainer, license, and the install command. A candidate with no
   provenance note is not written.
4. external-adoption proposals are ALWAYS high-risk and ALWAYS queued for
   human review — you never install or adopt anything yourself.

Per-run caps: at most 5 external candidates proposed per run. Dedup against
anything already suggested or rejected. If the internal audit has produced no
new gaps since the last discovery run, do nothing and report "no new gaps".`;

// ── Seeding ─────────────────────────────────────────────────────────────────

export interface OrgOptimizerSeedResult {
  auditTaskSeeded: boolean;
  auditTaskSkippedReason?: string;
  externalTaskSeeded: boolean;
  externalTaskSkippedReason?: string;
}

/**
 * Idempotently create (or reuse) the `agent_configs` row for a role, using
 * the role file's own hardcoded `agentConfigId` as the idempotency key. Never
 * widens/narrows an EXISTING row's scope on a later boot — only inserts once.
 */
// The seeded optimizer profiles need a concrete model or their sessions (and the
// seeded cron task's AgentRunner turn) can't resolve one at ws-gateway time and
// hang on "Waiting for output" (the #854 no-route stall). Mirror the importer's
// Tier-2 default (agent_profile_sync IMPORTER_DEFAULT_MODEL_ID = claude-sonnet-4-6),
// which is authed + in the live catalog.
const DEFAULT_OPTIMIZER_MODEL = {
  provider: 'anthropic',
  id: 'claude-sonnet-4-6',
} as const;

// Hoisted so both the #1111 reconciliation pass and the per-task seed blocks
// below share the same canonical names.
const AUDIT_TASK_NAME = 'Org Self-Optimizer';
const EXTERNAL_TASK_NAME = 'Org External Discovery';

function ensureAgentConfigForRole(
  configsRepo: AgentConfigsRepository,
  roleFile: McpRoleFile,
  label: string,
  icon: string,
): string {
  const existing = configsRepo.getById(roleFile.agentConfigId);
  if (existing) {
    // Idempotent repair: rows seeded before the model default was added carry
    // NULL model_provider/model_id → their turns stall. Backfill once; leave a
    // user-set model untouched.
    if (!existing.modelProvider || !existing.modelId) {
      configsRepo.update(existing.id, {
        modelProvider: DEFAULT_OPTIMIZER_MODEL.provider,
        modelId: DEFAULT_OPTIMIZER_MODEL.id,
      });
    }
    return existing.id;
  }

  const created = configsRepo.insert({
    id: roleFile.agentConfigId,
    label,
    icon,
    isAgent: true,
    isManager: false,
    systemPrompt: roleFile.description ?? null,
    modelProvider: DEFAULT_OPTIMIZER_MODEL.provider,
    modelId: DEFAULT_OPTIMIZER_MODEL.id,
    allowedMcpsJson: JSON.stringify(canonicalMcpToolsMap(roleFile)),
    allowedSkillsJson: allowedSkillsScopeJson(roleFile),
    sessionSelectable: false, // background/system profile — not a picker entry
  });
  return created.id;
}

/**
 * Seed the "Org Self-Optimizer" (internal audit, daily) and "Org External
 * Discovery" (weekly) scheduled tasks. Idempotent by task NAME (mirrors
 * `agentMemoryService.seedConsolidationTask`). Never throws — every failure
 * mode is caught, logged, and reflected in the returned result so the caller
 * (server boot) can log a summary without risking startup.
 */
export async function seedOrgOptimizerTask(): Promise<OrgOptimizerSeedResult> {
  const result: OrgOptimizerSeedResult = {
    auditTaskSeeded: false,
    externalTaskSeeded: false,
  };

  // No-op under Postgres: this is a local-SQLite agent-execution surface,
  // same rule as ministry_recipes_seed / obsidian_scope_backfill / the skill
  // seed importer — production Postgres never runs a local opencode engine.
  if (env.dbClient === 'postgres') {
    return result;
  }

  const schedRepo = new AgentScheduledTasksRepository();
  const configsRepo = new AgentConfigsRepository();

  // Model-backfill repair — MUST run every boot, BEFORE the task name-guards
  // below. Those guards short-circuit once the tasks exist, so the insert-time
  // model default in ensureAgentConfigForRole never fires on an already-seeded
  // install. Rows seeded before the model default carry NULL model_provider/
  // model_id → their turns (and the cron task's AgentRunner turn) stall on
  // "no route in catalog". Backfill once here; never overwrite a user-set model.
  for (const roleSlug of ['org-optimizer', 'org-external-discovery']) {
    try {
      const rf = readRoleFile(roleSlug);
      if (!rf) continue;
      const cfg = configsRepo.getById(rf.agentConfigId);
      if (cfg && (!cfg.modelProvider || !cfg.modelId)) {
        configsRepo.update(cfg.id, {
          modelProvider: DEFAULT_OPTIMIZER_MODEL.provider,
          modelId: DEFAULT_OPTIMIZER_MODEL.id,
        });
        logger.info(`[org-optimizer-seed] backfilled default model for ${roleSlug}`);
      }
    } catch (err) {
      logger.warn(`[org-optimizer-seed] model backfill for ${roleSlug} failed (non-fatal): ${String(err)}`);
    }
  }

  let existingTasks: Awaited<ReturnType<typeof schedRepo.listAllAsync>>;
  try {
    existingTasks = await schedRepo.listAllAsync();
  } catch (err) {
    const reason = `could not list scheduled tasks: ${String(err)}`;
    logger.warn(`[org-optimizer-seed] ${reason} (non-fatal)`);
    result.auditTaskSkippedReason = reason;
    result.externalTaskSkippedReason = reason;
    return result;
  }

  // ── #1111 (Discovery-003) — boot-time reconciliation ──────────────────
  // From live rhythm.db (docs/ai/generated-issues/discovery-003-unbreak-crons.md):
  // "Org Self-Optimizer" sat enabled=0 after an errored run — root cause was
  // the historical NULL-model "no route in catalog" stall (already fixed
  // above by the model backfill, commits a9c92bed6/5c4af4ae8), but that fix
  // never restored `enabled`. A stray "Org External Discovery v2" row also
  // existed, enabled=1, alongside the canonical "Org External Discovery" row
  // sitting enabled=0. This block converges each task family to exactly one
  // enabled row (preferring the exact canonical name as survivor over any
  // "<name> <suffix>" stray) and re-enables a LONE disabled survivor exactly
  // ONCE via a seed marker, so a later, deliberate user disable is never
  // auto-reversed again (the #1083 boot-stomp lesson). Disabling extra
  // duplicates is unconditional on every boot — two+ enabled rows for one
  // conceptual task is never a valid end-state. Never throws.
  for (const canonicalName of [AUDIT_TASK_NAME, EXTERNAL_TASK_NAME]) {
    try {
      const related = existingTasks.filter(
        (t) => t.name === canonicalName || t.name.startsWith(`${canonicalName} `),
      );
      if (related.length === 0) continue;

      const exactMatches = related.filter((t) => t.name === canonicalName);
      const pool = exactMatches.length > 0 ? exactMatches : related;
      const survivor = [...pool].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

      for (const row of related) {
        if (row.id !== survivor.id && row.enabled) {
          await schedRepo.updateAsync(row.id, { enabled: false });
          logger.info(
            `[org-optimizer-seed] reconciliation: disabled stale duplicate "${row.name}" (${row.id})`,
          );
        }
      }

      const reenableMarker = `reconciled_enable_v1:${canonicalName}`;
      if (related.length > 1) {
        // A genuine duplicate existed — the survivor must win regardless of
        // the marker (picking ONE enabled winner among duplicates is never
        // ambiguous w.r.t. user intent).
        if (!survivor.enabled) {
          await schedRepo.updateAsync(survivor.id, { enabled: true });
          logger.info(
            `[org-optimizer-seed] reconciliation: enabled survivor "${survivor.name}" (${survivor.id})`,
          );
        }
      } else if (!seedMarkerExists(reenableMarker)) {
        // Lone row, first time observed: repair the historical-bug leftover
        // disabled state ONCE, then lock in via the marker so a LATER,
        // deliberate user disable is respected on every subsequent boot.
        if (!survivor.enabled) {
          await schedRepo.updateAsync(survivor.id, { enabled: true });
          logger.info(
            `[org-optimizer-seed] reconciliation: re-enabled "${survivor.name}" (${survivor.id}) (one-time historical-bug repair)`,
          );
        }
        recordSeedMarker(reenableMarker);
      }
    } catch (err) {
      logger.warn(
        `[org-optimizer-seed] reconciliation for "${canonicalName}" failed (non-fatal): ${String(err)}`,
      );
    }
  }

  // ── Internal audit task (daily) ───────────────────────────────────────
  const auditMarker = `seeded_task:${AUDIT_TASK_NAME}`;
  if (existingTasks.some((t) => t.name === AUDIT_TASK_NAME)) {
    recordSeedMarker(auditMarker); // adopt pre-marker installs
    result.auditTaskSkippedReason = 'already seeded';
  } else if (seedMarkerExists(auditMarker)) {
    // Durable tombstone: the user deleted the seeded task — never resurrect it.
    result.auditTaskSkippedReason = 'deleted by user (tombstoned)';
  } else {
    const roleFile = readRoleFile('org-optimizer');
    if (!roleFile) {
      result.auditTaskSkippedReason = 'missing/malformed .mcp-roles/org-optimizer.mcp.json';
      logger.warn(
        `[org-optimizer-seed] ${result.auditTaskSkippedReason} — skipping "${AUDIT_TASK_NAME}" this pass (retried next boot)`,
      );
    } else {
      try {
        const agentConfigId = ensureAgentConfigForRole(
          configsRepo,
          roleFile,
          'Org Optimizer',
          'settings-suggest',
        );
        await schedRepo.createAsync({
          name: AUDIT_TASK_NAME,
          description:
            'Reads the org audit snapshot, runs the internal generators, writes deduped proposals, auto-applies low-risk changes, and queues high-risk changes for human review.',
          scheduleType: 'daily',
          scheduledTime: '02:00',
          timezone: 'America/Los_Angeles',
          prompt: AUDIT_PROMPT,
          agentKind: 'opencode',
          agentConfigId,
          allowedMcpsJson: JSON.stringify(canonicalMcpToolsMap(roleFile)),
          allowedSkillsJson: allowedSkillsScopeJson(roleFile) ?? undefined,
        });
        recordSeedMarker(auditMarker);
        result.auditTaskSeeded = true;
        existingTasks.push({ name: AUDIT_TASK_NAME } as (typeof existingTasks)[number]);
        logger.info(`[org-optimizer-seed] seeded "${AUDIT_TASK_NAME}" (daily @ 02:00)`);
      } catch (err) {
        result.auditTaskSkippedReason = `failed to seed: ${String(err)}`;
        logger.warn(`[org-optimizer-seed] ${result.auditTaskSkippedReason} (non-fatal)`);
      }
    }
  }

  // ── External discovery task (weekly) ──────────────────────────────────
  const externalMarker = `seeded_task:${EXTERNAL_TASK_NAME}`;
  if (existingTasks.some((t) => t.name === EXTERNAL_TASK_NAME)) {
    recordSeedMarker(externalMarker); // adopt pre-marker installs
    result.externalTaskSkippedReason = 'already seeded';
  } else if (seedMarkerExists(externalMarker)) {
    // Durable tombstone: the user deleted the seeded task — never resurrect it.
    result.externalTaskSkippedReason = 'deleted by user (tombstoned)';
  } else {
    const roleFile = readRoleFile('org-external-discovery');
    if (!roleFile) {
      result.externalTaskSkippedReason =
        'missing/malformed .mcp-roles/org-external-discovery.mcp.json';
      logger.warn(
        `[org-optimizer-seed] ${result.externalTaskSkippedReason} — skipping "${EXTERNAL_TASK_NAME}" this pass (retried next boot)`,
      );
    } else {
      try {
        const agentConfigId = ensureAgentConfigForRole(
          configsRepo,
          roleFile,
          'Org External Discovery',
          'compass',
        );
        await schedRepo.createAsync({
          name: EXTERNAL_TASK_NAME,
          description:
            'Weekly, lower-cadence pass that scouts mcp-registry/npm/GitHub/web sources for a candidate MCP server or skill filling a detected org gap, and queues an external-adoption proposal for human review.',
          scheduleType: 'weekly',
          scheduledTime: '03:00',
          scheduledDay: 0, // Sunday — quiet slot, after the daily audit has had a full week to accumulate gaps
          timezone: 'America/Los_Angeles',
          prompt: EXTERNAL_DISCOVERY_PROMPT,
          agentKind: 'opencode',
          agentConfigId,
          allowedMcpsJson: JSON.stringify(canonicalMcpToolsMap(roleFile)),
          allowedSkillsJson: allowedSkillsScopeJson(roleFile) ?? undefined,
        });
        recordSeedMarker(externalMarker);
        result.externalTaskSeeded = true;
        logger.info(`[org-optimizer-seed] seeded "${EXTERNAL_TASK_NAME}" (weekly)`);
      } catch (err) {
        result.externalTaskSkippedReason = `failed to seed: ${String(err)}`;
        logger.warn(`[org-optimizer-seed] ${result.externalTaskSkippedReason} (non-fatal)`);
      }
    }
  }

  return result;
}
