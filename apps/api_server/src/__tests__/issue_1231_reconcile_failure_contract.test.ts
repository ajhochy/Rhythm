import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  initializeMobileOpenCodeOwnershipSchema,
  MobileOpenCodeOwnershipRepository,
} from '../repositories/mobile_opencode_ownership_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  MobileOpenCodeProxy,
  type MobileOpenCodeForwardInput,
} from '../services/mobile_opencode_proxy';
import { logger } from '../utils/logger';

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('issue #1231 session-catalog reconciliation failures', () => {
  let db: Database.Database;
  let sessions: AgentSessionsRepository;
  let ownership: MobileOpenCodeOwnershipRepository;
  let userId: number;
  let project: MobileOpenCodeForwardInput['project'];

  const input = (
    method: string,
    path: string,
    body?: unknown,
  ): MobileOpenCodeForwardInput => ({
    method,
    path,
    body,
    query: new URLSearchParams(),
    project,
    userId,
  });

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    initializeMobileOpenCodeOwnershipSchema(db);
    sessions = new AgentSessionsRepository();
    ownership = new MobileOpenCodeOwnershipRepository(db);
    userId = new UsersRepository().create({
      name: 'Issue 1231 Failure Owner',
      email: 'issue-1231-failure@example.com',
    }).id;
    const insertedProject = new ProjectsRepository().insert({
      name: 'Issue 1231 Failure Project',
      cwd: '/sandbox/project-1231',
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    });
    project = {
      id: insertedProject.id,
      root: insertedProject.cwd,
      name: insertedProject.name,
    };
    const ownedSession = sessions.insert({
      agentKind: 'codex',
      taskId: null,
      cwd: project.root,
      name: 'Owned session',
      projectId: project.id,
      ownerUserId: userId,
    });
    sessions.setSdkSessionId(ownedSession.id, 'ses-owned');
    vi.spyOn(
      AgentSessionsRepository.prototype,
      'reconcileMobileSession',
    ).mockImplementation(() => {
      throw new Error(
        'SQLITE_CONSTRAINT /sandbox/private customer@example.com',
      );
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it.each([
    ['create', 'POST', '/session', { title: 'New session' }],
    ['rename', 'PATCH', '/session/ses-owned', { title: 'Renamed' }],
    [
      'archive',
      'PATCH',
      '/session/ses-owned',
      { time: { archived: Date.now() } },
    ],
  ])(
    'surfaces a scrubbed 5xx envelope when %s reconciliation cannot persist',
    async (_label, method, path, body) => {
      const proxy = new MobileOpenCodeProxy({
        baseUrl: 'http://opencode.test',
        ownershipRepository: ownership,
        fetchFn: async (request, init) => {
          const url = new URL(String(request));
          if (url.pathname === '/session' && init?.method === 'GET') {
            return json([{
              id: 'ses-owned',
              title: 'Owned session',
              directory: project.root,
            }]);
          }
          return json({
            id: path === '/session' ? 'ses-created' : 'ses-owned',
            title: 'Renamed',
            directory: project.root,
            time: { updated: Date.now() },
          });
        },
      });

      const error = await proxy.forward(input(method, path, body))
        .catch((cause: unknown) => cause);

      expect(error).toMatchObject({
        statusCode: 500,
        code: 'SESSION_CATALOG_PERSISTENCE_FAILED',
        message: 'Session catalog update failed',
      });
      expect((error as Error).message).not.toMatch(
        /SQLITE|sandbox|customer@example\.com/i,
      );
    },
  );

  it('surfaces a scrubbed 5xx envelope when delete catalog persistence fails', async () => {
    vi.spyOn(
      AgentSessionsRepository.prototype,
      'deleteById',
    ).mockImplementation(() => {
      throw new Error('DELETE failed /sandbox/private customer@example.com');
    });
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      fetchFn: async (request, init) => {
        const url = new URL(String(request));
        if (url.pathname === '/session' && init?.method === 'GET') {
          return json([{
            id: 'ses-owned',
            title: 'Owned',
            directory: project.root,
          }]);
        }
        return json(true);
      },
    });

    const error = await proxy.forward(input('DELETE', '/session/ses-owned'))
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      statusCode: 502,
      code: 'OPENCODE_UNAVAILABLE',
      message: 'OpenCode is unavailable',
    });
    expect((error as Error).message).not.toMatch(
      /DELETE|sandbox|customer@example\.com/i,
    );
  });

  it('serves list responses and logs sdk_session_id when opportunistic reconciliation fails', async () => {
    expect(
      ownership.claimResource(
        'session',
        'ses-list-owned',
        userId,
        project.id,
      ),
    ).toBe(true);
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      fetchFn: async () => json([{
        id: 'ses-list-owned',
        title: 'Still visible',
        directory: project.root,
      }]),
    });

    const response = await proxy.forward(input('GET', '/session'));

    expect(response.status).toBe(200);
    expect(JSON.parse(Buffer.from(response.body).toString('utf8'))).toEqual([
      expect.objectContaining({
        id: 'ses-list-owned',
        title: 'Still visible',
      }),
    ]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('opportunistic session catalog reconciliation'),
      expect.objectContaining({ sdk_session_id: 'ses-list-owned' }),
    );
  });
});
