import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { ProjectsRepository } from '../repositories/projects_repository';
import { parseCoordinatorConversationPreparePlan } from '../contracts/coordinator_conversation_contract';
import { resolveFiniteExecutionScope } from '../services/coordinator_finite_execution_scope';

let db: Database.Database | null = null;
let previous: Database.Database | null = null;

function projectInput() {
  return {
    ownerUserId: 7,
    setupKey: 'setup-command-1',
    cwd: '/server-owned/rhythm-1',
    profileId: 'profile-a',
    name: 'Rhythm Coordinator',
    workspaceGeneration: 1,
  };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-a',
    label: 'Scoped profile',
    revision: 4,
    allowedMcpsJson: JSON.stringify({ rhythm: ['rhythm_search_memory'] }),
    allowedSkillsJson: JSON.stringify(['review-skill']),
    corePermissionsJson: JSON.stringify({ edit: { 'notes/*.md': 'ask' }, write: { 'notes/*.md': 'allow' } }),
    ...overrides,
  } as never;
}

function profileScope() {
  return {
    model: { providerID: 'provider-a', modelID: 'model-a' },
    mcpRoleConfig: {
      role: 'profile-a',
      mcpServers: { rhythm: { allowedTools: ['rhythm_search_memory'] } },
      allowedToolsJson: JSON.stringify({ rhythm: ['rhythm_search_memory'] }),
    },
    allowedSkillsJson: JSON.stringify(['review-skill']),
    systemPrompt: null,
    ocAgent: null,
    modelTierHint: null,
  } as never;
}

describe('C2 fresh setup provenance and finite execution scope', () => {
  afterEach(() => {
    setDb(previous);
    db?.close();
    db = null;
    previous = null;
  });

  it('keeps generic catalog projects unproved and persists only a server-created owner/key setup receipt', () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    previous = setDb(db);
    const projects = new ProjectsRepository();
    const generic = projects.insert({
      name: 'Generic catalog project', cwd: '/unproved/catalog', icon: null,
      vcs: { vcsRoot: null, vcsBranch: null, vcsDirty: false, vcsCheckedAt: null },
    });
    expect(projects.isCoordinatorOwnedBy(7, generic.id)).toBe(false);

    const created = projects.createCoordinatorOwned(projectInput());
    expect(created.replay).toBe(false);
    expect(projects.isCoordinatorOwnedBy(7, created.project.id)).toBe(true);
    expect(projects.isCoordinatorOwnedBy(8, created.project.id)).toBe(false);
    expect(created.project).toMatchObject({
      coordinatorOwnerUserId: 7,
      coordinatorSetupKey: 'setup-command-1',
      coordinatorSetupProvenance: 'c2_fresh_owned_workspace_v1',
      coordinatorWorkspaceGeneration: 1,
      coordinatorProfileId: 'profile-a',
    });
    // Provenance is authorization data, not a generic project DTO leak.
    expect(JSON.stringify(created.project)).not.toContain('coordinatorSetupKey');

    const replay = projects.createCoordinatorOwned({ ...projectInput(), cwd: '/must-not-replace-server-target' });
    expect(replay).toMatchObject({ replay: true, project: { id: created.project.id, cwd: '/server-owned/rhythm-1' } });
    projects.updateFields(created.project.id, { archivedAt: '2026-10-05T12:01:00.000Z' });
    expect(projects.isCoordinatorOwnedBy(7, created.project.id)).toBe(false);
  });

  it('requires the separate explicit workspace-execution acknowledgement and never upgrades a read-only purpose', () => {
    const base = {
      sessionId: 'root-a', projectId: 'project-a', expectedControlRevision: 1, goalId: 'goal-a',
      admission: {
        commandKey: 'execute-a', totalTokenAuthorization: 512, maxTurns: 1,
        maxWallTimeSeconds: 300, expiresInSeconds: 300,
        acknowledgesSoftTotalTokenAuthorization: true, purpose: 'execute',
      },
    };
    expect(() => parseCoordinatorConversationPreparePlan(base)).toThrow();
    expect(parseCoordinatorConversationPreparePlan({
      ...base,
      admission: { ...base.admission, acknowledgesScopedWorkspaceExecution: true },
    }).admission).toMatchObject({ purpose: 'execute', acknowledgesScopedWorkspaceExecution: true });
    expect(() => parseCoordinatorConversationPreparePlan({
      ...base,
      admission: {
        ...base.admission,
        purpose: 'decompose',
        acknowledgesScopedWorkspaceExecution: true,
      },
    })).toThrow();
  });

  it('derives a finite engine ruleset only from current owned workspace/profile grants and preserves hard denials', () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    previous = setDb(db);
    const project = new ProjectsRepository().createCoordinatorOwned(projectInput()).project;
    const resolved = resolveFiniteExecutionScope({
      ownerUserId: 7,
      project,
      profile: profile(),
      profileScope: profileScope(),
      parentCwd: '/server-owned/rhythm-1',
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.permissionRules).toEqual(expect.arrayContaining([
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: 'bash', pattern: '*', action: 'deny' },
      { permission: 'external_directory', pattern: '*', action: 'deny' },
      { permission: 'edit', pattern: '/server-owned/rhythm-1/notes/*.md', action: 'ask' },
      { permission: 'write', pattern: '/server-owned/rhythm-1/notes/*.md', action: 'allow' },
    ]));
    expect(resolved?.preview).toMatchObject({
      projectId: project.id, workspaceGeneration: 1, profileId: 'profile-a', profileRevision: 4,
    });
    expect(resolved?.targetCwd).toBe('/server-owned/rhythm-1');

    expect(resolveFiniteExecutionScope({
      ownerUserId: 7, project, profile: profile({ allowedMcpsJson: null }), profileScope: profileScope(), parentCwd: project.cwd,
    })).toBeNull();
    expect(resolveFiniteExecutionScope({
      ownerUserId: 7, project, profile: profile({ allowedSkillsJson: null }), profileScope: profileScope(), parentCwd: project.cwd,
    })).toBeNull();
    expect(resolveFiniteExecutionScope({
      ownerUserId: 7, project, profile: profile({ corePermissionsJson: JSON.stringify({ bash: 'allow' }) }), profileScope: profileScope(), parentCwd: project.cwd,
    })).toBeNull();
    expect(resolveFiniteExecutionScope({
      ownerUserId: 7, project, profile: profile(), profileScope: profileScope(), parentCwd: '/other-target',
    })).toBeNull();
    expect(resolveFiniteExecutionScope({
      ownerUserId: 7,
      project: { ...project, cwd: '/server-owned/rhythm-1/' },
      profile: profile(),
      profileScope: profileScope(),
      parentCwd: '/server-owned/rhythm-1/',
    })).toBeNull();
    expect(resolveFiniteExecutionScope({
      ownerUserId: 7,
      project,
      profile: profile({ corePermissionsJson: JSON.stringify({ write: { '../outside.md': 'allow' } }) }),
      profileScope: profileScope(),
      parentCwd: project.cwd,
    })).toBeNull();
  });
});
