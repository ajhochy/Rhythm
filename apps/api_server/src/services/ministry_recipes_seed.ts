/**
 * Ministry Recipes Seed — Issue #846 (life-01)
 *
 * Author three exemplar "ministry" recipes as scheduled task + managed skill
 * pairs, each running under the CORRECT scoped agent profile:
 *
 *   1. Sunday Service Prep     — worship-planning
 *      Pull the next PCO plan, check needed positions/blockouts, draft
 *      setlist notes + a prep checklist as a vault note.
 *   2. Volunteer Follow-up     — secretary
 *      Find unfilled positions this week and DRAFT follow-up messages for
 *      human approval. NEVER sends anything.
 *   3. Weekly Ministry Review  — secretary
 *      Digest tasks/rhythms/messages into a vault note with top-3 next
 *      actions.
 *
 * These are exemplars for the #823 recipe generator to learn the shape from
 * (issue-846-c4): every skill body documents Inputs / Steps / Outputs, and
 * every recipe writes ONLY to a vault note under `ministry/` — never an
 * unapproved outbound message, never a PCO write.
 *
 * Design notes:
 *  • Each recipe = one `agent_scheduled_tasks` row (agentSchedulerService
 *    pattern, mirrors agentMemoryService.seedConsolidationTask) + one
 *    `agent_skills` row materialized to a SKILL.md via
 *    rhythm_managed_skills.writeManagedSkill (mirrors skill_materializer's
 *    "published DB skill → filesystem" path).
 *  • The task's `agentConfigId` is RESOLVED, not read verbatim, from the LIVE
 *    `.mcp-roles/<role>.mcp.json` file (see `resolveAgentConfigId` below):
 *    (a) the role file's own `agentConfigId` UUID, IF a matching
 *    `agent_configs` row exists; else (b) the role's SLUG (the role file's
 *    name, e.g. "secretary"), IF a row keyed by that slug exists (this is how
 *    `agent_profile_sync.syncOpencodeAgentProfiles` actually keys these rows
 *    — `id = agent.name`); else (c) the recipe is skipped for this pass with
 *    a one-line warning, never bound to a dangling id. This fixes a bug
 *    (agent-eval harness finding, #846 follow-up) where six role files'
 *    `agentConfigId` UUIDs matched NO `agent_configs` row in a real
 *    deployment (the live rows are slug-keyed), so all 3 ministry-recipe
 *    tasks were seeded pointing at a dangling agent id — a session created
 *    from such a task would 400 ("agent not configured") or run unscoped.
 *    This repo's ownership rules for #846 forbid touching `.mcp-roles/*.json`
 *    — we only READ it; the fix lives entirely in resolution, not the data.
 *  • The task's own `allowedMcpsJson` is built directly from the role file's
 *    `mcpServers` map (the exact tool grants already declared there — never
 *    re-granted, never invented) so the scheduled run gets the SAME
 *    fine-grained MCP scope the role file promises, via
 *    `resolveProfileScope`'s tools-map pass-through
 *    (see agent_profile_scope.ts `_buildMcpRoleConfig`, format 2).
 *  • Idempotent: guarded by scheduled-task NAME (mirrors
 *    seedConsolidationTask) and by agent_skills TITLE (mirrors
 *    seedAgentStackSkills / skill_seed_importer). Re-running is a no-op.
 *  • Never throws — boot-time seeding must not block startup. No-op under
 *    Postgres (agent_scheduled_tasks / agent_skills scoping is local-SQLite
 *    agent-execution surface, consistent with every other backfill in this
 *    file's family).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { recordSeedMarker, seedMarkerExists } from './seed_once';
import { writeManagedSkill, managedSkillsRoot, slugForSkillName } from './rhythm_managed_skills';
import { opencodeClient } from './opencode_engine';

// ── .mcp-roles reader (READ-ONLY — never writes; mirrors the path-resolution
// pattern in agent_sessions_controller.ts's resolveMcpRole, scoped down to
// just what seeding needs: agentConfigId + the mcpServers tool-grant map). ──

const MCP_ROLES_DIR =
  process.env.MCP_ROLES_DIR ?? path.join(__dirname, '..', '..', '..', '..', '.mcp-roles');

interface McpRoleFile {
  agentConfigId: string;
  mcpServers: Record<string, { inherit?: boolean; allowedTools?: string[] }>;
}

/**
 * Read a `.mcp-roles/<role>.mcp.json` file. Returns null (never throws) when
 * the file is absent or malformed — a missing role file must not block boot;
 * the affected recipe is simply skipped for this pass (retried next boot).
 */
