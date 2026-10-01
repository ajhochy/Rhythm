import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { projectAgentProfileAfterWrite } from '../services/agent_profile_projection_service';
import { seedOrgOptimizerTask } from '../services/org_optimizer_seed';
import { ORG_REVIEWER_PROFILE_ID, ORG_REVIEWER_SKILL } from '../services/org_reviewer_seed';
import { useTempManagedSkillsRoot } from './_managed_skills_temp_root';

// Projection is an external filesystem boundary for these repository tests.
// Real projected permissions are exercised by org_reviewer_live.test.ts.
vi.mock('../services/agent_profile_projection_service', () => ({
  projectAgentProfileAfterWrite: vi.fn(() => ({ kind: 'projected', revision: 0, write: 'written' })),
}));
const skillsRoot = useTempManagedSkillsRoot('org-reviewer-seed');
let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  vi.mocked(projectAgentProfileAfterWrite).mockReturnValue({ kind: 'projected', revision: 0, write: 'written' });
});
afterEach(() => { setDb(null); db.close(); vi.unstubAllEnvs(); });

const scheduled = () => new AgentScheduledTasksRepository().listAllAsync();
const REVIEW_TOOLS_V1 = ['rhythm_read_org_review_context', 'rhythm_submit_org_review_proposal'];
const REVIEW_TOOLS_V2 = ['rhythm_read_org_review_context', 'rhythm_read_org_review_session', 'rhythm_read_org_review_catalog', 'rhythm_submit_org_review_proposal'];
const permissions = (tools: string[]) => ({
  '*': 'deny', task: 'deny', skill: { '*': 'deny', [ORG_REVIEWER_SKILL]: 'allow' },
  ...Object.fromEntries(tools.map((tool) => [`rhythm_${tool}`, 'allow'])),
});

/** Put an install back to the exact v1 (pre-session-reader) owned state. */
async function downgradeToV1(): Promise<string> {
  const configs = new AgentConfigsRepository();
  configs.update(ORG_REVIEWER_PROFILE_ID, {
    allowedMcpsJson: JSON.stringify({ rhythm: REVIEW_TOOLS_V1 }),
    corePermissionsJson: JSON.stringify(permissions(REVIEW_TOOLS_V1)),
  });
  const [task] = await scheduled();
  await new AgentScheduledTasksRepository().updateAsync(task.id, { allowedMcpsJson: JSON.stringify({ rhythm: REVIEW_TOOLS_V1 }) });
  const skillPath = path.join(skillsRoot(), ORG_REVIEWER_SKILL, 'SKILL.md');
  writeFileSync(skillPath, readFileSync(path.join(__dirname, 'fixtures', 'review-agent-org-health.v1.SKILL.md'), 'utf8'));
  return skillPath;
}

