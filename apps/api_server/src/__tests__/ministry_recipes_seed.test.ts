/**
 * CONTRACT TESTS — Issue #846 (life-01): author ministry recipes as
 * exemplar scheduled task + managed skill pairs for the #823 recipe
 * generator to learn the shape from.
 *
 * Three recipes, each a (scheduled task, managed skill) pair bound to the
 * CORRECT scoped agent profile:
 *   1. Sunday service prep       — worship-planning
 *   2. Volunteer follow-up       — secretary (drafts only, never sends)
 *   3. Weekly ministry review    — secretary
 *
 * Real in-memory SQLite + real repositories. No module mocks for the DB path.
 * The managed-skills filesystem write is redirected to a per-test temp dir via
 * RHYTHM_MANAGED_SKILLS_DIR (mirrors the pattern other managed-skill tests use)
 * so this suite never touches the user's real ~/.config/opencode dir.
 *
 * Acceptance criteria proven here:
 *   AC1 (issue-846-c1): 3 scheduled tasks seeded, each bound to the correct
 *        agentConfigId (read from the real .mcp-roles/<role>.mcp.json — the
 *        base grants are asserted sufficient, never re-granted here) and each
 *        references a managed skill of the matching recipe slug.
 *   AC2 (issue-846-c2): every skill body documents the `ministry/YYYY-MM-DD-
 *        <slug>.md` vault output path and states drafts-only / no-send /
 *        no-PCO-write; the volunteer-follow-up skill never names a
 *        message-sending tool.
 *   AC3 (issue-846-c3): seeding is idempotent — three calls yield exactly 3
 *        scheduled tasks + 3 agent_skills rows, never duplicates.
 *   AC4 (issue-846-c4): every skill body has Steps/Inputs/Outputs sections and
 *        every rhythm_ / pco_ / obsidian_ prefixed tool token it names is
 *        granted to its bound role in the real .mcp-roles file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const MCP_ROLES_DIR = path.join(REPO_ROOT, '.mcp-roles');

function readRoleFile(role: string): {
  agentConfigId: string;
  mcpServers: Record<string, { allowedTools?: string[] }>;
} {
  const raw = readFileSync(path.join(MCP_ROLES_DIR, `${role}.mcp.json`), 'utf8');
  return JSON.parse(raw);
}

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Insert slug-keyed agent_configs rows for the roles these recipes bind to —
 * mirrors what `agent_profile_sync.syncOpencodeAgentProfiles` actually
 * creates in a real deployment (`id = agent.name`, i.e. the slug, NOT the
 * `.mcp-roles/<role>.mcp.json` file's own `agentConfigId` UUID — see #846
 * follow-up / docs/testing/agent-eval-matrix.md "Environment findings").
 * Without this, every recipe's role is unresolvable and seeding is a no-op —
 * this fixture reproduces the REAL, working deployment shape rather than the
 * broken pre-fix assumption that the role file's own UUID always resolves.
 */
function seedRealisticAgentConfigs() {
  const configsRepo = new AgentConfigsRepository();
  for (const slug of ['secretary', 'worship-planning']) {
    configsRepo.insert({
      id: slug,
      label: slug,
      icon: 'assets/agents/opencode.png',
      isAgent: true,
      sessionSelectable: true,
    });
  }
}

let managedSkillsDir: string;

beforeEach(() => {
  setDb(makeDb());
  seedRealisticAgentConfigs();
  const root = mkdtempSync(path.join(tmpdir(), 'ministry-recipes-test-'));
  managedSkillsDir = path.join(root, 'rhythm-managed-skills');
  process.env.RHYTHM_MANAGED_SKILLS_DIR = managedSkillsDir;
});

