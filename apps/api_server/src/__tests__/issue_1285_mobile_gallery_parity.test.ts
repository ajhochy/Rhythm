import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentDesignsRepository } from '../repositories/agent_designs_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { WorkspaceRepository } from '../repositories/workspace_repository';
import { installHumanApprovalTestCredentials } from './helpers/human_approval_test_credentials';
import { startTestServer } from './helpers/real_server';

describe('#1285 paired Gallery parity', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let sandboxRoot: string;
  let humanCapabilityHeader: Record<string, string>;

  beforeEach(async () => {
    sandboxRoot = mkdtempSync(join(tmpdir(), 'rhythm-1285-gallery-'));
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);
    humanCapabilityHeader =
      installHumanApprovalTestCredentials().capabilityHeader;
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  async function pair(email: string): Promise<{
    userId: number;
    deviceToken: string;
  }> {
    const user = new UsersRepository().create({
      name: email.split('@')[0],
      email,
    });
    const session = new SessionsRepository().create(user.id);
    const codeResponse = await fetch(
      `${baseUrl}/mobile-gateway/pairing-codes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
          ...humanCapabilityHeader,
        },
        body: '{}',
      },
    );
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
        deviceName: `${email} iPhone`,
      }),
    });
    expect(pairResponse.status).toBe(201);
    const paired = (await pairResponse.json()) as { deviceToken: string };
    return { userId: user.id, deviceToken: paired.deviceToken };
  }

  it('requires Device admin authorization and returns only public local design metadata', async () => {
    const admin = await pair(`admin-${randomUUID()}@example.com`);
    const staff = await pair(`staff-${randomUUID()}@example.com`);
    const workspace = new WorkspaceRepository().create({
      name: 'Issue 1285 Gallery Workspace',
      createdBy: admin.userId,
    });
    new WorkspaceRepository().joinByCode(workspace.joinCode, staff.userId);
    const project = new ProjectsRepository().insert({
      name: 'Issue 1285 Gallery Project',
      cwd: sandboxRoot,
      icon: null,
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    });
    const design = await new AgentDesignsRepository().createAsync({
      title: 'Sunday service graphic',
      provider: 'built-in',
      artifactType: 'png',
      filePath: join(sandboxRoot, 'private-artifact.png'),
    });
    const route = `${baseUrl}/mobile-gateway/tools/agent-designs`;

    expect((await fetch(route)).status).toBe(401);

    const staffResponse = await fetch(route, {
      headers: {
        Authorization: `Device ${staff.deviceToken}`,
        'X-Rhythm-Project-ID': project.id,
      },
    });
    expect(staffResponse.status).toBe(403);

    const staleProject = await fetch(route, {
      headers: {
        Authorization: `Device ${admin.deviceToken}`,
        'X-Rhythm-Project-ID': 'not-a-registered-project',
      },
    });
    expect(staleProject.status).toBe(404);

    const headers = {
      Authorization: `Device ${admin.deviceToken}`,
      'X-Rhythm-Project-ID': project.id,
    };
    const listResponse = await fetch(route, { headers });
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as Record<string, unknown>[];
    expect(list).toEqual([
      expect.objectContaining({
        id: design.id,
        title: 'Sunday service graphic',
        provider: 'built-in',
      }),
    ]);
    expect(JSON.stringify(list)).not.toContain('filePath');
    expect(JSON.stringify(list)).not.toContain('private-artifact.png');

    const detailResponse = await fetch(`${route}/${design.id}`, { headers });
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      id: design.id,
      title: 'Sunday service graphic',
    });
    expect(
      JSON.stringify(await (await fetch(`${route}/${design.id}`, { headers })).json()),
    ).not.toContain('filePath');

    const blockedArtifact = await fetch(
      `${route}/${design.id}/artifact`,
      { headers },
    );
    expect(blockedArtifact.status).toBe(404);
  });
});
