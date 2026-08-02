import Database from 'better-sqlite3';
import type { NextFunction, Request, Response, Router } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import {
  asOpenCodeAgentId,
  asRhythmProfileId,
} from '../models/agent_session';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { MobileOpenCodeOwnershipRepository } from '../repositories/mobile_opencode_ownership_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import { createMobileGatewayRouter } from '../routes/mobile_gateway_routes';
import {
  MobileOpenCodeProxy,
  type MobileOpenCodeForwardInput,
} from '../services/mobile_opencode_proxy';

const PROFILE_ID = 'coding-workflow';
const OPENCODE_AGENT_ID = 'coding-agent';

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });

interface RouteLayer {
  route?: {
    path: string;
    stack: Array<{
      handle: (
        req: Request,
        res: Response,
        next: NextFunction,
      ) => void;
    }>;
  };
}

function patchSessionState(
  router: Router,
  input: {
    sessionId: string;
    ownerUserId: number;
    project: MobileOpenCodeForwardInput['project'];
  },
): Promise<Record<string, unknown>> {
  const layer = (router as unknown as { stack: RouteLayer[] }).stack.find(
    (candidate) => candidate.route?.path === '/sessions/:id/state',
  );
  const handler = layer?.route?.stack.at(-1)?.handle;
  if (!handler) throw new Error('PATCH session state handler not found');

  return new Promise((resolve, reject) => {
    handler(
      {
        params: { id: input.sessionId },
        body: {
          profileId: PROFILE_ID,
          opencodeAgentId: OPENCODE_AGENT_ID,
          providerId: 'anthropic',
          modelId: 'claude-sonnet',
          thinkingBudget: 4096,
          permissionMode: 'plan',
        },
        mobileDevice: { userId: input.ownerUserId },
        mobileProject: input.project,
      } as unknown as Request,
      { json: resolve } as unknown as Response,
      reject,
    );
  });
}

