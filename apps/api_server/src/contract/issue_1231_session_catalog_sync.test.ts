import Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { authenticateIfPresent } from '../middleware/auth_middleware';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import {
  initializeMobileOpenCodeOwnershipSchema,
  MobileOpenCodeOwnershipRepository,
} from '../repositories/mobile_opencode_ownership_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
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

  it('resolves a local desktop bearer before persisting catalog ownership', async () => {
    // Live regression caught: AGENT_LOCAL bypassed requireAuth even when the
    // desktop supplied a valid bearer, leaving owner_user_id null. The strict
    // ownership upsert then correctly skipped the unscoped row.
    const bearer = new SessionsRepository().create(userId).token;
    const request = {
      header: (name: string) =>
        name.toLowerCase() === 'authorization'
          ? `Bearer ${bearer}`
          : undefined,
    } as unknown as Request;
    const next = vi.fn();

    await authenticateIfPresent(
      request,
      {} as Response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(request.auth?.user.id).toBe(userId);

    const session = sessions.insert({
      agentKind: 'codex',
      taskId: null,
      cwd: '/projects/alpha',
      name: 'Authenticated local desktop session',
      projectId,
      ownerUserId: request.auth?.user.id ?? null,
    });
    sessions.setSdkSessionId(session.id, 'ses-local-auth-1231');
    expect(
      owners.isResourceExplicitlyOwnedBy(
        'session',
        'ses-local-auth-1231',
        userId,
        projectId,
      ),
    ).toBe(true);

    // Pin the real AGENT_LOCAL router wiring as well as the middleware behavior.
    const routeSource = readFileSync(
      join(__dirname, '..', 'routes', 'agent_sessions_routes.ts'),
      'utf8',
    );
    expect(routeSource).toContain(
      'env.agentLocal ? authenticateIfPresent : requireAuth',
    );
  });

  it('inherits and claims parent scope when the stream bridge persists a child SDK identity', () => {
    const parent = sessions.insert({
      agentKind: 'codex',
      taskId: null,
      cwd: '/projects/alpha',
      name: 'Desktop parent',
      projectId,
      ownerUserId: userId,
    });
    sessions.setSdkSessionId(parent.id, 'ses-parent-1231');

    const child = sessions.upsertChildSession(
      'ses-child-1231',
      'ses-parent-1231',
      'Delegated work (@researcher subagent)',
      '/projects/alpha',
    );
    const repeated = sessions.upsertChildSession(
      'ses-child-1231',
      'ses-parent-1231',
      'Delegated work (@researcher subagent)',
      '/projects/alpha',
    );

    expect(child).not.toBeNull();
    expect(child?.ownerUserId).toBe(userId);
    expect(child?.projectId).toBe(projectId);
    expect(repeated?.id).toBe(child?.id);
    expect(
      owners.isResourceExplicitlyOwnedBy(
        'session',
        'ses-child-1231',
        userId,
        projectId,
      ),
    ).toBe(true);
    expect(db.prepare(
      `SELECT COUNT(*) AS count
         FROM mobile_opencode_resource_owners
        WHERE resource_kind = 'session' AND resource_id = ?`,
    ).get('ses-child-1231')).toEqual({ count: 1 });
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
