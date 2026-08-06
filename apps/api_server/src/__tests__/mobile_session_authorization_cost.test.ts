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
 * Authorizing one session id must not cost a listing of the project's
 * sessions. The list-based form issued a `/session` fetch plus one ownership
 * lookup per returned row on every session-scoped request, so its cost grew
 * with how much history the project had accumulated rather than with the
 * request being served.
 */
describe('mobile session authorization cost', () => {
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
      name: 'Session cost owner',
      email: 'session-cost-owner@example.test',
    }).id;
    stranger = users.create({
      name: 'Session cost stranger',
      email: 'session-cost-stranger@example.test',
    }).id;
    const inserted = new ProjectsRepository().insert({
      name: 'Session cost project',
      cwd: '/sandbox/session-cost/project',
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

  const proxyRecording = (paths: string[]) =>
    new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      fetchFn: async (request) => {
        const url = new URL(String(request));
        paths.push(url.pathname);
        if (url.pathname === '/session') {
          return json([{
            id: 'ses-owned',
            directory: project.root,
          }]);
        }
        return json([{
          info: { id: 'msg-owned', role: 'user', sessionID: 'ses-owned' },
          parts: [{ id: 'part-owned', type: 'text', text: 'hello' }],
        }]);
      },
    });

  it('authorizes an owned session without listing the project sessions', async () => {
    ownership.claimResource('session', 'ses-owned', owner, project.id);
    const paths: string[] = [];

    const result = await proxyRecording(paths).forward({
      method: 'GET',
      path: '/session/ses-owned/message',
      query: new URLSearchParams(),
      project,
      userId: owner,
    });

    expect(result.status).toBe(200);
    // Only the request the caller actually asked for reaches the engine.
    expect(paths).toEqual(['/session/ses-owned/message']);
  });

  it('still refuses a session the caller does not own', async () => {
    ownership.claimResource('session', 'ses-owned', owner, project.id);
    const paths: string[] = [];

    await expect(proxyRecording(paths).forward({
      method: 'GET',
      path: '/session/ses-owned/message',
      query: new URLSearchParams(),
      project,
      userId: stranger,
    })).rejects.toMatchObject({ statusCode: 404 });

    // The stranger has no ownership row, so the decision falls back to the
    // project's own session list and never addresses the id upstream.
    expect(paths).not.toContain('/session/ses-owned/message');
  });

  it('resolves the session list at most once for a single request', async () => {
    const paths: string[] = [];

    await expect(proxyRecording(paths).forward({
      method: 'GET',
      path: '/session/ses-unclaimed/message',
      query: new URLSearchParams(),
      project,
      userId: owner,
    })).rejects.toMatchObject({ statusCode: 404 });

    expect(paths.filter((path) => path === '/session')).toHaveLength(1);
  });
});