function readRoleFile(role: string): McpRoleFile | null {
  try {
    const p = path.join(MCP_ROLES_DIR, `${role}.mcp.json`);
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
    return { agentConfigId: parsed.agentConfigId, mcpServers: parsed.mcpServers };
  } catch (err) {
    logger.warn(`[ministry-recipes-seed] could not read role file "${role}" (non-fatal): ${String(err)}`);
    return null;
  }
}

/**
 * Resolve the REAL `agent_configs.id` to bind a ministry-recipe task to,
 * given the role file's own claimed `agentConfigId` and the role's slug
 * (its file name, e.g. "secretary").
 *
 * Resolution order (never bind to a dangling id):
 *   (a) the role file's `agentConfigId` UUID, IF `agent_configs` has a row
 *       with that id (a genuinely UUID-keyed profile, e.g. a hand-created
 *       one from the agent designer, or one a seed like org_optimizer_seed
 *       created itself);
 *   (b) else the role's SLUG, IF `agent_configs` has a row keyed by that
 *       slug (this is how `agent_profile_sync.syncOpencodeAgentProfiles`
 *       actually keys these rows in a real deployment — `id = agent.name`);
 *   (c) else `null` — the caller must skip seeding/leave unrepaired rather
 *       than bind to a dangling id.
 *
 * Never throws — a `getById` failure (e.g. DB unavailable) is treated as
 * "not found" for that candidate and resolution continues to the next one.
 */
function resolveAgentConfigId(
  configsRepo: AgentConfigsRepository,
  roleFile: Pick<McpRoleFile, 'agentConfigId'>,
  slug: string,
): string | null {
  try {
    if (configsRepo.getById(roleFile.agentConfigId)) return roleFile.agentConfigId;
  } catch (err) {
    logger.warn(
      `[ministry-recipes-seed] agent_configs lookup failed for id "${roleFile.agentConfigId}" (non-fatal): ${String(err)}`,
    );
  }
  try {
    if (configsRepo.getById(slug)) return slug;
  } catch (err) {
    logger.warn(
      `[ministry-recipes-seed] agent_configs lookup failed for slug "${slug}" (non-fatal): ${String(err)}`,
    );
  }
  return null;
}

// ── Recipe definitions ──────────────────────────────────────────────────────

interface MinistryRecipe {
  /** Scheduled task name — the idempotency key on agent_scheduled_tasks. */
  taskName: string;
  /** agent_skills title / managed-skill frontmatter name — the idempotency key on agent_skills. */
  skillTitle: string;
  description: string;
  role: 'worship-planning' | 'secretary';
  scheduleType: 'weekly';
  scheduledTime: string;
  scheduledDay: number; // 0=Sunday .. 6=Saturday (JS Date convention, matches computeNextRun)
  body: string;
}

