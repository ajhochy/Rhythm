/**
 * CONTRACT TESTS — docs/ai/contracts/fix-recipe-binding.json
 *
 * Bug (agent-eval harness finding, #846 follow-up): `ministry_recipes_seed.ts`
 * bound the three ministry-recipe scheduled tasks to `agentConfigId` read
 * verbatim from `.mcp-roles/<role>.mcp.json`. Six role files (including
 * secretary + worship-planning, used here) carry UUIDs that match NO
 * `agent_configs` row in a real deployment — the live rows are SLUG-keyed
 * (id='secretary', id='worship-planning', ...). Seeded tasks therefore
 * referenced dangling agent ids: a correlated join count of
 * agent_configs<->agent_scheduled_tasks.agent_config_id was 0. Sessions
 * created from those tasks would 400 ("agent not configured") or run
 * unscoped.
 *
 * These tests build the exact failure condition from a fresh in-memory DB —
 * agent_configs rows keyed by SLUG only (secretary / worship-planning), never
 * by the role files' own UUIDs — and assert the required fix:
 *
 *   fix-recipe-binding-c1: fresh seed resolves via slug fallback.
 *   fix-recipe-binding-c2: idempotent repair pass re-binds already-dangling
 *     rows (0->3 join count), and running it twice never duplicates/thrashes.
 *   fix-recipe-binding-c3: a role resolvable by NEITHER uuid NOR slug is
 *     skipped — no dangling row is ever written.
 *   fix-recipe-binding-c4: the repair pass never touches a non-recipe task,
 *     even one with an equally-dangling agent_config_id.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const RECIPE_TASK_NAMES = ['Sunday Service Prep', 'Volunteer Follow-up', 'Weekly Ministry Review'];

// Real UUIDs from the checked-in .mcp-roles files (do not modify those files —
// this test only reads/reproduces their known-dangling values).
const SECRETARY_ROLE_UUID = 'd049ae2b-7f80-4e1f-bad1-e4c857472031';
const WORSHIP_PLANNING_ROLE_UUID = 'fd538791-71b0-437a-a7da-7c9192c723d0';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Insert a minimal, slug-keyed agent_configs row (mirrors syncOpencodeAgentProfiles's shape: id = slug). */
function insertSlugAgentConfig(configsRepo: AgentConfigsRepository, slug: string) {
  configsRepo.insert({
    id: slug,
    label: slug,
    icon: 'assets/agents/opencode.png',
    isAgent: true,
    sessionSelectable: true,
  });
}

async function countResolvedMinistryTaskBindings(): Promise<number> {
  const schedRepo = new AgentScheduledTasksRepository();
  const configsRepo = new AgentConfigsRepository();
  const tasks = await schedRepo.listAllAsync();
  let resolved = 0;
  for (const t of tasks) {
    if (!RECIPE_TASK_NAMES.includes(t.name)) continue;
    if (t.agentConfigId && configsRepo.getById(t.agentConfigId)) resolved++;
  }
  return resolved;
}

let managedSkillsDir: string;

beforeEach(() => {
  setDb(makeDb());
  const root = mkdtempSync(path.join(tmpdir(), 'ministry-recipes-binding-test-'));
  managedSkillsDir = path.join(root, 'rhythm-managed-skills');
  process.env.RHYTHM_MANAGED_SKILLS_DIR = managedSkillsDir;
});

