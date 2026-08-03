import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  expandProfileSkillAllowlist,
  resolveProfileScope,
} from '../services/agent_profile_scope';
import {
  OpencodeClientService,
} from '../services/opencode_client_service';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';

const profileId = 'secretary';
const projectRoot = '/tmp/issue-1282';
const title = 'Issue 1282 mobile scope parity';

function freshDb(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
}

function insertSecretary(): void {
  new AgentConfigsRepository().insert({
    id: profileId,
    label: 'Secretary',
    icon: 'mail',
    enabled: true,
    sessionSelectable: true,
    ocAgent: 'secretary',
    modelProvider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    allowedMcpsJson: JSON.stringify([
      'rhythm',
      'gmail-work',
    ]),
    allowedSkillsJson: JSON.stringify([
      'email-triage',
      'calendar-coordination',
    ]),
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

describe('issue #1282 mobile session-create scope parity', () => {
  beforeEach(() => {
    freshDb();
    insertSecretary();
  });

  it(
    'issue-1282-c1: mobile and desktop send identical profile scope to the engine',
    async () => {
      const scope = await resolveProfileScope(profileId);
      const desktopBodies: Record<string, unknown>[] = [];
      const desktop = new OpencodeClientService();
      desktop.__setTestClient({
        session: {
          create: vi.fn(async (input: { body: Record<string, unknown> }) => {
            desktopBodies.push(input.body);
            return { data: { id: 'ses-desktop-1282' } };
          }),
        },
      } as never);
      await desktop.createSession(
        title,
        projectRoot,
        scope.mcpRoleConfig ?? undefined,
        expandProfileSkillAllowlist(scope.allowedSkillsJson)?.skills,
        scope.model.providerID,
      );

      const projectId = new ProjectsRepository().insert({
        name: 'Issue 1282',
        cwd: projectRoot,
        icon: null,
        vcs: {
          vcsRoot: null,
          vcsBranch: null,
          vcsDirty: false,
          vcsCheckedAt: null,
        },
      }).id;
      const userId = new UsersRepository().create({
        name: 'Issue 1282 owner',
        email: 'issue-1282@example.com',
      }).id;
      const mobileBodies: Record<string, unknown>[] = [];
      const mobile = new MobileOpenCodeProxy({
        ownershipRepository: ownershipStore(),
        fetchFn: vi.fn(async (_input, init) => {
          mobileBodies.push(
            JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
          );
          return Response.json({
            id: 'ses-mobile-1282',
            title,
            directory: projectRoot,
            agent: 'secretary',
          });
        }),
      });

      await mobile.forward({
        method: 'POST',
        path: '/session',
        query: new URLSearchParams(),
        body: { title, profileId },
        project: { id: projectId, root: projectRoot },
        userId,
      });

      expect(desktopBodies).toHaveLength(1);
      expect(mobileBodies).toHaveLength(1);
      expect(mobileBodies[0]).not.toHaveProperty('profileId');
      expect(mobileBodies[0]).toMatchObject({
        title,
        mcpAllowlist: desktopBodies[0].mcpAllowlist,
        skillAllowlist: desktopBodies[0].skillAllowlist,
      });
      expect(mobileBodies[0].mcpAllowlist).toEqual(
        desktopBodies[0].mcpAllowlist,
      );
      expect(mobileBodies[0].skillAllowlist).toEqual(
        desktopBodies[0].skillAllowlist,
      );
    },
  );

  it(
    'issue-1282-c2: mobile sends the selected profile in the create request',
    () => {
      const providerSource = readFileSync(
        resolve(
          __dirname,
          '../../../mobile/providers/opencode-provider.tsx',
        ),
        'utf8',
      );
      const createBlock = providerSource.match(
        /const createSession = useCallback\([\s\S]*?\n  \);\n/,
      )?.[0] ?? '';

      expect(createBlock).toContain('profileId: preferences.profileId');
      expect(createBlock.indexOf('profileId: preferences.profileId'))
        .toBeLessThan(createBlock.indexOf('sessionClient.session.create'));
    },
  );

  it(
    'issue-1282-c3: an unknown mobile profile is rejected before engine create',
    async () => {
      const fetchFn = vi.fn(async () =>
        Response.json({ id: 'must-not-be-created' }));
      const mobile = new MobileOpenCodeProxy({
        ownershipRepository: ownershipStore(),
        fetchFn,
      });

      await expect(mobile.forward({
        method: 'POST',
        path: '/session',
        query: new URLSearchParams(),
        body: { title, profileId: 'unknown-profile' },
        project: { id: 'project-1282', root: projectRoot },
        userId: 1282,
      })).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );
});