const RECIPES: MinistryRecipe[] = [
  {
    taskName: 'Sunday Service Prep',
    skillTitle: 'ministry-sunday-service-prep',
    description:
      'Pull the next Sunday plan from PCO, check needed positions and blockouts, and draft setlist notes + a prep checklist as a vault note.',
    role: 'worship-planning',
    scheduleType: 'weekly',
    scheduledTime: '09:00',
    scheduledDay: 3, // Wednesday — enough runway before the coming Sunday
    body: `# Sunday Service Prep

## When to use
Runs weekly to prepare for the coming Sunday service: pulls the current plan
from Planning Center, surfaces unfilled positions and scheduling conflicts,
and drafts a setlist + prep checklist for the worship team.

## Inputs
- The next upcoming Sunday plan (via \`get_plans\` + \`get_plan_items\`).
- Needed/unfilled positions for that plan (via \`get_needed_positions\`).
- Blockout / availability data for scheduled team members (via
  \`get_person_blockouts\`, \`get_person_plan_schedule\`).
- Song and arrangement details for the plan's setlist (via \`get_songs\`,
  \`find_song_by_title\`, \`get_arrangement_for_song\`,
  \`get_keys_for_arrangement_of_song\`).

## Steps
1. Call \`get_plans\` to find the next upcoming Sunday service plan.
2. Call \`get_plan_items\` to read the full plan (songs, elements, order of
   service).
3. Call \`get_needed_positions\` to find any position on the plan that still
   needs a person assigned.
4. For each scheduled team member, cross-reference \`get_person_blockouts\` and
   \`get_person_plan_schedule\` to flag any conflict (a person scheduled while
   blocked out).
5. For each song on the plan, resolve arrangement + key details via
   \`get_songs\` / \`find_song_by_title\` / \`get_arrangement_for_song\` /
   \`get_keys_for_arrangement_of_song\` to compile setlist notes (title, key,
   arrangement).
6. Compose a prep checklist: unfilled positions, scheduling conflicts, and any
   song without a resolved arrangement/key.
7. Write the setlist notes + prep checklist to a vault note at
   \`ministry/YYYY-MM-DD-sunday-service-prep.md\` (date = the plan's service
   date) via \`obsidian_put_file\`.
8. Optionally cross-link the note from a Rhythm task via
   \`rhythm_create_task\` (e.g. "Review Sunday prep notes") so it surfaces on
   the dashboard.

## Outputs
- One vault note per run at \`ministry/YYYY-MM-DD-sunday-service-prep.md\`
  containing: the setlist (song, key, arrangement), unfilled positions, and
  any scheduling conflicts.
- No PCO write of any kind — this recipe is READ-ONLY against Planning
  Center. It never calls \`schedule_person_to_plan\`, \`assign_person_to_item\`,
  \`update_plan_item\`, \`add_song_to_plan\`, \`update_plan\`, or
  \`update_scheduled_person\`. A human reviews the vault note and makes any
  PCO changes themselves.
`,
  },
  {
    taskName: 'Volunteer Follow-up',
    skillTitle: 'ministry-volunteer-follow-up',
    description:
      'Find unfilled volunteer positions for the week and draft follow-up messages for human approval. Never sends anything.',
    role: 'secretary',
    scheduleType: 'weekly',
    scheduledTime: '08:00',
    scheduledDay: 1, // Monday — start of the work week
    body: `# Volunteer Follow-up

## When to use
Runs weekly to find volunteer positions that are still unfilled for the
coming week and draft polite follow-up messages a human can review and send.

## Inputs
- Open Rhythm tasks related to volunteer scheduling (via
  \`rhythm_list_tasks\`).
- Recent message threads for context on who has already been contacted (via
  \`rhythm_list_message_threads\`).
- Calendar events for the week, to anchor which services/events need
  coverage (via \`rhythm_list_calendar_events\`).

## Steps
1. Call \`rhythm_list_tasks\` to find any open task tagged or named around
   volunteer scheduling / unfilled positions for the coming week.
2. Call \`rhythm_list_calendar_events\` to confirm which events in the next 7
   days need volunteer coverage.
3. Call \`rhythm_list_message_threads\` to check whether a follow-up has
   already gone out for each open gap (avoid duplicate asks).
4. For each still-unfilled position/gap, DRAFT a short, warm follow-up
   message (do not send it) asking the person or team to confirm
   availability or volunteer.
5. Compile all drafts into a single vault note at
   \`ministry/YYYY-MM-DD-volunteer-follow-up.md\` — one section per draft,
   including who it is addressed to and the position/gap it covers.
6. Optionally create a Rhythm task via \`rhythm_create_task\` prompting a human
   to review and send the drafted messages.

## Outputs
- One vault note per run at \`ministry/YYYY-MM-DD-volunteer-follow-up.md\`
  containing DRAFT ONLY follow-up messages, each clearly labeled with its
  recipient and the unfilled position it addresses.
- NEVER SEND: this recipe never calls a message-sending tool. No outbound
  message is dispatched without a human explicitly approving and sending it
  themselves — drafts are for review only, not autonomous delivery.
`,
  },
  {
    taskName: 'Weekly Ministry Review',
    skillTitle: 'ministry-weekly-review',
    description:
      'Digest the week across tasks, rhythms, and messages into a vault note with the top 3 next actions.',
    role: 'secretary',
    scheduleType: 'weekly',
    scheduledTime: '16:00',
    scheduledDay: 5, // Friday — wrap up the week
    body: `# Weekly Ministry Review

## When to use
Runs weekly (end of week) to produce a digest of ministry activity across
tasks, rhythms, and messages, ending with the top 3 next actions to focus on.

## Inputs
- Open and recently completed tasks (via \`rhythm_list_tasks\`).
- Active recurring rhythms (via \`rhythm_list_rhythms\`).
- Recent message thread activity (via \`rhythm_list_message_threads\`).
- The overall dashboard summary for cross-checking counts (via
  \`rhythm_get_dashboard\`).

## Steps
1. Call \`rhythm_get_dashboard\` for a high-level summary (open task count,
   active rhythms, upcoming due dates).
2. Call \`rhythm_list_tasks\` to enumerate what was completed this week and
   what remains open or overdue.
3. Call \`rhythm_list_rhythms\` to check which recurring rhythms ran on
   schedule and which slipped.
4. Call \`rhythm_list_message_threads\` to note any thread with unanswered
   activity in the past week.
5. Synthesize the above into a short digest: what got done, what's stuck,
   what's coming up.
6. Identify the top 3 next actions — the highest-leverage items to focus on
   next week — and list them clearly at the top of the note.
7. Write the digest + top-3 next actions to a vault note at
   \`ministry/YYYY-MM-DD-weekly-review.md\` via \`obsidian_put_file\`.

## Outputs
- One vault note per run at \`ministry/YYYY-MM-DD-weekly-review.md\`
  containing: a top-3 next-actions list, task/rhythm/message digest, and any
  flagged risks (overdue tasks, slipped rhythms, unanswered threads).
- No outbound message and no PCO write — this recipe only reads Rhythm data
  and writes a single vault note.
`,
  },
];

