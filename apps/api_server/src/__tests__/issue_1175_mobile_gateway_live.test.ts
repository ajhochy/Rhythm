import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const engineUrl = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const secretMarker = process.env.RHYTHM_LIVE_SECRET_MARKER ?? '';

function gatewayHeaders(
  deviceToken: string,
  projectId: string,
  contentType = false,
): Record<string, string> {
  return {
    Authorization: `Device ${deviceToken}`,
    'X-Rhythm-Project-ID': projectId,
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function gatewayRequest(
  deviceToken: string,
  projectId: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${baseUrl}/mobile-gateway/opencode${path}`, {
    ...init,
    headers: {
      ...gatewayHeaders(deviceToken, projectId, init.body !== undefined),
      ...init.headers,
    },
  });
}

describeLive('live E2E — issue #1175 paired gateway isolation', () => {
  it('uses real paired auth to isolate projects, shape secrets/paths, and drive opaque worktrees', async () => {
    if (
      baseUrl !== 'http://127.0.0.1:54175' ||
      engineUrl !== 'http://127.0.0.1:55175'
    ) {
      throw new Error(
        'Issue #1175 live test requires sandbox API 127.0.0.1:54175 and engine 127.0.0.1:55175',
      );
    }
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !sandboxDir.startsWith('/') ||
      !dbPath.startsWith('/') ||
      secretMarker.length < 16
    ) {
      throw new Error(
        'Issue #1175 live test requires an attested absolute sandbox, DB path, and secret marker',
      );
    }
    if (
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      dbPath.includes('/Library/Application Support/Rhythm/')
    ) {
      throw new Error(
        'Issue #1175 live test refuses any non-sandbox or installed-app database',
      );
    }

    const db = new Database(dbPath);
    const runId = randomUUID();
    const userToken = randomUUID();
    const projectAId = randomUUID();
    const projectBId = randomUUID();
    const boundary = join(sandboxDir, `issue-1175-${runId}`);
    const projectARoot = join(boundary, 'project-a');
    const projectBRoot = join(boundary, 'project-b');
    mkdirSync(projectARoot, { recursive: true });
    mkdirSync(projectBRoot, { recursive: true });
    writeFileSync(join(projectARoot, 'proof.txt'), `ISSUE-1175-A-${runId}\n`);
    writeFileSync(join(projectBRoot, 'proof.txt'), `ISSUE-1175-B-${runId}\n`);
    execFileSync('git', ['init', '-q'], { cwd: projectARoot });
    execFileSync('git', ['add', 'proof.txt'], { cwd: projectARoot });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Rhythm Live Test',
        '-c',
        'user.email=rhythm-live@example.test',
        'commit',
        '-qm',
        'initial',
      ],
      { cwd: projectARoot },
    );
    writeFileSync(
      join(projectARoot, 'proof.txt'),
      `ISSUE-1175-A-${runId}\nchanged\n`,
    );

    let userId: number | null = null;
    let deviceId: string | null = null;
    let deviceToken = '';
    let sessionA: string | null = null;
    let sessionB: string | null = null;
    let worktreeReference: string | null = null;
    try {
      userId = Number(
        db.prepare(
          `INSERT INTO users (name, email, google_sub)
           VALUES (?, ?, ?)`,
        ).run(
          'Issue 1175 User',
          `issue-1175-${runId}@example.com`,
          `issue-1175-${runId}`,
        ).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES (?, ?, ?)`,
      ).run(
        userToken,
        userId,
        new Date(Date.now() + 10 * 60_000).toISOString(),
      );
      const insertProject = db.prepare(
        `INSERT INTO projects
           (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty,
            vcs_checked_at, created_at, archived_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
      );
      insertProject.run(
        projectAId,
        'Issue 1175 A',
        projectARoot,
        new Date().toISOString(),
      );
      insertProject.run(
        projectBId,
        'Issue 1175 B',
        projectBRoot,
        new Date().toISOString(),
      );

      const pairingCodeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      );
      expect(pairingCodeResponse.status).toBe(201);
      const pairingCode = (await pairingCodeResponse.json()) as {
        pairingCode: string;
      };
      const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairingCode: pairingCode.pairingCode,
          deviceName: 'Issue 1175 Live iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      deviceId = paired.deviceId;
      deviceToken = paired.deviceToken;

      const create = async (projectId: string, title: string) => {
        const response = await gatewayRequest(
          deviceToken,
          projectId,
          '/session',
          { method: 'POST', body: JSON.stringify({ title }) },
        );
        expect(response.status).toBe(200);
        return (await response.json()) as { id: string };
      };
      sessionA = (await create(projectAId, 'Issue 1175 A')).id;
      sessionB = (await create(projectBId, 'Issue 1175 B')).id;

      const sessionsAResponse = await gatewayRequest(
        deviceToken,
        projectAId,
        '/session',
      );
      expect(sessionsAResponse.status).toBe(200);
      const sessionsA = (await sessionsAResponse.json()) as Array<{
        id: string;
      }>;
      expect(sessionsA.map(({ id }) => id)).toContain(sessionA);
      expect(sessionsA.map(({ id }) => id)).not.toContain(sessionB);

      const statusAResponse = await gatewayRequest(
        deviceToken,
        projectAId,
        '/session/status',
      );
      expect(statusAResponse.status).toBe(200);
      const statusA = await statusAResponse.json() as Record<string, unknown>;
      expect(statusA).not.toHaveProperty(sessionB);

      for (const [method, path, body] of [
        ['GET', `/session/${sessionB}/message`, undefined],
        ['POST', `/session/${sessionB}/abort`, '{}'],
        ['PATCH', `/session/${sessionB}`, JSON.stringify({ title: 'tamper' })],
        ['DELETE', `/session/${sessionB}`, undefined],
      ] as const) {
        const denied = await gatewayRequest(
          deviceToken,
          projectAId,
          path,
          { method, ...(body === undefined ? {} : { body }) },
        );
        expect(denied.status, `${method} ${path}`).toBe(404);
      }
      const deniedSse = await fetch(
        `${baseUrl}/mobile-gateway/sessions/${encodeURIComponent(sessionB)}/events`,
        { headers: gatewayHeaders(deviceToken, projectAId) },
      );
      expect(deniedSse.status).toBe(404);

      for (const method of ['POST', 'DELETE']) {
        const deniedShare = await gatewayRequest(
          deviceToken,
          projectAId,
          `/session/${sessionA}/share`,
          { method },
        );
        expect(deniedShare.status).toBe(403);
        expect(await deniedShare.json()).toMatchObject({
          error: { code: 'OPERATION_NOT_ALLOWED' },
        });
      }

      const pathResponse = await gatewayRequest(
        deviceToken,
        projectAId,
        '/path',
      );
      expect(pathResponse.status).toBe(200);
      const pathPayload = JSON.stringify(await pathResponse.json());
      expect(pathPayload).not.toContain(projectARoot);
      expect(pathPayload).not.toContain(sandboxDir);
      expect(pathPayload).not.toMatch(
        /"(?:root|cwd|home|state|worktree|worktreeDir)"\s*:/i,
      );

      const configUpdate = await gatewayRequest(
        deviceToken,
        projectAId,
        '/config',
        {
          method: 'PATCH',
          body: JSON.stringify({
            provider: {
              anthropic: {
                options: { apiKey: secretMarker },
              },
            },
          }),
        },
      );
      expect(configUpdate.status).toBe(200);
      expect(JSON.stringify(await configUpdate.json()))
        .not.toContain(secretMarker);
      const configResponse = await gatewayRequest(
        deviceToken,
        projectAId,
        '/config',
      );
      expect(configResponse.status).toBe(200);
      const configPayload = JSON.stringify(await configResponse.json());
      expect(configPayload).not.toContain(secretMarker);
      expect(configPayload).not.toContain(sandboxDir);

      for (const reloadPath of ['/skill/reload', '/config/reload']) {
        const reload = await gatewayRequest(
          deviceToken,
          projectAId,
          reloadPath,
          { method: 'POST', body: '{}' },
        );
        expect(reload.status, reloadPath).toBe(200);
      }

      const rawDiff = await gatewayRequest(
        deviceToken,
        projectAId,
        '/vcs/diff/raw',
      );
      expect(rawDiff.status).toBe(200);
      const rawDiffText = await rawDiff.text();
      expect(rawDiffText).toContain('changed');
      expect(rawDiffText).not.toContain(projectARoot);
      expect(rawDiffText).not.toContain(sandboxDir);

      const createdWorktree = await gatewayRequest(
        deviceToken,
        projectAId,
        '/experimental/worktree',
        {
          method: 'POST',
          body: JSON.stringify({ name: `issue-1175-${runId.slice(0, 8)}` }),
        },
      );
      expect(createdWorktree.status).toBe(200);
      const createdWorktreeBody = await createdWorktree.json() as {
        directory: string;
      };
      worktreeReference = createdWorktreeBody.directory;
      expect(worktreeReference).toMatch(/^rhythm-worktree:\/\//);
      expect(worktreeReference).not.toContain(sandboxDir);

      const listedWorktrees = await gatewayRequest(
        deviceToken,
        projectAId,
        '/experimental/worktree',
      );
      expect(listedWorktrees.status).toBe(200);
      expect(await listedWorktrees.json()).toContain(worktreeReference);

      const resetWorktree = await gatewayRequest(
        deviceToken,
        projectAId,
        '/experimental/worktree/reset',
        {
          method: 'POST',
          body: JSON.stringify({ directory: worktreeReference }),
        },
      );
      expect(resetWorktree.status).toBe(200);
      const arbitraryWorktree = await gatewayRequest(
        deviceToken,
        projectAId,
        '/experimental/worktree/reset',
        {
          method: 'POST',
          body: JSON.stringify({ directory: projectBRoot }),
        },
      );
      expect(arbitraryWorktree.status).toBe(403);
      expect(await arbitraryWorktree.json()).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });
    } finally {
      if (worktreeReference) {
        await gatewayRequest(
          deviceToken,
          projectAId,
          '/experimental/worktree',
          {
            method: 'DELETE',
            body: JSON.stringify({ directory: worktreeReference }),
          },
        ).catch(() => undefined);
      }
      for (const [selectedProjectId, sessionId] of [
        [projectAId, sessionA],
        [projectBId, sessionB],
      ] as const) {
        if (!sessionId) continue;
        await gatewayRequest(
          deviceToken,
          selectedProjectId,
          `/session/${sessionId}`,
          { method: 'DELETE' },
        ).catch(() => undefined);
      }
      if (deviceId !== null) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      }
      db.prepare(
        'DELETE FROM mobile_pairing_codes WHERE user_id = ?',
      ).run(userId);
      db.prepare(
        'DELETE FROM projects WHERE id IN (?, ?)',
      ).run(projectAId, projectBId);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(userToken);
      if (userId !== null) {
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      }
      db.close();
      if (dirname(boundary) === resolve(sandboxDir)) {
        rmSync(boundary, { recursive: true, force: true });
      }
    }
  });
});
