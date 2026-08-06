import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { MobileOpenCodeOwnershipRepository } from '../repositories/mobile_opencode_ownership_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  MobileOpenCodeProxy,
  type MobileOpenCodeForwardInput,
} from '../services/mobile_opencode_proxy';

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * A subagent run raises its approval against the CHILD session it runs in, not
 * against the parent the caller started. Children spawned inside the engine
 * never travel through this proxy, so they never receive an ownership row —
 * which silently dropped their approvals out of the mobile permission list and
 * made replying to one a 404.
 */
describe('mobile permissions raised by child sessions', () => {
  let db: Database.Database;
  let ownership: MobileOpenCodeOwnershipRepository;
  let owner: number;
  let stranger: number;
  let project: MobileOpenCodeForwardInput['project'];

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    ownership = new MobileOpenCodeOwnershipRepository(db);
    const users = new UsersRepository();
    owner = users.create({
      name: 'Child permission owner',
      email: 'child-permission-owner@example.test',
    }).id;
    stranger = users.create({
      name: 'Child permission stranger',
      email: 'child-permission-stranger@example.test',
    }).id;
    const inserted = new ProjectsRepository().insert({
      name: 'Child permission project',
      cwd: '/sandbox/child-permissions/project',
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    });
    project = { id: inserted.id, root: inserted.cwd };
  });

  afterEach(() => db.close());

  const engine = () => ({
    baseUrl: 'http://opencode.test',
    ownershipRepository: ownership,
    fetchFn: async (request: string | URL | Request) => {
      const url = new URL(String(request));
      if (url.pathname === '/session') {
        return json([
          { id: 'ses-parent', directory: project.root },
          {
            id: 'ses-child',
            parentID: 'ses-parent',
            directory: project.root,
          },
          { id: 'ses-foreign', directory: '/sandbox/child-permissions/other' },
        ]);
      }
      if (url.pathname === '/permission') {
        return json([
          { id: 'perm-child', sessionID: 'ses-child', tool: 'bash' },
          { id: 'perm-foreign', sessionID: 'ses-foreign', tool: 'bash' },
        ]);
      }
      return json(true);
    },
  });

  it('lists an approval raised by a child of an owned session', async () => {
    ownership.claimResource('session', 'ses-parent', owner, project.id);

    const result = await new MobileOpenCodeProxy(engine()).forward({
      method: 'GET',
      path: '/permission',
      query: new URLSearchParams(),
      project,
      userId: owner,
    });

    const body = JSON.parse(Buffer.from(result.body).toString('utf8')) as
      Array<{ id: string }>;
    expect(body.map(({ id }) => id)).toEqual(['perm-child']);
  });

  it('lets the owner reply to a child session approval', async () => {
    ownership.claimResource('session', 'ses-parent', owner, project.id);

    const result = await new MobileOpenCodeProxy(engine()).forward({
      method: 'POST',
      path: '/permission/perm-child/reply',
      query: new URLSearchParams(),
      body: { response: 'once' },
      project,
      userId: owner,
    });

    expect(result.status).toBe(200);
  });

  it('still hides a child approval from someone who owns no ancestor', async () => {
    ownership.claimResource('session', 'ses-parent', owner, project.id);

    const result = await new MobileOpenCodeProxy(engine()).forward({
      method: 'GET',
      path: '/permission',
      query: new URLSearchParams(),
      project,
      userId: stranger,
    });

    const body = JSON.parse(Buffer.from(result.body).toString('utf8')) as
      Array<{ id: string }>;
    expect(body).toEqual([]);

    await expect(new MobileOpenCodeProxy(engine()).forward({
      method: 'POST',
      path: '/permission/perm-child/reply',
      query: new URLSearchParams(),
      body: { response: 'once' },
      project,
      userId: stranger,
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('never authorizes a child whose ancestor is outside the project', async () => {
    ownership.claimResource('session', 'ses-parent', owner, project.id);

    const result = await new MobileOpenCodeProxy(engine()).forward({
      method: 'GET',
      path: '/permission',
      query: new URLSearchParams(),
      project,
      userId: owner,
    });

    const body = JSON.parse(Buffer.from(result.body).toString('utf8')) as
      Array<{ id: string }>;
    expect(body.map(({ id }) => id)).not.toContain('perm-foreign');
  });
});