// ── Vault filename convention (documented for #823) ─────────────────────────

/** `ministry/YYYY-MM-DD-<slug>.md` — the shared output-path convention every recipe documents in its skill body. */
export function ministryNoteFilename(slug: string, date: Date = new Date()): string {
  const iso = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return `ministry/${iso}-${slug}.md`;
}

// ── Seeding ─────────────────────────────────────────────────────────────────

export interface MinistryRecipesSeedResult {
  tasksSeeded: number;
  tasksSkipped: number;
  skillsSeeded: number;
  skillsSkipped: number;
  missingRoleFiles: string[];
  /**
   * Recipes whose role file was present and well-formed but whose
   * `agentConfigId` could not be resolved to ANY real `agent_configs` row
   * (neither the role file's own UUID nor its slug) — the recipe was
   * skipped for this pass rather than bound to a dangling id.
   */
  unresolvedRoles: string[];
}

/**
 * Idempotently seed the three ministry recipes: one `agent_scheduled_tasks`
 * row + one `agent_skills` row (materialized to a SKILL.md) per recipe.
 *
 * Idempotency:
 *  - Scheduled task: skipped if a task with the same NAME already exists
 *    (mirrors agentMemoryService.seedConsolidationTask).
 *  - Skill: skipped if a skill with the same TITLE already exists (mirrors
 *    skill_seed_importer.seedAgentStackSkills / AgentSkillsRepository.findByTitle).
 *
 * Never throws. A missing/malformed role file skips ONLY that recipe (logged)
 * so one bad role file can't block the other two recipes from seeding.
 */
