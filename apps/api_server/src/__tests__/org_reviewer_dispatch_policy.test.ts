import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ config: null as Record<string, any> | null, markers: new Set<string>(), updates: [] as Array<Record<string, unknown>> }));

vi.mock('../config/env', () => ({
  env: { agentExecutionEnabled: true, dbClient: 'sqlite' },
  opencodeDataFile: (name: string) => `/private/tmp/org-reviewer-seed-test/${name}`,
  opencodeConfigFile: (name: string) => `/private/tmp/org-reviewer-seed-test/${name}`,
  resolveWebsearchConfig: () => ({}),
  GEMINI_CODE_ASSIST_PROJECT_ID: 'private-test-project',
}));
vi.mock('../repositories/agent_configs_repository', () => ({
  AgentConfigsRepository: class {
    getById() { return state.config; }
    insert(input: Record<string, unknown>) { state.config = { locked: false, imageGenerationEnabled: false, autoApproveActions: false, ocAgent: null, ...input }; return state.config; }
    update(_id: string, patch: Record<string, unknown>) {
      state.updates.push(patch);
      state.config = { ...state.config, ...patch };
      return state.config;
    }
  },
}));
vi.mock('../repositories/agent_scheduled_tasks_repository', () => ({
  AgentScheduledTasksRepository: class {
    async listAllAsync() { return []; }
    async updateAsync() {}
    async createAsync() { throw new Error('fixture must not create a schedule'); }
  },
}));
vi.mock('../services/agent_profile_projection_service', () => ({
  projectAgentProfileAfterWrite: () => ({ kind: 'projected' }),
}));
vi.mock('../services/config_seeds_seeder', () => ({
  configSeedsSourceDir: () => process.env.TEST_REVIEWER_SEED_DIR,
}));
vi.mock('../services/rhythm_managed_skills', () => ({
  readManagedSkillBytes: () => undefined,
  writeManagedSkill: () => undefined,
}));
vi.mock('../services/seed_once', () => ({
  recordSeedMarker: (marker: string) => state.markers.add(marker),
  seedMarkerExists: (marker: string) => state.markers.has(marker) || marker === 'seeded_task:Org Reviewer:v1',
}));
vi.mock('../utils/logger', () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

const currentMcp = { rhythm: [
  'rhythm_read_org_review_context',
  'rhythm_read_org_review_session',
  'rhythm_read_org_review_catalog',
  'rhythm_submit_org_review_proposal',
] };
const oldCurrentPermissions = {
  '*': 'deny', task: 'deny', skill: { '*': 'deny', 'review-agent-org-health': 'allow' },
  rhythm_rhythm_read_org_review_context: 'allow',
  rhythm_rhythm_read_org_review_session: 'allow',
  rhythm_rhythm_read_org_review_catalog: 'allow',
  rhythm_rhythm_submit_org_review_proposal: 'allow',
};
const v1Mcp = { rhythm: ['rhythm_read_org_review_context', 'rhythm_submit_org_review_proposal'] };
const v1Permissions = {
  '*': 'deny', task: 'deny', skill: { '*': 'deny', 'review-agent-org-health': 'allow' },
  rhythm_rhythm_read_org_review_context: 'allow',
  rhythm_rhythm_submit_org_review_proposal: 'allow',
};

let seedDir = '';
let rolesDir = '';
let previousMcpRolesDir: string | undefined;
let previousTestSeedDir: string | undefined;
let moduleUnderTest: typeof import('../services/org_reviewer_seed');

function configFor(allowedMcps: unknown, permissions: unknown) {
  return {
    id: 'org-reviewer', label: 'Org Reviewer', icon: 'fact-check',
    isAgent: true, isManager: false, locked: false, enabled: true,
    imageGenerationEnabled: false, autoApproveActions: false, schedulable: true,
    ocAgent: null, allowedMcpsJson: JSON.stringify(allowedMcps),
    allowedSkillsJson: '["review-agent-org-health"]',
    corePermissionsJson: JSON.stringify(permissions), allowedDelegatesJson: '[]',
  };
}

async function seed() {
  return moduleUnderTest.seedOrgReviewerTask();
}

beforeEach(async () => {
  previousMcpRolesDir = process.env.MCP_ROLES_DIR;
  previousTestSeedDir = process.env.TEST_REVIEWER_SEED_DIR;
  seedDir = mkdtempSync(join(tmpdir(), 'org-reviewer-seed-'));
  rolesDir = mkdtempSync(join(tmpdir(), 'org-reviewer-role-'));
  mkdirSync(join(seedDir, 'skills', 'review-agent-org-health'), { recursive: true });
  mkdirSync(rolesDir, { recursive: true });
  writeFileSync(join(seedDir, 'skills', 'review-agent-org-health', 'SKILL.md'),
    '---\nname: review-agent-org-health\ndescription: Review owned session evidence\n---\nUse verified evidence only.\n');
  writeFileSync(join(rolesDir, 'org-reviewer.mcp.json'), JSON.stringify({
    agentConfigId: 'org-reviewer',
    allowedSkills: ['review-agent-org-health'],
    mcpServers: { rhythm: { allowedTools: currentMcp.rhythm } },
  }));
  process.env.MCP_ROLES_DIR = rolesDir;
  process.env.TEST_REVIEWER_SEED_DIR = seedDir;
  state.config = null;
  state.markers.clear();
  state.updates = [];
  vi.resetModules();
  moduleUnderTest = await import('../services/org_reviewer_seed');
});

afterEach(() => {
  rmSync(seedDir, { recursive: true, force: true });
  rmSync(rolesDir, { recursive: true, force: true });
  if (previousMcpRolesDir === undefined) delete process.env.MCP_ROLES_DIR;
  else process.env.MCP_ROLES_DIR = previousMcpRolesDir;
  if (previousTestSeedDir === undefined) delete process.env.TEST_REVIEWER_SEED_DIR;
  else process.env.TEST_REVIEWER_SEED_DIR = previousTestSeedDir;
  vi.clearAllMocks();
});

describe('Org Reviewer deferred dispatcher policy', () => {
  it('seeds the deferred dispatcher control while keeping the four-tool MCP allowlist exact', async () => {
    await seed();
    const permissions = JSON.parse(state.config!.corePermissionsJson as string);
    const mcps = JSON.parse(state.config!.allowedMcpsJson as string);
    expect(permissions.mcp_dispatch).toBe('allow');
    expect(permissions['*']).toBe('deny');
    expect(Object.keys(permissions).sort()).toEqual([
      '*', 'mcp_dispatch', 'rhythm_rhythm_read_org_review_catalog',
      'rhythm_rhythm_read_org_review_context', 'rhythm_rhythm_read_org_review_session',
      'rhythm_rhythm_submit_org_review_proposal', 'skill', 'task',
    ].sort());
    expect(mcps).toEqual(currentMcp);
    expect(state.config!.enabled).toBe(true);
  });

  it('upgrades the exact previous four-tool policy without widening other profile fields', async () => {
    state.config = configFor(currentMcp, oldCurrentPermissions);
    await seed();
    expect(state.updates).toEqual([{ corePermissionsJson: moduleUnderTest.ORG_REVIEWER_CORE_PERMISSIONS_JSON }]);
    expect(state.config!.allowedMcpsJson).toBe(JSON.stringify(currentMcp));
    expect(state.config!.enabled).toBe(true);
  });

  it('refuses a previous four-tool policy whose wildcard moved last', async () => {
    const { '*': wildcard, ...specific } = oldCurrentPermissions;
    const reordered = { ...specific, '*': wildcard };
    state.config = configFor(currentMcp, reordered);
    await expect(seed()).resolves.toMatchObject({
      skippedReason: expect.stringContaining('reviewer profile policy changed; disabled pending review'),
    });
    expect(state.config!.enabled).toBe(false);
    expect(state.config!.corePermissionsJson).toBe(JSON.stringify(reordered));
    expect(state.updates).toEqual([{ enabled: false }]);
  });

  it('refuses a previous policy whose nested skill wildcard moved last', async () => {
    const reordered = { ...oldCurrentPermissions,
      skill: { 'review-agent-org-health': 'allow', '*': 'deny' } };
    state.config = configFor(currentMcp, reordered);
    await expect(seed()).resolves.toMatchObject({
      skippedReason: expect.stringContaining('reviewer profile policy changed; disabled pending review'),
    });
    expect(state.config!.enabled).toBe(false);
    expect(state.config!.corePermissionsJson).toBe(JSON.stringify(reordered));
    expect(state.updates).toEqual([{ enabled: false }]);
  });

  it('accepts canonical ordered permissions despite JSON whitespace', async () => {
    state.config = configFor(currentMcp, oldCurrentPermissions);
    state.config.corePermissionsJson = JSON.stringify(oldCurrentPermissions, null, 2);
    await seed();
    expect(state.updates).toEqual([{ corePermissionsJson: moduleUnderTest.ORG_REVIEWER_CORE_PERMISSIONS_JSON }]);
    expect(state.config!.enabled).toBe(true);
  });

  it('keeps the exact V1 two-tool migration path', async () => {
    state.config = configFor(v1Mcp, v1Permissions);
    await seed();
    expect(state.config!.allowedMcpsJson).toBe(JSON.stringify(currentMcp));
    expect(JSON.parse(state.config!.corePermissionsJson as string).mcp_dispatch).toBe('allow');
    expect(state.config!.enabled).toBe(true);
  });

  it('fails closed for any unrecognized permission drift', async () => {
    state.config = configFor(currentMcp, { ...oldCurrentPermissions, task: 'allow' });
    await expect(seed()).resolves.toMatchObject({
      skippedReason: expect.stringContaining('reviewer profile policy changed; disabled pending review'),
    });
    expect(state.config!.enabled).toBe(false);
    expect(JSON.parse(state.config!.corePermissionsJson as string).task).toBe('allow');
  });
});
