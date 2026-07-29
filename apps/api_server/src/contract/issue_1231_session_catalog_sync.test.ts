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
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';

describe('issue #1231 authoritative desktop/mobile session catalog', () => {
  let db: Database.Database;
  let sessions: AgentSessionsRepository;
  let owners: MobileOpenCodeOwnershipRepository;
  let userId: number;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    initializeMobileOpenCodeOwnershipSchema(db);
    sessions = new AgentSessionsRepository();
    owners = new MobileOpenCodeOwnershipRepository(db);
    userId = new UsersRepository().create({
      name: 'Issue 1231 Owner',
      email: 'issue-1231-owner@example.com',
    }).id;
    const projects = new ProjectsRepository();
    projectId = projects.insert({
      name: 'Issue 1231 Alpha',
      cwd: '/projects/alpha',
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    }).id;
    otherProjectId = projects.insert({
      name: 'Issue 1231 Beta',
      cwd: '/projects/beta',
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    }).id;
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('upserts ownership when a desktop session acquires its SDK identity', () => {
    // Regression caught: desktop creation persists sdk_session_id without the
    // ownership row, so the gateway list silently filters the session out.
    const session = sessions.insert({
      agentKind: 'codex',
      taskId: null,
      cwd: '/projects/alpha',
      name: 'Desktop session',
      projectId,
      ownerUserId: userId,
    });

    sessions.setSdkSessionId(session.id, 'ses-desktop-1231');

    expect(db.prepare(
      `SELECT owner_user_id, project_id
         FROM mobile_opencode_resource_owners
        WHERE resource_kind = 'session' AND resource_id = ?`,
    ).get('ses-desktop-1231')).toEqual({
      owner_user_id: userId,
      project_id: projectId,
    });
  });

  it('issue-1231-c5: ownership rejects cross-user and cross-project access', () => {
    // Regression caught: deriving ownership from sdk_session_id alone admits a
    // different paired user or the same user under another selected project.
    const otherUserId = new UsersRepository().create({
      name: 'Issue 1231 Other',
      email: 'issue-1231-other@example.com',
    }).id;
    const session = sessions.insert({
      agentKind: 'codex',
      taskId: null,
      cwd: '/projects/alpha',
      name: 'Private desktop session',
      projectId,
      ownerUserId: userId,
    });
    sessions.setSdkSessionId(session.id, 'ses-private-1231');

    expect(
      owners.isResourceOwnedBy(
        'session',
        'ses-private-1231',
        otherUserId,
        projectId,
      ),
    ).toBe(false);
    expect(
      owners.isResourceOwnedBy(
        'session',
        'ses-private-1231',
        userId,
        otherProjectId,
      ),
    ).toBe(false);
  });

  it('issue-1231-c4: repeated authoritative refresh preserves one local identity', async () => {
    // Regression caught: each gateway refresh inserts another agent_sessions
    // row for the same engine session, producing duplicate chats/transcripts.
    expect(
      owners.claimResource(
        'session',
        'ses-mobile-1231',
        userId,
        projectId,
      ),
    ).toBe(true);
    const engineSessions = [{
      id: 'ses-mobile-1231',
      title: 'Mobile session',
      directory: '/projects/alpha',
      time: { created: 1, updated: 2 },
    }];
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://127.0.0.1:4097',
      ownershipRepository: owners,
      fetchFn: vi.fn(async () => Response.json(engineSessions)),
    });
    const request = {
      method: 'GET',
      path: '/session',
      query: new URLSearchParams(),
      project: {
        id: projectId,
        root: '/projects/alpha',
        name: 'Alpha',
      },
      userId,
    };

    await proxy.forward(request);
    await proxy.forward(request);

    const rows = db
      .prepare(
        `SELECT id, sdk_session_id
           FROM agent_sessions
          WHERE sdk_session_id = ?`,
      )
      .all('ses-mobile-1231') as Array<{
        id: string;
        sdk_session_id: string;
      }>;
    expect(rows).toHaveLength(1);
    expect(sessions.findBySdkSessionId('ses-mobile-1231')?.id).toBe(rows[0].id);
  });
});