export async function seedMinistryRecipes(): Promise<MinistryRecipesSeedResult> {
  const result: MinistryRecipesSeedResult = {
    tasksSeeded: 0,
    tasksSkipped: 0,
    skillsSeeded: 0,
    skillsSkipped: 0,
    missingRoleFiles: [],
    unresolvedRoles: [],
  };

  // No-op under Postgres: agent_scheduled_tasks scoping + agent_skills
  // materialization are local-SQLite agent-execution surfaces (same rule as
  // obsidian_scope_backfill / skill_seed_importer) — production Postgres
  // never runs a local opencode engine to schedule against.
  if (env.dbClient === 'postgres') {
    return result;
  }

  const schedRepo = new AgentScheduledTasksRepository();
  const configsRepo = new AgentConfigsRepository();

  let existingTasks: Awaited<ReturnType<typeof schedRepo.listAllAsync>>;
  try {
    existingTasks = await schedRepo.listAllAsync();
  } catch (err) {
    logger.warn(`[ministry-recipes-seed] could not list scheduled tasks (non-fatal): ${String(err)}`);
    return result;
  }

  for (const recipe of RECIPES) {
    // ── Managed skill FILE (idempotent, write-if-absent) ─────────────────
    // #977 — the SKILL.md file is the SOLE content source. Do not create a
    // `published` agent_skills row mirroring the body (the retired DB→file
    // shadow). Write the file only when ABSENT so a self-improvement
    // refinement of an already-seeded file is never clobbered on a later boot
    // (#929/#957 regression class). Lifecycle metadata attaches to the live
    // file by NAME via the #792 sidecar when the auto-apply loop first touches
    // the skill — no seed row is needed.
    try {
      const location = path.join(
        managedSkillsRoot(),
        slugForSkillName(recipe.skillTitle),
        'SKILL.md',
      );
      if (existsSync(location)) {
        result.skillsSkipped += 1;
      } else {
        writeManagedSkill({
          name: recipe.skillTitle,
          description: recipe.description,
          body: recipe.body,
        });
        result.skillsSeeded += 1;
      }
    } catch (err) {
      logger.warn(
        `[ministry-recipes-seed] failed to seed skill "${recipe.skillTitle}" (non-fatal): ${String(err)}`,
      );
      continue; // don't seed a task for a recipe whose skill failed
    }

    // ── Scheduled task (idempotent by name + durable tombstone) ──────────
    const taskMarker = `seeded_task:${recipe.taskName}`;
    const alreadySeeded = existingTasks.some((t) => t.name === recipe.taskName);
    if (alreadySeeded) {
      recordSeedMarker(taskMarker); // adopt pre-marker installs
      result.tasksSkipped += 1;
      continue;
    }
    // Durable tombstone: the user deleted this seeded task — never resurrect it.
    if (seedMarkerExists(taskMarker)) {
      result.tasksSkipped += 1;
      continue;
    }

    const roleFile = readRoleFile(recipe.role);
    if (!roleFile) {
      result.missingRoleFiles.push(recipe.role);
      logger.warn(
        `[ministry-recipes-seed] missing/malformed role file for "${recipe.role}" — skipping task "${recipe.taskName}" this pass (retried next boot)`,
      );
      continue;
    }

    // Resolve the REAL agent_configs row to bind — (a) role file's own
    // agentConfigId if it exists, else (b) the role's slug if THAT row
    // exists, else skip. Never bind a dangling id (see resolveAgentConfigId
    // doc comment for the full rationale — #846 follow-up fix).
    const resolvedAgentConfigId = resolveAgentConfigId(configsRepo, roleFile, recipe.role);
    if (!resolvedAgentConfigId) {
      result.unresolvedRoles.push(recipe.role);
      logger.warn(
        `[ministry-recipes-seed] could not resolve a real agent_configs row for role "${recipe.role}" ` +
          `(neither its agentConfigId "${roleFile.agentConfigId}" nor its slug "${recipe.role}" match an existing row) ` +
          `— skipping task "${recipe.taskName}" this pass (retried next boot)`,
      );
      continue;
    }

    try {
      await schedRepo.createAsync({
        name: recipe.taskName,
        description: recipe.description,
        scheduleType: recipe.scheduleType,
        scheduledTime: recipe.scheduledTime,
        scheduledDay: recipe.scheduledDay,
        timezone: 'America/Los_Angeles',
        prompt: `You are running the "${recipe.skillTitle}" ministry recipe skill. Follow its documented Steps exactly. Write your output as a single vault note at ${ministryNoteFilename(recipe.skillTitle.replace(/^ministry-/, ''))} (date = today). Do not send any message and do not write to PCO — this recipe is draft/read-only only.`,
        agentKind: 'opencode',
        agentConfigId: resolvedAgentConfigId,
        // Task's own allowedMcpsJson = the role file's own tool grants,
        // passed straight through as the tools-map format
        // resolveProfileScope._buildMcpRoleConfig already understands. This
        // reuses the base grants verbatim — it never widens or invents a tool.
        allowedMcpsJson: JSON.stringify(roleFile.mcpServers),
        allowedSkillsJson: JSON.stringify([recipe.skillTitle]),
      });
      recordSeedMarker(taskMarker);
      result.tasksSeeded += 1;
      existingTasks.push({ name: recipe.taskName } as (typeof existingTasks)[number]);
    } catch (err) {
      logger.warn(
        `[ministry-recipes-seed] failed to seed task "${recipe.taskName}" (non-fatal): ${String(err)}`,
      );
    }
  }

  // Best-effort reload so newly-materialized skills are immediately
  // discoverable without waiting for the next natural reload. Never throws.
  try {
    await opencodeClient.reloadSkills();
  } catch (err) {
    logger.warn(`[ministry-recipes-seed] reloadSkills failed (non-fatal): ${String(err)}`);
  }

  logger.info(
    `[ministry-recipes-seed] tasksSeeded=${result.tasksSeeded} tasksSkipped=${result.tasksSkipped} ` +
      `skillsSeeded=${result.skillsSeeded} skillsSkipped=${result.skillsSkipped} ` +
      `missingRoleFiles=${result.missingRoleFiles.join(',') || 'none'} ` +
      `unresolvedRoles=${result.unresolvedRoles.join(',') || 'none'}`,
  );

  return result;
}

