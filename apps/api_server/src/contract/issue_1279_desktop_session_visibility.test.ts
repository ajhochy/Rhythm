import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

type TestProject = {
  id: string;
  root: string;
  name: string;
};

describe('issue #1279 desktop-created mobile session visibility', () => {
  let db: Database.Database;
  let ownership: MobileOpenCodeOwnershipRepository;
  let userA: number;
  let userB: number;
  let projectP: TestProject;
  let projectQ: TestProject;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    initializeMobileOpenCodeOwnershipSchema(db);
    ownership = new MobileOpenCodeOwnershipRepository(db);
    const users = new UsersRepository();
    userA = users.create({
      name: 'Issue 1279 owner A',
      email: 'issue-1279-owner-a@example.com',
    }).id;
    userB = users.create({
      name: 'Issue 1279 owner B',
      email: 'issue-1279-owner-b@example.com',
    }).id;
    const projects = new ProjectsRepository();
    const insertedP = projects.insert({
      name: 'Issue 1279 project P',
      cwd: '/projects/issue-1279-p',
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    });
    const insertedQ = projects.insert({
      name: 'Issue 1279 project Q',
      cwd: '/projects/issue-1279-q',
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    });
    projectP = {
      id: insertedP.id,
      root: insertedP.cwd,
      name: insertedP.name,
    };
    projectQ = {
      id: insertedQ.id,
      root: insertedQ.cwd,
      name: insertedQ.name,
    };
  });

  afterEach(() => {
    db.close();
  });

  function insertDesktopSessionWithoutClaim(input: {
    sdkSessionId: string;
    ownerUserId: number;
    projectId: string;
    cwd: string;
  }): void {
    const session = new AgentSessionsRepository().insert({
      agentKind: 'codex',
      taskId: null,
      cwd: input.cwd,
      name: input.sdkSessionId,
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
    });
    // Model a desktop/legacy row that already has its durable SDK identity but
    // never passed through the mobile claim path.
    db.prepare(
      `UPDATE agent_sessions
          SET sdk_session_id = ?
        WHERE id = ?`,
    ).run(input.sdkSessionId, session.id);
    expect(
      db.prepare(
        `SELECT 1
           FROM mobile_opencode_resource_owners
          WHERE resource_kind = 'session'
            AND resource_id = ?`,
      ).get(input.sdkSessionId),
    ).toBeUndefined();
  }

  async function listSessions(input: {
    callerUserId: number;
    project: TestProject;
    engineSessions: unknown[];
  }): Promise<unknown[]> {
    const proxy = new MobileOpenCodeProxy({
      baseUrl: 'http://opencode.test',
      ownershipRepository: ownership,
      fetchFn: async () => Response.json(input.engineSessions),
    });
    const response = await proxy.forward({
      method: 'GET',
      path: '/session',
      query: new URLSearchParams(),
      project: input.project,
      userId: input.callerUserId,
    });
    return JSON.parse(
      Buffer.from(response.body).toString('utf8'),
    ) as unknown[];
  }

  it(
    'issue-1279-c1: a desktop-owned session without a claim is visible to its owner in its project',
    async () => {
      // Regression caught: session.list consults only the claim table and
      // permanently hides a legitimate desktop-created session from its owner.
      insertDesktopSessionWithoutClaim({
        sdkSessionId: 'ses-desktop-a-p',
        ownerUserId: userA,
        projectId: projectP.id,
        cwd: projectP.root,
      });

      const visible = await listSessions({
        callerUserId: userA,
        project: projectP,
        engineSessions: [{
          id: 'ses-desktop-a-p',
          directory: projectP.root,
          title: 'Desktop session A/P',
        }],
      });

      expect(visible).toEqual([
        expect.objectContaining({ id: 'ses-desktop-a-p' }),
      ]);
    },
  );

  it(
    'issue-1279-c2: desktop ownership fallback rejects another user in the same project',
    async () => {
      // Regression caught: matching only project_id exposes A's desktop
      // session to B when both users pair to the same Mac and project.
      insertDesktopSessionWithoutClaim({
        sdkSessionId: 'ses-desktop-a-p',
        ownerUserId: userA,
        projectId: projectP.id,
        cwd: projectP.root,
      });

      const visible = await listSessions({
        callerUserId: userB,
        project: projectP,
        engineSessions: [{
          id: 'ses-desktop-a-p',
          directory: projectP.root,
          title: 'Desktop session A/P',
        }],
      });

      expect(visible).toEqual([]);
    },
  );

  it(
    'issue-1279-c3: desktop ownership fallback rejects the owner in another project',
    async () => {
      // Regression caught: matching only owner_user_id exposes a session from
      // project Q while A is scoped to project P.
      insertDesktopSessionWithoutClaim({
        sdkSessionId: 'ses-desktop-a-q',
        ownerUserId: userA,
        projectId: projectQ.id,
        cwd: projectP.root,
      });

      const visible = await listSessions({
        callerUserId: userA,
        project: projectP,
        engineSessions: [{
          id: 'ses-desktop-a-q',
          directory: projectP.root,
          title: 'Desktop session A/Q',
        }],
      });

      expect(visible).toEqual([]);
    },
  );

  it('issue-1279-c4: explicit session claims remain visible', async () => {
    // Regression caught: replacing instead of extending claim ownership hides
    // phone-created sessions that have no desktop catalog row.
    expect(
      ownership.claimResource(
        'session',
        'ses-mobile-claimed',
        userA,
        projectP.id,
      ),
    ).toBe(true);

    const visible = await listSessions({
      callerUserId: userA,
      project: projectP,
      engineSessions: [{
        id: 'ses-mobile-claimed',
        directory: projectP.root,
        title: 'Mobile claimed session',
      }],
    });

    expect(visible).toEqual([
      expect.objectContaining({ id: 'ses-mobile-claimed' }),
    ]);
  });

  it(
    'issue-1279-c5: desktop catalog ownership does not become an explicit claim',
    () => {
      // Regression caught: relaxing this predicate lets catalog reconciliation
      // mutate metadata for resources the phone never explicitly claimed.
      insertDesktopSessionWithoutClaim({
        sdkSessionId: 'ses-desktop-explicit',
        ownerUserId: userA,
        projectId: projectP.id,
        cwd: projectP.root,
      });

      expect(
        ownership.isResourceExplicitlyOwnedBy(
          'session',
          'ses-desktop-explicit',
          userA,
          projectP.id,
        ),
      ).toBe(false);
    },
  );

  it(
    'issue-1279-c6: desktop session ownership never grants PTY visibility',
    async () => {
      // Regression caught: applying the desktop lookup to every resource kind
      // accidentally treats a matching session SDK id as PTY ownership.
      insertDesktopSessionWithoutClaim({
        sdkSessionId: 'pty-with-matching-session-id',
        ownerUserId: userA,
        projectId: projectP.id,
        cwd: projectP.root,
      });
      const proxy = new MobileOpenCodeProxy({
        baseUrl: 'http://opencode.test',
        ownershipRepository: ownership,
        fetchFn: async () => Response.json([{
          id: 'pty-with-matching-session-id',
          cwd: projectP.root,
        }]),
      });

      const response = await proxy.forward({
        method: 'GET',
        path: '/pty',
        query: new URLSearchParams(),
        project: projectP,
        userId: userA,
      });

      expect(
        JSON.parse(Buffer.from(response.body).toString('utf8')),
      ).toEqual([]);
    },
  );
});
