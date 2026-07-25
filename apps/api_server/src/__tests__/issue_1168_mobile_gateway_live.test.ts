import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const engineUrl = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';

function bearer(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

describeLive('live E2E — issue #1168 mobile gateway security', () => {
  it('issue-1168-c4: live sandbox enforces device auth and registered-project containment', async () => {
    if (
      baseUrl !== 'http://127.0.0.1:4098' ||
      engineUrl !== 'http://127.0.0.1:4097'
    ) {
      throw new Error(
        'Issue #1168 live test requires sandbox API 127.0.0.1:4098 and engine 127.0.0.1:4097',
      );
    }
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !sandboxDir.startsWith('/') ||
      !dbPath.startsWith('/')
    ) {
      throw new Error('Issue #1168 live test requires an attested absolute sandbox and DB path');
    }
    if (
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      dbPath.includes('/Library/Application Support/Rhythm/')
    ) {
      throw new Error('Issue #1168 live test refuses any non-sandbox or installed-app database');
    }

    const db = new Database(dbPath);
    const runId = randomUUID();
    const userToken = randomUUID();
    const projectId = randomUUID();
    const boundary = join(sandboxDir, `issue-1168-${runId}`);
    const projectRoot = join(boundary, 'project');
    const outside = join(boundary, 'outside');
    const sibling = join(boundary, `${basename(projectRoot)}-sibling`);
    mkdirSync(join(projectRoot, 'inside'), { recursive: true });
    mkdirSync(outside);
    mkdirSync(sibling);
    writeFileSync(join(projectRoot, 'inside', 'file.txt'), 'inside');
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    writeFileSync(join(sibling, 'secret.txt'), 'sibling');
    symlinkSync(outside, join(projectRoot, 'escape'));

    let userId: number | null = null;
    let deviceId: string | null = null;
    try {
      userId = Number(
        db.prepare(
          `INSERT INTO users (name, email, google_sub)
           VALUES (?, ?, ?)`,
        ).run(
          'Issue 1168 User',
          `issue-1168-${runId}@example.com`,
          `issue-1168-${runId}`,
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
      ).run(projectId, 'Issue 1168 Live', projectRoot, new Date().toISOString());

      const unauthenticated = await fetch(`${baseUrl}/mobile-gateway/project`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Rhythm-Project-ID': 'unknown-before-auth',
        },
        body: JSON.stringify({ path: '../outside/secret.txt' }),
      });
      expect(unauthenticated.status).toBe(401);

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
          deviceName: 'Issue 1168 Live iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      deviceId = paired.deviceId;
      const requestScope = (selectedProjectId: string, body = {}) =>
        fetch(`${baseUrl}/mobile-gateway/project`, {
          method: 'POST',
          headers: {
            Authorization: `Device ${paired.deviceToken}`,
            'Content-Type': 'application/json',
            'X-Rhythm-Project-ID': selectedProjectId,
          },
          body: JSON.stringify(body),
        });

      const valid = await requestScope(projectId, { path: 'inside/file.txt' });
      expect(valid.status).toBe(200);
      expect(await valid.json()).toEqual({
        projectId,
        path: 'inside/file.txt',
      });

      const rejected = [
        requestScope('unknown-project'),
        requestScope(projectId, {
          path: join('..', basename(outside), 'secret.txt'),
        }),
        requestScope(projectId, { path: join(sibling, 'secret.txt') }),
        requestScope(projectId, { path: 'escape/secret.txt' }),
        requestScope(projectId, { root: outside }),
      ];
      expect((await Promise.all(rejected)).map((response) => response.status))
        .toEqual([404, 403, 403, 403, 403]);

      const revoke = await fetch(
        `${baseUrl}/mobile-gateway/devices/${paired.deviceId}`,
        {
          method: 'DELETE',
          headers: bearer(userToken),
        },
      );
      expect(revoke.status).toBe(204);
      expect((await requestScope(projectId)).status).toBe(401);
    } finally {
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