// ── Repair pass (idempotent) ────────────────────────────────────────────────

export interface MinistryRecipeRepairResult {
  /** Ministry-recipe task rows whose agent_config_id was re-bound this pass. */
  repaired: number;
  /** Ministry-recipe task rows found dangling but still unresolvable (role/slug both missing). */
  stillUnresolved: string[];
}

/** Task name → recipe role, derived from RECIPES so the repair pass and the
 * seed share one source of truth for "which role does this recipe belong to". */
const RECIPE_ROLE_BY_TASK_NAME: ReadonlyMap<string, MinistryRecipe['role']> = new Map(
  RECIPES.map((r) => [r.taskName, r.role]),
);

/**
 * Idempotent boot-time repair for ministry-recipe scheduled task rows seeded
 * BEFORE this fix, whose `agent_config_id` points at a dangling id (the
 * role file's UUID, when no `agent_configs` row exists for it).
 *
 * Scope: ONLY rows whose `name` is one of the three ministry-recipe task
 * names (`RECIPE_ROLE_BY_TASK_NAME`'s keys). A non-recipe scheduled task is
 * never inspected or modified, even if it happens to share a dangling
 * agent_config_id with a recipe task — this repair pass has no way to know a
 * non-recipe task's intended role, and must never guess.
 *
 * A row is left alone (not a "repair") if its current `agent_config_id`
 * already resolves to a real `agent_configs` row — this makes repeated calls
 * idempotent: the second call in a row finds nothing left to repair and
 * performs zero writes, so it can safely run on every boot.
 *
 * Never throws — a DB error is logged and the pass returns having repaired
 * whatever it could before the error (or nothing, if the initial list call
 * itself failed). No-op under Postgres (agent_scheduled_tasks / agent_configs
 * scoping is a local-SQLite agent-execution surface, same rule as every seed
 * in this file's family).
 */
export async function repairMinistryRecipeAgentBindings(): Promise<MinistryRecipeRepairResult> {
  const result: MinistryRecipeRepairResult = { repaired: 0, stillUnresolved: [] };

  if (env.dbClient === 'postgres') {
    return result;
  }

  const schedRepo = new AgentScheduledTasksRepository();
  const configsRepo = new AgentConfigsRepository();

  let tasks: Awaited<ReturnType<typeof schedRepo.listAllAsync>>;
  try {
    tasks = await schedRepo.listAllAsync();
  } catch (err) {
    logger.warn(`[ministry-recipes-seed] repair pass could not list scheduled tasks (non-fatal): ${String(err)}`);
    return result;
  }

  for (const task of tasks) {
    const role = RECIPE_ROLE_BY_TASK_NAME.get(task.name);
    if (!role) continue; // not a ministry-recipe task — never touched by this pass

    // Already resolvable — nothing to repair (this is what makes re-running
    // this pass on every boot idempotent and a no-op once fixed).
    if (task.agentConfigId && configsRepo.getById(task.agentConfigId)) continue;

    const roleFile = readRoleFile(role);
    if (!roleFile) {
      result.stillUnresolved.push(task.name);
      logger.warn(
        `[ministry-recipes-seed] repair: missing/malformed role file for "${role}" — leaving "${task.name}" unrepaired this pass (retried next boot)`,
      );
      continue;
    }

    const resolvedAgentConfigId = resolveAgentConfigId(configsRepo, roleFile, role);
    if (!resolvedAgentConfigId) {
      result.stillUnresolved.push(task.name);
      logger.warn(
        `[ministry-recipes-seed] repair: could not resolve a real agent_configs row for role "${role}" ` +
          `— leaving "${task.name}" unrepaired this pass (retried next boot)`,
      );
      continue;
    }

    try {
      await schedRepo.updateAsync(task.id, { agentConfigId: resolvedAgentConfigId });
      result.repaired += 1;
      logger.info(
        `[ministry-recipes-seed] repair: re-bound "${task.name}" from dangling agent_config_id ` +
          `"${task.agentConfigId ?? 'null'}" to "${resolvedAgentConfigId}"`,
      );
    } catch (err) {
      logger.warn(
        `[ministry-recipes-seed] repair: failed to update "${task.name}" (non-fatal): ${String(err)}`,
      );
    }
  }

  return result;
}
