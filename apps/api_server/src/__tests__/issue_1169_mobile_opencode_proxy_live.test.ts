import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

describeLive('live E2E — issue #1169 mobile OpenCode proxy', () => {
  it('issue-1169-c8: live sandbox proxies health session and file behavior while rejecting upgrade', async () => {
    const apiAddress = new URL(baseUrl);
    const engineAddress = new URL(engineUrl);
    if (
      apiAddress.hostname !== '127.0.0.1' ||
      engineAddress.hostname !== '127.0.0.1' ||
      !apiAddress.port ||
      !engineAddress.port ||
      apiAddress.port === engineAddress.port ||
      ['4001', '4096', '4097', '4098'].includes(apiAddress.port) ||
      ['4001', '4096', '4097', '4098'].includes(engineAddress.port)
    ) {
      throw new Error(
        'Issue #1169 live test requires unique non-production loopback API and engine ports',
      );
    }
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !sandboxDir.startsWith('/') ||
      !dbPath.startsWith('/')
    ) {
      throw new Error(
        'Issue #1169 live test requires an attested absolute sandbox and DB path',
      );
    }
    if (
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      dbPath.includes('/Library/Application Support/Rhythm/')
    ) {
      throw new Error(
        'Issue #1169 live test refuses any non-sandbox or installed-app database',
      );
    }

    const db = new Database(dbPath);
    const runId = randomUUID();
    const userToken = randomUUID();
    const projectId = randomUUID();
    const boundary = join(sandboxDir, `issue-1169-${runId}`);
    const projectRoot = join(boundary, 'project');
    const outsideRoot = join(boundary, 'outside');
    const fileName = 'mobile-proxy-proof.txt';
    const marker = `MOBILE-PROXY-${runId}`;
    const dataMarker = `MOBILE-DATA-${runId}`;
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    writeFileSync(join(projectRoot, fileName), marker);
    writeFileSync(join(outsideRoot, 'secret.txt'), 'outside');
    symlinkSync(outsideRoot, join(projectRoot, 'escape'));

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
          'Issue 1169 User',
          `issue-1169-${runId}@example.com`,
          `issue-1169-${runId}`,
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
      ).run(projectId, 'Issue 1169 Live', projectRoot, new Date().toISOString());

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
          deviceName: 'Issue 1169 Live iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      deviceId = paired.deviceId;
      deviceToken = paired.deviceToken;

      const health = await fetch(
        `${baseUrl}/mobile-gateway/opencode/global/health`,
        { headers: gatewayHeaders(paired.deviceToken, projectId) },
      );
      const healthBody = await health.json();
      expect(
        health.status,
        `mobile proxy health response: ${JSON.stringify(healthBody)}`,
      ).toBe(200);
      expect(healthBody).toMatchObject({ healthy: true });

      const sessions = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session`,
        { headers: gatewayHeaders(paired.deviceToken, projectId) },
      );
      expect(sessions.status).toBe(200);
      expect(await sessions.json()).toEqual(expect.any(Array));

      const created = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session`,
        {
          method: 'POST',
          headers: gatewayHeaders(paired.deviceToken, projectId, true),
          body: JSON.stringify({ title: 'Issue 1169 live proxy' }),
        },
      );
      expect(created.status).toBe(200);
      const session = (await created.json()) as { id: string };
      expect(session.id).toBeTruthy();
      engineSessionId = session.id;

      const prompt = (path: 'message' | 'prompt_async', fileUrl: string) =>
        fetch(
          `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(session.id)}/${path}`,
          {
            method: 'POST',
            headers: gatewayHeaders(paired.deviceToken, projectId, true),
            body: JSON.stringify({
              noReply: true,
              parts: [
                { type: 'text', text: 'Read the attached text exactly.' },
                {
                  type: 'file',
                  mime: 'text/plain',
                  filename: 'proof.txt',
                  url: fileUrl,
                },
              ],
            }),
          },
        );

      for (const rejectedUrl of [
        pathToFileURL('/etc/passwd').href,
        pathToFileURL(join(outsideRoot, 'secret.txt')).href,
        pathToFileURL(join(projectRoot, 'escape', 'secret.txt')).href,
        'file://remote-host/etc/passwd',
        'http://127.0.0.1/private/local-file',
        'not-a-url',
      ]) {
        const rejected = await prompt('message', rejectedUrl);
        expect(rejected.status, rejectedUrl).toBe(403);
        expect(await rejected.json()).toMatchObject({
          error: { code: 'FORBIDDEN' },
        });
      }
      const emptyMessages = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(session.id)}/message`,
        { headers: gatewayHeaders(paired.deviceToken, projectId) },
      );
      expect(emptyMessages.status).toBe(200);
      expect(await emptyMessages.json()).toEqual([]);

      const containedPrompt = await prompt(
        'message',
        pathToFileURL(join(projectRoot, fileName)).href,
      );
      expect(containedPrompt.status).toBe(200);
      expect(JSON.stringify(await containedPrompt.json())).toContain(marker);

      const dataPrompt = await prompt(
        'prompt_async',
        `data:text/plain;base64,${Buffer.from(dataMarker).toString('base64')}`,
      );
      expect(dataPrompt.status).toBe(204);
      let dataTranscript = '';
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const dataPersisted = await fetch(
          `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(session.id)}/message`,
          { headers: gatewayHeaders(paired.deviceToken, projectId) },
        );
        expect(dataPersisted.status).toBe(200);
        dataTranscript = JSON.stringify(await dataPersisted.json());
        if (dataTranscript.includes(dataMarker)) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      }
      expect(dataTranscript).toContain(dataMarker);

      const file = await fetch(
        `${baseUrl}/mobile-gateway/opencode/file/content?path=${encodeURIComponent(fileName)}`,
        { headers: gatewayHeaders(paired.deviceToken, projectId) },
      );
      expect(file.status).toBe(200);
      expect(await file.json()).toMatchObject({ content: marker });

      const rejectedUpgrade = await fetch(
        `${baseUrl}/mobile-gateway/opencode/global/upgrade`,
        {
          method: 'POST',
          headers: gatewayHeaders(paired.deviceToken, projectId, true),
          body: '{}',
        },
      );
      expect(rejectedUpgrade.status).toBe(403);
      expect(await rejectedUpgrade.json()).toMatchObject({
        error: { code: 'OPERATION_NOT_ALLOWED' },
      });
    } finally {
      if (engineSessionId) {
        await fetch(
          `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(engineSessionId)}`,
          {
            method: 'DELETE',
            headers: gatewayHeaders(deviceToken ?? '', projectId),
          },
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
