import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { MobileOpenCodeOwnershipRepository } from '../repositories/mobile_opencode_ownership_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  MobileOpenCodeProxy,
  type MobileOpenCodeForwardInput,
} from '../services/mobile_opencode_proxy';

const json = (value: unknown, nextCursor?: number) =>
  new Response(JSON.stringify(value), {
    headers: {
      'Content-Type': 'application/json',
      ...(nextCursor === undefined
        ? {}
        : { 'x-next-cursor': String(nextCursor) }),
    },
  });

describe('issue #1285 owner-scoped mobile chat discovery', () => {
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
      name: 'Issue 1285 Owner A',
      email: 'issue-1285-owner-a@example.test',
    }).id;
    ownerB = users.create({
      name: 'Issue 1285 Owner B',
      email: 'issue-1285-owner-b@example.test',
    }).id;
    const insertedProject = new ProjectsRepository().insert({
      name: 'Issue 1285 registered project',
      cwd: '/sandbox/issue-1285/project',
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    });
    project = { id: insertedProject.id, root: insertedProject.cwd };
    otherProjectId = new ProjectsRepository().insert({
      name: 'Issue 1285 different project',
      cwd: '/sandbox/issue-1285/different-project',
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    }).id;
  });

  afterEach(() => db.close());

  const catalogSession = (
    sdkSessionId: string,
    ownerUserId: number,
    options: {
      projectId?: string | null;
      category?: 'chat' | 'scheduled' | 'self_improvement';
      isSystem?: boolean;
      scheduledTaskId?: string | null;
    } = {},
  ) => {
    const local = sessions.insert({
      agentKind: 'codex',
      taskId: null,
      cwd: options.projectId ? project.root : '/sandbox/issue-1285/home',
      name: sdkSessionId,
      projectId: options.projectId ?? null,
      ownerUserId,
      category: options.category ?? 'chat',
      isSystem: options.isSystem ?? false,
      scheduledTaskId: options.scheduledTaskId ?? null,
    });
    sessions.setSdkSessionId(local.id, sdkSessionId);
  };

  it('returns only exact-owner unscoped human chats as read-only records', async () => {
    catalogSession('ses-owner-a-human', ownerA);
    catalogSession('ses-owner-b-human', ownerB);
    catalogSession('ses-scheduled', ownerA, {
      category: 'scheduled',
      isSystem: true,
    });
    catalogSession('ses-optimizer', ownerA, {
      category: 'self_improvement',
      isSystem: true,
    });
    catalogSession('ses-scoped', ownerA, { projectId: project.id });

    const upstream = [
      'ses-owner-a-human',
      'ses-owner-b-human',
      'ses-scheduled',
      'ses-optimizer',
      'ses-scoped',
    ].map((id) => ({
      id,
      title: id,
      directory: '/sandbox/issue-1285/home',
      time: { updated: 1 },
    }));
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      fetchFn: async (request) => {
        const url = new URL(String(request));
        expect(url.pathname).toBe('/experimental/session');
        expect(url.searchParams.get('directory')).toBeNull();
        return json(upstream, 200);
      },
    });

    const result = await proxy.forward({
      method: 'GET',
      path: '/experimental/session',
      query: new URLSearchParams({ limit: '100' }),
      project,
      userId: ownerA,
      ownerUnscopedDiscovery: true,
    });
    const body = JSON.parse(Buffer.from(result.body).toString('utf8')) as
      Array<Record<string, unknown>>;

    expect(body).toEqual([expect.objectContaining({
      id: 'ses-owner-a-human',
      projectId: null,
      interaction: 'read-only',
    })]);
    expect(body[0]).not.toHaveProperty('directory');
    expect(result.headers).toEqual({ 'x-next-cursor': '200' });
  });

  it('keeps non-null project mismatches out of project chat discovery', async () => {
    catalogSession('ses-project-match', ownerA, { projectId: project.id });
    catalogSession('ses-project-mismatch', ownerA, {
      projectId: otherProjectId,
    });
    catalogSession('ses-projectless', ownerA);
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      fetchFn: async () => json([
        {
          id: 'ses-project-match',
          directory: project.root,
          title: 'match',
        },
        {
          id: 'ses-project-mismatch',
          directory: project.root,
          title: 'mismatch',
        },
        {
          id: 'ses-projectless',
          directory: project.root,
          title: 'projectless',
        },
      ]),
    });

    const result = await proxy.forward({
      method: 'GET',
      path: '/session',
      query: new URLSearchParams(),
      project,
      userId: ownerA,
    });
    const body = JSON.parse(Buffer.from(result.body).toString('utf8')) as
      Array<{ id: string }>;

    expect(body.map(({ id }) => id)).toEqual([
      'ses-project-match',
      'ses-projectless',
    ]);
    // Projectless catalog rows remain list-visible for the exact owner, but
    // never become project-authorized for ID-addressed reads or mutations.
    expect(ownership.isSessionOwnedByDesktopCatalog(
      'ses-projectless',
      ownerA,
      project.id,
    )).toBe(false);
  });
});