afterEach(() => {
  delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
  delete process.env.MCP_ROLES_DIR;
  try {
    rmSync(path.dirname(managedSkillsDir), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('ministry recipes agent binding fix (fix-recipe-binding contract)', () => {
  it('fix-recipe-binding-c1: fresh seed resolves to slug-keyed agent_configs rows when the role file\'s agentConfigId is dangling', async () => {
    // Regression this catches: if the seed goes back to binding the role
    // file's raw (dangling) agentConfigId UUID, none of the 3 tasks will
    // join to a real agent_configs row and this count collapses to 0.
    const configsRepo = new AgentConfigsRepository();
    insertSlugAgentConfig(configsRepo, 'secretary');
    insertSlugAgentConfig(configsRepo, 'worship-planning');
    // Deliberately do NOT insert rows keyed by the role files' UUIDs — this
    // reproduces the live-DB condition the eval harness found.

    const { seedMinistryRecipes } = await import('../services/ministry_recipes_seed');
    await seedMinistryRecipes();

    const schedRepo = new AgentScheduledTasksRepository();
    const tasks = await schedRepo.listAllAsync();
    const sundayPrep = tasks.find((t) => t.name === 'Sunday Service Prep');
    const volunteerFollowUp = tasks.find((t) => t.name === 'Volunteer Follow-up');
    const weeklyReview = tasks.find((t) => t.name === 'Weekly Ministry Review');

    expect(sundayPrep).toBeDefined();
    expect(volunteerFollowUp).toBeDefined();
    expect(weeklyReview).toBeDefined();

    // Resolved to the SLUG, not the dangling role-file UUID.
    expect(sundayPrep!.agentConfigId).toBe('worship-planning');
    expect(volunteerFollowUp!.agentConfigId).toBe('secretary');
    expect(weeklyReview!.agentConfigId).toBe('secretary');
    expect(sundayPrep!.agentConfigId).not.toBe(WORSHIP_PLANNING_ROLE_UUID);
    expect(volunteerFollowUp!.agentConfigId).not.toBe(SECRETARY_ROLE_UUID);

    // The load-bearing acceptance check: correlated join count = 3.
    expect(await countResolvedMinistryTaskBindings()).toBe(3);
  });

  it('fix-recipe-binding-c1b: role file agentConfigId wins when a matching agent_configs row DOES exist (resolution order (a) before (b))', async () => {
    // Regression this catches: if resolution always falls through to the
    // slug even when the UUID is valid, a real, intentionally UUID-keyed
    // profile (e.g. org-optimizer-style) would get silently re-keyed to the
    // slug instead of honoring the role file's own explicit id.
    const configsRepo = new AgentConfigsRepository();
    configsRepo.insert({
      id: SECRETARY_ROLE_UUID,
      label: 'Secretary (uuid-keyed)',
      icon: 'assets/agents/opencode.png',
      isAgent: true,
      sessionSelectable: true,
    });
    configsRepo.insert({
      id: WORSHIP_PLANNING_ROLE_UUID,
      label: 'Worship Planning (uuid-keyed)',
      icon: 'assets/agents/opencode.png',
      isAgent: true,
      sessionSelectable: true,
    });
    // Also insert slug rows to prove the UUID match is preferred over them.
    insertSlugAgentConfig(configsRepo, 'secretary');
    insertSlugAgentConfig(configsRepo, 'worship-planning');

    const { seedMinistryRecipes } = await import('../services/ministry_recipes_seed');
    await seedMinistryRecipes();

    const schedRepo = new AgentScheduledTasksRepository();
    const tasks = await schedRepo.listAllAsync();
    const sundayPrep = tasks.find((t) => t.name === 'Sunday Service Prep');
    const volunteerFollowUp = tasks.find((t) => t.name === 'Volunteer Follow-up');

    expect(sundayPrep!.agentConfigId).toBe(WORSHIP_PLANNING_ROLE_UUID);
    expect(volunteerFollowUp!.agentConfigId).toBe(SECRETARY_ROLE_UUID);
  });

  it('fix-recipe-binding-c2: repair pass re-binds dangling ministry-recipe tasks to resolvable rows (0->3), idempotent on repeat', async () => {
    // Regression this catches: a repair pass that is missing entirely, or
    // that only fires once and never re-checks on a later boot, leaves
    // already-seeded (pre-fix) dangling rows broken forever.
    const configsRepo = new AgentConfigsRepository();
    const schedRepo = new AgentScheduledTasksRepository();

    // Simulate the PRE-FIX seeded state: tasks bound to the dangling role
    // file UUIDs, and NO agent_configs row exists for those UUIDs.
    await schedRepo.createAsync({
      name: 'Sunday Service Prep',
      scheduleType: 'weekly',
      scheduledTime: '09:00',
      scheduledDay: 3,
      prompt: 'placeholder',
      agentKind: 'opencode',
      agentConfigId: WORSHIP_PLANNING_ROLE_UUID,
      allowedSkillsJson: JSON.stringify(['ministry-sunday-service-prep']),
    });
    await schedRepo.createAsync({
      name: 'Volunteer Follow-up',
      scheduleType: 'weekly',
      scheduledTime: '08:00',
      scheduledDay: 1,
      prompt: 'placeholder',
      agentKind: 'opencode',
      agentConfigId: SECRETARY_ROLE_UUID,
      allowedSkillsJson: JSON.stringify(['ministry-volunteer-follow-up']),
    });
    await schedRepo.createAsync({
      name: 'Weekly Ministry Review',
      scheduleType: 'weekly',
      scheduledTime: '16:00',
      scheduledDay: 5,
      prompt: 'placeholder',
      agentKind: 'opencode',
      agentConfigId: SECRETARY_ROLE_UUID,
      allowedSkillsJson: JSON.stringify(['ministry-weekly-review']),
    });

    // Now the slug rows appear (as they would from syncOpencodeAgentProfiles
    // running before this repair pass on a real boot).
    insertSlugAgentConfig(configsRepo, 'secretary');
    insertSlugAgentConfig(configsRepo, 'worship-planning');

    expect(await countResolvedMinistryTaskBindings()).toBe(0);

    const { repairMinistryRecipeAgentBindings } = await import('../services/ministry_recipes_seed');
    const result = await repairMinistryRecipeAgentBindings();

    expect(await countResolvedMinistryTaskBindings()).toBe(3);
    expect(result.repaired).toBe(3);

    const tasksAfterFirstRepair = await schedRepo.listAllAsync();
    const ministryTasksAfterFirstRepair = tasksAfterFirstRepair.filter((t) =>
      RECIPE_TASK_NAMES.includes(t.name),
    );
    expect(ministryTasksAfterFirstRepair).toHaveLength(3);

    // Idempotency: running again must not duplicate rows, and since every
    // binding is already resolved, nothing more should be "repaired".
    const secondResult = await repairMinistryRecipeAgentBindings();
    expect(secondResult.repaired).toBe(0);

    const tasksAfterSecondRepair = await schedRepo.listAllAsync();
    const ministryTasksAfterSecondRepair = tasksAfterSecondRepair.filter((t) =>
      RECIPE_TASK_NAMES.includes(t.name),
    );
    expect(ministryTasksAfterSecondRepair).toHaveLength(3);
    expect(await countResolvedMinistryTaskBindings()).toBe(3);
  });

  it('fix-recipe-binding-c3: unresolvable role skips seeding the recipe and writes no task row', async () => {
    // Regression this catches: if the fallback chain silently binds to the
    // dangling UUID as a last resort instead of skipping, a dangling row
    // gets written anyway and the bug resurfaces under a different guise.
    //
    // No agent_configs rows exist at all (neither the role files' UUIDs nor
    // the 'secretary' / 'worship-planning' slugs) — every recipe should be
    // skipped with a warning, not seeded with a dangling id.
    const { seedMinistryRecipes } = await import('../services/ministry_recipes_seed');
    const result = await seedMinistryRecipes();

    const schedRepo = new AgentScheduledTasksRepository();
    const tasks = await schedRepo.listAllAsync();
    const ministryTasks = tasks.filter((t) => RECIPE_TASK_NAMES.includes(t.name));

    expect(ministryTasks).toHaveLength(0);
    expect(result.tasksSeeded).toBe(0);
    // The result must surface that these roles could not be resolved, not
    // silently report success.
    expect(result.missingRoleFiles.length + (result.unresolvedRoles?.length ?? 0)).toBeGreaterThan(0);
  });

  it('fix-recipe-binding-c4: repair pass leaves non-recipe scheduled tasks untouched even when their agent_config_id is also dangling', async () => {
    // Regression this catches: a repair pass scoped by agent_config_id alone
    // (rather than by ministry-recipe task NAME) would "fix" or otherwise
    // touch unrelated scheduled tasks that happen to share a dangling id,
    // corrupting user-owned scheduled task data outside the 3 recipes.
    const configsRepo = new AgentConfigsRepository();
    const schedRepo = new AgentScheduledTasksRepository();

    const unrelated = await schedRepo.createAsync({
      name: 'Some Unrelated User Task',
      scheduleType: 'daily',
      scheduledTime: '10:00',
      prompt: 'unrelated placeholder',
      agentKind: 'opencode',
      agentConfigId: SECRETARY_ROLE_UUID, // equally dangling
    });

    insertSlugAgentConfig(configsRepo, 'secretary');
    insertSlugAgentConfig(configsRepo, 'worship-planning');

    const { repairMinistryRecipeAgentBindings } = await import('../services/ministry_recipes_seed');
    await repairMinistryRecipeAgentBindings();

    const after = await schedRepo.findByIdAsync(unrelated.id);
    expect(after).not.toBeNull();
    expect(after!.agentConfigId).toBe(SECRETARY_ROLE_UUID); // unchanged
    expect(after!.updatedAt).toBe(unrelated.updatedAt);
  });
});
