import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';

const projectRoot = '/tmp/issue-1286-mobile-first-turn';
const profileId = 'issue-1286-restricted';

function freshDb(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
}

function insertProfile(overrides: Record<string, unknown> = {}): void {
  new AgentConfigsRepository().insert({
    id: profileId,
    label: 'Issue 1286 restricted profile',
    icon: 'shield-lock-outline',
    enabled: true,
    sessionSelectable: true,
    ocAgent: profileId,
    modelProvider: 'issue-1286-capture',
    modelId: 'capture-model',
    allowedMcpsJson: JSON.stringify({ rhythm: ['list_tasks'] }),
    allowedSkillsJson: JSON.stringify(['issue-1286-allowed-skill']),
    corePermissionsJson: JSON.stringify({
      '*': 'deny',
      read: 'allow',
    }),
    ...overrides,
  });
}

function ownershipStore() {
  return {
    isResourceOwnedBy: () => true,
    isResourceExplicitlyOwnedBy: () => true,
    claimResource: () => true,
    releaseResource: () => true,
  };
}

function projectAndUser() {
  const project = new ProjectsRepository().insert({
    name: 'Issue 1286',
    cwd: projectRoot,
    icon: null,
    vcs: {
      vcsRoot: null,
      vcsBranch: null,
      vcsDirty: false,
      vcsCheckedAt: null,
    },
  });
  const user = new UsersRepository().create({
    name: 'Issue 1286 owner',
    email: 'issue-1286@example.test',
  });
  return { project, user };
}

describe('issue #1286 mobile create-before-first-turn scope contract', () => {
  beforeEach(() => {
    freshDb();
    insertProfile();
  });

  it('issue-1286-c1: the atomic mobile create resolves MCP skill and core-tool scope before engine creation', async () => {
    // Regression caught: profileId is sent by React Native, but the gateway
    // creates the engine session before applying the profile agent/model/core
    // permissions. The captured real engine-create body exposes that gap.
    const mobileSource = readFileSync(
      resolve(__dirname, '../../../mobile/providers/opencode-provider.tsx'),
      'utf8',
    );
    const createBlock = mobileSource.match(
      /const createSession = useCallback\([\s\S]*?\n  \);\n/,
    )?.[0] ?? '';
    expect(createBlock).toContain('profileId: preferences.profileId');
    expect(createBlock.indexOf('profileId: preferences.profileId'))
      .toBeLessThan(createBlock.indexOf('sessionClient.session.create'));

    const { project, user } = projectAndUser();
    const engineBodies: Record<string, unknown>[] = [];
    const proxy = new MobileOpenCodeProxy({
      ownershipRepository: ownershipStore(),
      fetchFn: vi.fn(async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        engineBodies.push(body);
        return Response.json({
          id: 'ses-issue-1286',
          title: body.title,
          agent: body.agent,
          model: body.model,
          permission: body.permission,
          mcpAllowlist: body.mcpAllowlist,
          skillAllowlist: body.skillAllowlist,
          time: { created: 1, updated: 1 },
        });
      }),
    });

    const response = await proxy.forward({
      method: 'POST',
      path: '/session',
      query: new URLSearchParams(),
      body: { title: 'Scoped from iPhone', profileId },
      project: { id: project.id, root: projectRoot },
      userId: user.id,
    });

    expect(response.status).toBe(200);
    expect(engineBodies).toHaveLength(1);
    expect(engineBodies[0]).not.toHaveProperty('profileId');
    expect(engineBodies[0]).toMatchObject({
      agent: profileId,
      model: {
        providerID: 'issue-1286-capture',
        id: 'capture-model',
      },
      mcpAllowlist: {
        servers: [],
        tools: ['rhythm_list_tasks'],
      },
      skillAllowlist: { skills: ['issue-1286-allowed-skill'] },
      permission: [
        { permission: '*', pattern: '*', action: 'deny' },
        { permission: 'read', pattern: '*', action: 'allow' },
      ],
    });
  });

  it('issue-1286-c3: unknown disabled or non-selectable profiles fail closed before create or prompt', async () => {
    // Regression caught: an invalid profile is treated as undefined and falls
    // through to OpenCode's unrestricted defaults before the first prompt.
    new AgentConfigsRepository().update(profileId, { enabled: false });
    insertProfile({
      id: 'issue-1286-hidden',
      label: 'Issue 1286 hidden profile',
      enabled: true,
      sessionSelectable: false,
    });
    const { project, user } = projectAndUser();
    const fetchFn = vi.fn(async () =>
      Response.json({ id: 'must-not-exist' }));
    const proxy = new MobileOpenCodeProxy({
      ownershipRepository: ownershipStore(),
      fetchFn,
    });

    for (const rejectedProfileId of [
      'missing-profile',
      profileId,
      'issue-1286-hidden',
    ]) {
      await expect(proxy.forward({
        method: 'POST',
        path: '/session',
        query: new URLSearchParams(),
        body: { title: 'Must fail closed', profileId: rejectedProfileId },
        project: { id: project.id, root: projectRoot },
        userId: user.id,
      })).rejects.toMatchObject({ statusCode: 404 });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
