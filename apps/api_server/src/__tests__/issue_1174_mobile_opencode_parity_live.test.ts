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
) {
  return fetch(`${baseUrl}/mobile-gateway/opencode${path}`, {
    ...init,
    headers: {
      ...gatewayHeaders(
        deviceToken,
        projectId,
        init.body !== undefined,
      ),
      ...init.headers,
    },
  });
}

describeLive('live E2E — issue #1174 mobile OpenCode parity', () => {
  it('issue-1174-live: real gateway exposes approved parity surfaces and blocks alternate-only routes', async () => {
    if (
      baseUrl !== 'http://127.0.0.1:54174' ||
      engineUrl !== 'http://127.0.0.1:55174'
    ) {
      throw new Error(
        'Issue #1174 live test requires sandbox API 127.0.0.1:54174 and engine 127.0.0.1:55174',
      );
    }
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !sandboxDir.startsWith('/') ||
      !dbPath.startsWith('/')
    ) {
      throw new Error(
        'Issue #1174 live test requires an attested absolute sandbox and DB path',
      );
    }
    if (
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      dbPath.includes('/Library/Application Support/Rhythm/')
    ) {
      throw new Error(
        'Issue #1174 live test refuses any non-sandbox or installed-app database',
      );
    }

    const db = new Database(dbPath);
    const runId = randomUUID();
    const userToken = randomUUID();
    const projectId = randomUUID();
    const boundary = join(sandboxDir, `issue-1174-${runId}`);
    const projectRoot = join(boundary, 'project');
    const fileName = 'mobile-parity-proof.txt';
    const marker = `MOBILE-PARITY-${runId}`;
    mkdirSync(projectRoot, { recursive: true });
    execFileSync('git', ['init', '--quiet', projectRoot]);
    writeFileSync(join(projectRoot, fileName), `${marker}\n`);

    let userId: number | null = null;
    let deviceId: string | null = null;
    let deviceToken: string | null = null;
    let engineSessionId: string | null = null;
    try {
      userId = Number(
        db.prepare(
          `INSERT INTO users (name, email, google_sub)
           VALUES (?, ?, ?)`,
        ).run(
          'Issue 1174 User',
          `issue-1174-${runId}@example.com`,
          `issue-1174-${runId}`,
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
      db.prepare(
        `INSERT INTO projects
           (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty,
            vcs_checked_at, created_at, archived_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
      ).run(projectId, 'Issue 1174 Live', projectRoot, new Date().toISOString());

      const codeResponse = await fetch(
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
      expect(codeResponse.status).toBe(201);
      const code = (await codeResponse.json()) as { pairingCode: string };
      const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairingCode: code.pairingCode,
          deviceName: 'Issue 1174 Live iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      deviceId = paired.deviceId;
      deviceToken = paired.deviceToken;

      const search = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/find?pattern=${encodeURIComponent(marker)}`,
      );
      expect(search.status).toBe(200);
      expect(JSON.stringify(await search.json())).toContain(fileName);

      const vcsStatus = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/vcs/status',
      );
      expect(vcsStatus.status).toBe(200);
      expect(JSON.stringify(await vcsStatus.json())).toContain(fileName);

      const skills = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/skill',
      );
      expect(skills.status).toBe(200);
      expect(await skills.json()).toEqual(expect.any(Array));

      const skillReload = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/skill/reload',
        { method: 'POST', body: '{}' },
      );
      expect(skillReload.status).toBe(200);
      expect(await skillReload.json()).toEqual(expect.any(Array));

      const configReload = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/config/reload',
        { method: 'POST', body: '{}' },
      );
      expect(configReload.status).toBe(200);
      expect(await configReload.json()).toBe(true);

      for (const {
        path,
        validate,
      } of [
        {
          path: '/global/config',
          validate: (value: unknown) =>
            value !== null && typeof value === 'object' && !Array.isArray(value),
        },
        {
          path: '/experimental/resource',
          validate: (value: unknown) =>
            value !== null && typeof value === 'object' && !Array.isArray(value),
        },
        {
          path: '/experimental/tool/ids',
          validate: (value: unknown) => Array.isArray(value),
        },
      ]) {
        const inspection = await gatewayRequest(
          paired.deviceToken,
          projectId,
          path,
        );
        const inspectionBody = await inspection.json();
        expect(
          inspection.status,
          `${path} response: ${JSON.stringify(inspectionBody)}`,
        ).toBe(200);
        expect(
          validate(inspectionBody),
          `${path} returned an unexpected shape: ${JSON.stringify(inspectionBody)}`,
        ).toBe(true);
      }

      const created = await gatewayRequest(
        paired.deviceToken,
        projectId,
        '/session',
        {
          method: 'POST',
          body: JSON.stringify({ title: 'Issue 1174 live parity' }),
        },
      );
      expect(created.status).toBe(200);
      const session = (await created.json()) as { id: string };
      expect(session.id).toBeTruthy();
      engineSessionId = session.id;

      const children = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/children`,
      );
      expect(children.status).toBe(200);
      expect(await children.json()).toEqual([]);

      const shell = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/shell`,
        {
          method: 'POST',
          body: JSON.stringify({
            agent: 'build',
            model: {
              providerID: 'openai',
              modelID: 'gpt-4.1-mini',
            },
            command: `printf '${marker}'`,
          }),
        },
      );
      expect(
        shell.status,
        `shell response: ${await shell.clone().text()}`,
      ).toBe(200);
      expect(JSON.stringify(await shell.json())).toContain(marker);

      const transcript = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/message`,
      );
      expect(transcript.status).toBe(200);
      const messages = (await transcript.json()) as Array<{
        info: { id: string; role: string };
        parts: Array<{
          id: string;
          sessionID: string;
          messageID: string;
          type: string;
          text?: string;
          synthetic?: boolean;
        }>;
      }>;
      const editable = messages.find(({ info, parts }) =>
        info.role === 'user' && parts.some((part) => part.type === 'text'),
      );
      const textPart = editable?.parts.find((part) => part.type === 'text');
      expect(editable).toBeTruthy();
      expect(textPart).toBeTruthy();

      const editedText = `Edited from mobile parity ${runId}`;
      const updatedPart = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/message/${encodeURIComponent(editable!.info.id)}/part/${encodeURIComponent(textPart!.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ ...textPart, text: editedText }),
        },
      );
      expect(updatedPart.status).toBe(200);
      expect(await updatedPart.json()).toMatchObject({ text: editedText });

      const deletedPart = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/message/${encodeURIComponent(editable!.info.id)}/part/${encodeURIComponent(textPart!.id)}`,
        { method: 'DELETE' },
      );
      expect(deletedPart.status).toBe(200);
      expect(await deletedPart.json()).toBe(true);

      const deletedMessage = await gatewayRequest(
        paired.deviceToken,
        projectId,
        `/session/${encodeURIComponent(session.id)}/message/${encodeURIComponent(editable!.info.id)}`,
        { method: 'DELETE' },
      );
      expect(deletedMessage.status).toBe(200);
      expect(await deletedMessage.json()).toBe(true);

      const deniedOperations = [
        { method: 'GET', path: '/config/providers' },
        { method: 'POST', path: '/mcp/fake/auth/authenticate' },
        {
          method: 'POST',
          path: `/session/${encodeURIComponent(session.id)}/permissions/fake`,
        },
        {
          method: 'GET',
          path: `/session/${encodeURIComponent(session.id)}`,
        },
        {
          method: 'GET',
          path: `/session/${encodeURIComponent(session.id)}/message/fake`,
        },
        {
          method: 'POST',
          path: `/session/${encodeURIComponent(session.id)}/message`,
        },
      ];
      for (const operation of deniedOperations) {
        const denied = await gatewayRequest(
          paired.deviceToken,
          projectId,
          operation.path,
          {
            method: operation.method,
            ...(operation.method === 'POST' ? { body: '{}' } : {}),
          },
        );
        expect(
          denied.status,
          `${operation.method} ${operation.path}`,
        ).toBe(403);
        expect(await denied.json()).toMatchObject({
          error: { code: 'OPERATION_NOT_ALLOWED' },
        });
      }
    } finally {
      if (engineSessionId) {
        await gatewayRequest(
          deviceToken ?? '',
          projectId,
          `/session/${encodeURIComponent(engineSessionId)}`,
          { method: 'DELETE' },
        ).catch(() => undefined);
      }
      if (deviceId !== null) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      }
      db.prepare(
        `DELETE FROM mobile_pairing_codes
         WHERE user_id = ?`,
      ).run(userId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
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