describe('issue #1286 projectless mobile profile state reads', () => {
  let db: Database.Database;
  let sessions: AgentSessionsRepository;
  let ownership: MobileOpenCodeOwnershipRepository;
  let ownerA: number;
  let ownerB: number;
  let project: MobileOpenCodeForwardInput['project'];
  let otherProjectId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    sessions = new AgentSessionsRepository();
    ownership = new MobileOpenCodeOwnershipRepository(db);

    const users = new UsersRepository();
    ownerA = users.create({
      name: 'Issue 1286 Owner A',
      email: 'issue-1286-owner-a@example.test',
    }).id;
    ownerB = users.create({
      name: 'Issue 1286 Owner B',
      email: 'issue-1286-owner-b@example.test',
    }).id;

    const projects = new ProjectsRepository();
    const selectedProject = projects.insert({
      name: 'Issue 1286 routing project',
      cwd: '/sandbox/issue-1286/project',
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    });
    project = { id: selectedProject.id, root: selectedProject.cwd };
    otherProjectId = projects.insert({
      name: 'Issue 1286 different project',
      cwd: '/sandbox/issue-1286/other-project',
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    }).id;

    new AgentConfigsRepository().insert({
      id: PROFILE_ID,
      label: 'Coding Workflow',
      icon: 'code',
      ocAgent: OPENCODE_AGENT_ID,
      sessionSelectable: true,
    });
  });

  afterEach(() => db.close());

  const catalogSession = (
    sdkSessionId: string,
    ownerUserId: number,
    projectId: string | null,
  ) => {
    const local = sessions.insert({
      agentKind: 'codex',
      profileId: asRhythmProfileId(PROFILE_ID),
      opencodeAgentId: asOpenCodeAgentId(OPENCODE_AGENT_ID),
      taskId: null,
      cwd: projectId === otherProjectId
        ? '/sandbox/issue-1286/other-project'
        : '/sandbox/issue-1286/home',
      name: sdkSessionId,
      projectId,
      ownerUserId,
      category: 'chat',
      isSystem: false,
      scheduledTaskId: null,
    });
    sessions.setSdkSessionId(local.id, sdkSessionId);
    return local.id;
  };

  it('issue-1286-c1: owner-unscoped discovery attaches the exact-owner projectless rhythm state only', async () => {
    catalogSession('ses-projectless-owner', ownerA, null);
    catalogSession('ses-other-owner', ownerB, null);
    catalogSession('ses-other-project', ownerA, otherProjectId);
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      fetchFn: async () => {
        throw new Error('owner-unscoped discovery must use the local catalog');
      },
    });

    const response = await proxy.forward({
      method: 'GET',
      path: '/experimental/session',
      query: new URLSearchParams({ limit: '100' }),
      project,
      userId: ownerA,
      ownerUnscopedDiscovery: true,
    });
    const body = JSON.parse(Buffer.from(response.body).toString('utf8')) as
      Array<Record<string, unknown>>;

    expect(body.find(({ id }) => id === 'ses-projectless-owner')).toMatchObject({
      rhythm: {
        profileId: PROFILE_ID,
        opencodeAgentId: OPENCODE_AGENT_ID,
      },
    });
    expect(body.find(({ id }) => id === 'ses-other-project'))
      .not.toHaveProperty('rhythm');
    expect(body.find(({ id }) => id === 'ses-other-owner')).toBeUndefined();
  });

  it('issue-1286-c2: regular session.list attaches rhythm for an exact-owner projectless session', async () => {
    catalogSession('ses-projectless-list', ownerA, null);
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      fetchFn: async () => json([{
        id: 'ses-projectless-list',
        directory: project.root,
      }]),
    });

    const response = await proxy.forward({
      method: 'GET',
      path: '/session',
      query: new URLSearchParams(),
      project,
      userId: ownerA,
    });
    const body = JSON.parse(Buffer.from(response.body).toString('utf8')) as
      Array<Record<string, unknown>>;

    expect(body).toEqual([
      expect.objectContaining({
        id: 'ses-projectless-list',
        rhythm: expect.objectContaining({
          profileId: PROFILE_ID,
          opencodeAgentId: OPENCODE_AGENT_ID,
        }),
      }),
    ]);
  });

  it('issue-1286-c5: an unbound row attaches no rhythm so engine state is never masked', async () => {
    const local = sessions.insert({
      agentKind: 'codex',
      profileId: null,
      opencodeAgentId: null,
      taskId: null,
      cwd: '/sandbox/issue-1286/home',
      name: 'ses-unbound',
      projectId: null,
      ownerUserId: ownerA,
      category: 'chat',
      isSystem: false,
      scheduledTaskId: null,
    });
    sessions.setSdkSessionId(local.id, 'ses-unbound');
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      fetchFn: async () => json([{
        id: 'ses-unbound',
        directory: project.root,
        agent: 'coding-workflow',
      }]),
    });

    const response = await proxy.forward({
      method: 'GET',
      path: '/session',
      query: new URLSearchParams(),
      project,
      userId: ownerA,
    });
    const body = JSON.parse(Buffer.from(response.body).toString('utf8')) as
      Array<Record<string, unknown>>;

    expect(body[0]).not.toHaveProperty('rhythm');
    expect(body[0]).toMatchObject({ agent: 'coding-workflow' });
  });

  it('issue-1286-c3: read surfaces reject other owners and different non-null projects', async () => {
    catalogSession('ses-other-owner-negative', ownerB, null);
    catalogSession('ses-other-project-negative', ownerA, otherProjectId);
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      fetchFn: async () => json([
        { id: 'ses-other-owner-negative', directory: project.root },
        { id: 'ses-other-project-negative', directory: project.root },
      ]),
    });

    const response = await proxy.forward({
      method: 'GET',
      path: '/session',
      query: new URLSearchParams(),
      project,
      userId: ownerA,
    });
    const body = JSON.parse(Buffer.from(response.body).toString('utf8')) as
      Array<Record<string, unknown>>;

    expect(body).toEqual([]);
    expect(body.every((item) => !('rhythm' in item))).toBe(true);
  });

  it('issue-1286-c4: PATCH state is reflected by the next projectless session.list read', async () => {
    catalogSession('ses-projectless-round-trip', ownerA, null);
    const patched = await patchSessionState(createMobileGatewayRouter(), {
      sessionId: 'ses-projectless-round-trip',
      ownerUserId: ownerA,
      project,
    });
    expect(patched).toMatchObject({
      profileId: PROFILE_ID,
      opencodeAgentId: OPENCODE_AGENT_ID,
      permissionMode: 'plan',
    });

    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      fetchFn: async () => json([{
        id: 'ses-projectless-round-trip',
        directory: project.root,
      }]),
    });
    const response = await proxy.forward({
      method: 'GET',
      path: '/session',
      query: new URLSearchParams(),
      project,
      userId: ownerA,
    });
    const body = JSON.parse(Buffer.from(response.body).toString('utf8')) as
      Array<Record<string, unknown>>;

    expect(body[0]).toMatchObject({
      rhythm: {
        profileId: PROFILE_ID,
        opencodeAgentId: OPENCODE_AGENT_ID,
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        thinkingBudget: 4096,
        permissionMode: 'plan',
      },
    });
  });
});
