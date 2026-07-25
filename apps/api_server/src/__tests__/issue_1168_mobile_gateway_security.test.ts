import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { ProjectsRepository } from '../repositories/projects_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

function bearer(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

describe('issue #1168 mobile gateway security contract', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let boundary: string;
  let projectRoot: string;
  let outside: string;
  let projectId: string;
  let userToken: string;
  let deviceId: string;
  let deviceToken: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    boundary = mkdtempSync(join(tmpdir(), 'issue-1168-http-'));
    projectRoot = join(boundary, 'project');
    outside = join(boundary, 'outside');
    mkdirSync(join(projectRoot, 'inside'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(projectRoot, 'inside', 'file.txt'), 'inside');
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    symlinkSync(outside, join(projectRoot, 'escape'));

    projectId = new ProjectsRepository().insert({
      name: 'Issue 1168',
      cwd: projectRoot,
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    }).id;
    const user = new UsersRepository().create({
      name: 'Issue 1168',
      email: 'issue-1168@example.com',
    });
    userToken = new SessionsRepository().create(user.id).token;

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
    const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
      method: 'POST',
      headers: bearer(userToken),
      body: JSON.stringify({}),
    });
    expect(codeResponse.status).toBe(201);
    const code = (await codeResponse.json()) as {
      pairingCode: string;
      hostId: string;
    };
    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: code.pairingCode,
        hostId: code.hostId,
        deviceName: 'Issue 1168 iPhone',
      }),
    });
    expect(pairResponse.status).toBe(201);
    const paired = (await pairResponse.json()) as {
      deviceId: string;
      deviceToken: string;
    };
    deviceId = paired.deviceId;
    deviceToken = paired.deviceToken;
  });

  afterEach(async () => {
    await closeServer();
    db.close();
    rmSync(boundary, { recursive: true, force: true });
  });

  const scopeRequest = (
    token: string | null,
    selectedProjectId: string | null,
    body: Record<string, unknown> = {},
  ) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token !== null) headers.Authorization = `Device ${token}`;
    if (selectedProjectId !== null) {
      headers['X-Rhythm-Project-ID'] = selectedProjectId;
    }
    return fetch(`${baseUrl}/mobile-gateway/project`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  };

  it('issue-1168-c1: authentication rejects the request before any project lookup', async () => {
    const unknownProject = 'unknown-project-before-auth';
    const missing = await scopeRequest(null, unknownProject, {
      path: '../outside/secret.txt',
    });
    const invalid = await scopeRequest('invalid-device-token', unknownProject);

    expect([missing.status, invalid.status]).toEqual([401, 401]);
    expect(await missing.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('issue-1168-c3: the HTTP boundary rejects every negative security case', async () => {
    expect((await scopeRequest(null, projectId)).status).toBe(401);
    expect((await scopeRequest('invalid-device-token', projectId)).status)
      .toBe(401);

    const valid = await scopeRequest(deviceToken, projectId, {
      path: 'inside/file.txt',
    });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({
      projectId,
      path: 'inside/file.txt',
    });

    const sibling = join(boundary, `${basename(projectRoot)}-sibling`);
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'secret.txt'), 'sibling');
    const cases: Array<{
      name: string;
      selectedProjectId: string | null;
      body?: Record<string, unknown>;
      status: number;
    }> = [
      {
        name: 'missing project header',
        selectedProjectId: null,
        status: 400,
      },
      {
        name: 'unknown project',
        selectedProjectId: 'not-registered',
        status: 404,
      },
      {
        name: 'traversal',
        selectedProjectId: projectId,
        body: { path: join('..', basename(outside), 'secret.txt') },
        status: 403,
      },
      {
        name: 'sibling-prefix absolute path',
        selectedProjectId: projectId,
        body: { path: join(sibling, 'secret.txt') },
        status: 403,
      },
      {
        name: 'symlink escape',
        selectedProjectId: projectId,
        body: { path: 'escape/secret.txt' },
        status: 403,
      },
      {
        name: 'arbitrary root override',
        selectedProjectId: projectId,
        body: { root: outside },
        status: 403,
      },
      {
        name: 'arbitrary cwd override',
        selectedProjectId: projectId,
        body: { cwd: outside },
        status: 403,
      },
      {
        name: 'arbitrary directory override',
        selectedProjectId: projectId,
        body: { directory: outside },
        status: 403,
      },
      {
        name: 'case-variant arbitrary directory override',
        selectedProjectId: projectId,
        body: { Directory: outside },
        status: 403,
      },
    ];

    for (const testCase of cases) {
      const response = await scopeRequest(
        deviceToken,
        testCase.selectedProjectId,
        testCase.body,
      );
      expect(response.status, testCase.name).toBe(testCase.status);
      expect(
        (await response.json()) as { error: { message: string } },
        testCase.name,
      ).not.toEqual(expect.objectContaining({
        error: expect.objectContaining({ message: expect.stringContaining(outside) }),
      }));
    }

    new ProjectsRepository().updateFields(projectId, {
      archivedAt: new Date().toISOString(),
    });
    expect((await scopeRequest(deviceToken, projectId)).status).toBe(404);

    const revoke = await fetch(
      `${baseUrl}/mobile-gateway/devices/${deviceId}`,
      {
        method: 'DELETE',
        headers: bearer(userToken),
      },
    );
    expect(revoke.status).toBe(204);
    expect((await scopeRequest(deviceToken, projectId)).status).toBe(401);
  });
});