afterEach(() => {
  delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
  try {
    rmSync(path.dirname(managedSkillsDir), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('ministry recipes seed (#846)', () => {
  it('issue-846-c1: seeds exactly 3 scheduled tasks bound to the correct agent profile', async () => {
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
    expect(tasks).toHaveLength(3);

    // Sunday prep runs under worship-planning; both secretary recipes run
    // under secretary. This is the "CORRECT scoped agent" requirement.
    //
    // NOTE (#846 follow-up fix): the bound id is the role's SLUG
    // ('worship-planning' / 'secretary'), NOT the role file's own
    // `agentConfigId` UUID. In a real deployment that UUID is dangling — no
    // `agent_configs` row exists with that id; the live rows are slug-keyed
    // (see docs/testing/agent-eval-matrix.md "Environment findings" and
    // `seedRealisticAgentConfigs` above, which reproduces that real shape).
    // Resolution still prefers the role file's UUID FIRST when a matching
    // row exists — see `fix-recipe-binding-c1b` in
    // ministry_recipes_agent_binding.test.ts for that ordering guarantee.
    expect(sundayPrep!.agentConfigId).toBe('worship-planning');
    expect(volunteerFollowUp!.agentConfigId).toBe('secretary');
    expect(weeklyReview!.agentConfigId).toBe('secretary');

    // Each task references a managed skill of the matching recipe slug in its
    // own allowedSkillsJson (never null — the task must explicitly name the
    // skill it teaches, distinct from just inheriting the profile's full list).
    expect(JSON.parse(sundayPrep!.allowedSkillsJson!)).toContain('ministry-sunday-service-prep');
    expect(JSON.parse(volunteerFollowUp!.allowedSkillsJson!)).toContain('ministry-volunteer-follow-up');
    expect(JSON.parse(weeklyReview!.allowedSkillsJson!)).toContain('ministry-weekly-review');
  });

  it('issue-846-c1: each task also seeds an agent_skills row of the matching title', async () => {
    const { seedMinistryRecipes } = await import('../services/ministry_recipes_seed');
    await seedMinistryRecipes();

    const skillsRepo = new AgentSkillsRepository();
    const sunday = skillsRepo.findByTitle('ministry-sunday-service-prep');
    const followUp = skillsRepo.findByTitle('ministry-volunteer-follow-up');
    const review = skillsRepo.findByTitle('ministry-weekly-review');

    expect(sunday).not.toBeNull();
    expect(followUp).not.toBeNull();
    expect(review).not.toBeNull();
    expect(sunday!.body).toBeTruthy();
    expect(followUp!.body).toBeTruthy();
    expect(review!.body).toBeTruthy();
  });

  it('issue-846-c2: every skill body documents the ministry/YYYY-MM-DD-<slug>.md output path and drafts-only/no-send/no-PCO-write', async () => {
    const { seedMinistryRecipes } = await import('../services/ministry_recipes_seed');
    await seedMinistryRecipes();

    const skillsRepo = new AgentSkillsRepository();
    const bodies = [
      skillsRepo.findByTitle('ministry-sunday-service-prep')!.body!,
      skillsRepo.findByTitle('ministry-volunteer-follow-up')!.body!,
      skillsRepo.findByTitle('ministry-weekly-review')!.body!,
    ];

    for (const body of bodies) {
      expect(body).toMatch(/ministry\/YYYY-MM-DD-[a-z-]+\.md/);
    }

    // The volunteer follow-up recipe drafts messages but must never send them,
    // and must never write to PCO — this is the load-bearing safety criterion.
    const followUpBody = skillsRepo.findByTitle('ministry-volunteer-follow-up')!.body!;
    expect(followUpBody.toLowerCase()).toMatch(/draft/);
    expect(followUpBody.toLowerCase()).toMatch(/never send|do not send|no.*send/);
    expect(followUpBody).not.toMatch(/rhythm_send_message|rhythm_create_message_thread/);

    // Sunday prep reads PCO but the skill body must not instruct a PCO write.
    const sundayBody = skillsRepo.findByTitle('ministry-sunday-service-prep')!.body!;
    expect(sundayBody.toLowerCase()).toMatch(/no pco write|never writes? to pco|read-only.*pco|pco.*read-only/);
  });

  it('issue-846-c3: seeding three times in a row never duplicates tasks or skills', async () => {
    const { seedMinistryRecipes } = await import('../services/ministry_recipes_seed');
    await seedMinistryRecipes();
    await seedMinistryRecipes();
    await seedMinistryRecipes();

    const schedRepo = new AgentScheduledTasksRepository();
    const skillsRepo = new AgentSkillsRepository();

    const tasks = await schedRepo.listAllAsync();
    const ministryTasks = tasks.filter((t) =>
      ['Sunday Service Prep', 'Volunteer Follow-up', 'Weekly Ministry Review'].includes(t.name),
    );
    expect(ministryTasks).toHaveLength(3);

    const allSkills = skillsRepo.list();
    const ministrySkills = allSkills.filter((s) => s.title.startsWith('ministry-'));
    expect(ministrySkills).toHaveLength(3);
  });

  it('issue-846-c4: each skill body has Steps/Inputs/Outputs and only names tools granted to its bound role', async () => {
    const { seedMinistryRecipes } = await import('../services/ministry_recipes_seed');
    await seedMinistryRecipes();

    const skillsRepo = new AgentSkillsRepository();
    const worshipPlanning = readRoleFile('worship-planning');
    const secretary = readRoleFile('secretary');

    function grantedTools(role: { mcpServers: Record<string, { allowedTools?: string[] }> }): Set<string> {
      const out = new Set<string>();
      for (const server of Object.values(role.mcpServers)) {
        for (const tool of server.allowedTools ?? []) out.add(tool);
      }
      return out;
    }

    const cases: Array<{ title: string; grants: Set<string> }> = [
      { title: 'ministry-sunday-service-prep', grants: grantedTools(worshipPlanning) },
      { title: 'ministry-volunteer-follow-up', grants: grantedTools(secretary) },
      { title: 'ministry-weekly-review', grants: grantedTools(secretary) },
    ];

    for (const { title, grants } of cases) {
      const skill = skillsRepo.findByTitle(title)!;
      const body = skill.body!;

      expect(body).toMatch(/##?\s*Steps/i);
      expect(body).toMatch(/##?\s*Inputs/i);
      expect(body).toMatch(/##?\s*Outputs/i);

      const mentioned = new Set(body.match(/\b(rhythm|pco|obsidian)_[a-z_]+\b/g) ?? []);
      expect(mentioned.size).toBeGreaterThan(0);
      for (const tool of mentioned) {
        expect(grants.has(tool)).toBe(true);
      }
    }
  });

  it('issue-846-c1: seeding materializes each skill as a SKILL.md in the managed skills dir', async () => {
    const { seedMinistryRecipes } = await import('../services/ministry_recipes_seed');
    await seedMinistryRecipes();

    function findSkillMd(dir: string): string[] {
      if (!existsSync(dir)) return [];
      const out: string[] = [];
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...findSkillMd(full));
        else if (ent.name === 'SKILL.md') out.push(full);
      }
      return out;
    }

    const files = findSkillMd(managedSkillsDir);
    expect(files.length).toBeGreaterThanOrEqual(3);
  });
});