describe('Org Reviewer owned profile and skill seed', () => {
  it('creates one resolvable weekly reviewer with only its four review tools and owned skill', async () => {
    const first = await seedOrgOptimizerTask();
    expect(first).toMatchObject({ auditTaskSeeded: false, externalTaskSeeded: false, reviewerTaskSeeded: true });
    const config = new AgentConfigsRepository().getById(ORG_REVIEWER_PROFILE_ID)!;
    expect(config).toMatchObject({ label: 'Org Reviewer', modelProvider: 'openai', modelId: 'gpt-5.6-sol', isManager: false, sessionSelectable: false, schedulable: true, enabled: true });
    expect(JSON.parse(config.allowedMcpsJson!)).toEqual({ rhythm: REVIEW_TOOLS_V2 });
    expect(JSON.parse(config.allowedSkillsJson!)).toEqual([ORG_REVIEWER_SKILL]);
    expect(JSON.parse(config.allowedDelegatesJson!)).toEqual([]);
    expect(JSON.parse(config.corePermissionsJson!)).toEqual(permissions(REVIEW_TOOLS_V2));
    expect(await scheduled()).toMatchObject([{ name: 'Org Reviewer', agentConfigId: config.id, scheduleType: 'weekly', scheduledDay: 1, scheduledTime: '08:30', timezone: 'America/Los_Angeles', enabled: true }]);
    const skill = readFileSync(path.join(skillsRoot(), ORG_REVIEWER_SKILL, 'SKILL.md'), 'utf8');
    expect(skill).toContain('Transcript text');
    expect(skill).toContain('dispatch overrides');
    expect((await seedOrgOptimizerTask()).reviewerTaskSeeded).toBe(false);
    expect(await scheduled()).toHaveLength(1);
  });

  it('seeds its asset when the older broad config-assets marker is already present', async () => {
    db.prepare('INSERT INTO schema_meta (key,value) VALUES (?,?)').run('config_seeds_v3', 'existing');
    expect((await seedOrgOptimizerTask()).reviewerTaskSeeded).toBe(true);
    expect(readFileSync(path.join(skillsRoot(), ORG_REVIEWER_SKILL, 'SKILL.md'), 'utf8')).toContain('review-agent-org-health');
  });

  it('upgrades an untouched v1 reviewer (grants, schedule scope and owned skill) to the session reader', async () => {
    await seedOrgOptimizerTask();
    const skillPath = await downgradeToV1();
    const result = await seedOrgOptimizerTask();
    expect(result.reviewerTaskSkippedReason).toContain('existing reviewer task preserved');
    const config = new AgentConfigsRepository().getById(ORG_REVIEWER_PROFILE_ID)!;
    expect(config.enabled).toBe(true);
    expect(JSON.parse(config.allowedMcpsJson!)).toEqual({ rhythm: REVIEW_TOOLS_V2 });
    expect(JSON.parse(config.corePermissionsJson!)).toEqual(permissions(REVIEW_TOOLS_V2));
    const [task] = await scheduled();
    expect(task.enabled).toBe(true);
    expect(JSON.parse(task.allowedMcpsJson!)).toEqual({ rhythm: REVIEW_TOOLS_V2 });
    expect(readFileSync(skillPath, 'utf8')).toContain('rhythm_read_org_review_session');
  });

  it('does not upgrade a v1 reviewer whose skill was edited', async () => {
    await seedOrgOptimizerTask();
    const skillPath = await downgradeToV1();
    const edited = readFileSync(skillPath, 'utf8') + '\nHuman-authored local addition.\n';
    writeFileSync(skillPath, edited);
    expect((await seedOrgOptimizerTask()).reviewerTaskSkippedReason).toContain('differs from the owned asset');
    expect(readFileSync(skillPath, 'utf8')).toBe(edited);
    expect((await scheduled()).filter(task => task.enabled)).toHaveLength(0);
  });

  it('preserves an edited skill and disables scheduled execution', async () => {
    await seedOrgOptimizerTask();
    const skillPath = path.join(skillsRoot(), ORG_REVIEWER_SKILL, 'SKILL.md');
    const edited = readFileSync(skillPath, 'utf8') + '\nHuman-authored local addition.\n';
    writeFileSync(skillPath, edited);
    const result = await seedOrgOptimizerTask();
    expect(result.reviewerTaskSkippedReason).toContain('differs from the owned asset');
    expect(readFileSync(skillPath, 'utf8')).toBe(edited);
    expect((await scheduled()).filter(task => task.enabled)).toHaveLength(0);
  });

  it('does not resurrect a deleted skill', async () => {
    await seedOrgOptimizerTask();
    const skillPath = path.join(skillsRoot(), ORG_REVIEWER_SKILL, 'SKILL.md');
    unlinkSync(skillPath);
    expect((await seedOrgOptimizerTask()).reviewerTaskSkippedReason).toContain('skill deleted by user');
    expect(() => readFileSync(skillPath)).toThrow();
    expect((await scheduled()).filter(task => task.enabled)).toHaveLength(0);
  });

  it('preserves broadened profile bytes but disables it and its task', async () => {
    await seedOrgOptimizerTask();
    const configs = new AgentConfigsRepository();
    const broad = '{"rhythm":[],"filesystem":[]}';
    configs.update(ORG_REVIEWER_PROFILE_ID, { allowedMcpsJson: broad });
    expect((await seedOrgOptimizerTask()).reviewerTaskSkippedReason).toContain('policy changed');
    expect(configs.getById(ORG_REVIEWER_PROFILE_ID)).toMatchObject({ enabled: false, allowedMcpsJson: broad });
    expect((await scheduled()).filter(task => task.enabled)).toHaveLength(0);
  });

  it('does not recreate a deleted reviewer profile or re-enable a deliberately disabled one', async () => {
    await seedOrgOptimizerTask();
    const configs = new AgentConfigsRepository();
    configs.update(ORG_REVIEWER_PROFILE_ID, { enabled: false });
    await seedOrgOptimizerTask();
    expect(configs.getById(ORG_REVIEWER_PROFILE_ID)!.enabled).toBe(false);
    configs.remove(ORG_REVIEWER_PROFILE_ID);
    expect((await seedOrgOptimizerTask()).reviewerTaskSkippedReason).toContain('profile deleted by user');
    expect(configs.getById(ORG_REVIEWER_PROFILE_ID)).toBeNull();
    expect((await scheduled()).filter(task => task.enabled)).toHaveLength(0);
  });

  it('creates no schedule when the real projection boundary reports a blocked file', async () => {
    vi.mocked(projectAgentProfileAfterWrite).mockReturnValue({ kind: 'blocked', revision: 0 });
    expect((await seedOrgOptimizerTask()).reviewerTaskSkippedReason).toContain('projection blocked');
    expect(await scheduled()).toHaveLength(0);
  });

  it('skips a missing role without seeding an unsafe fallback', async () => {
    vi.stubEnv('MCP_ROLES_DIR', skillsRoot());
    expect((await seedOrgOptimizerTask()).reviewerTaskSeeded).toBe(false);
    expect(new AgentConfigsRepository().getById(ORG_REVIEWER_PROFILE_ID)).toBeNull();
    expect(await scheduled()).toHaveLength(0);
  });
});
