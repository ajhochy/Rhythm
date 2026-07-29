import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const humanCapability = process.env.RHYTHM_LIVE_HUMAN_CAPABILITY ?? '';

function desktopHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function gatewayHeaders(
  deviceToken: string,
  projectId: string,
): Record<string, string> {
  return {
    Authorization: `Device ${deviceToken}`,
    'X-Rhythm-Project-ID': projectId,
    'Content-Type': 'application/json',
  };
}

describeLive('issue #1231 live — one desktop/mobile session catalog', () => {
  it('issue-1231-c1/c2/c3: both surfaces create list and reconcile lifecycle through one sandbox', async () => {
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(baseUrl) ||
      !dbPath.startsWith('/') ||
      !sandboxDir.startsWith('/') ||
      humanCapability.length < 24
    ) {
      throw new Error(
        'Issue #1231 live test requires an attested isolated sandbox, DB, API URL, and throwaway human capability',
      );
    }
    if (
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      dbPath.includes('/Library/Application Support/Rhythm/')
    ) {
      throw new Error('Issue #1231 live test refuses the installed app database');
    }

    const db = new Database(dbPath);
    const runId = randomUUID();
    const projectId = randomUUID();
    const projectRoot = join(sandboxDir, `issue-1231-${runId}`);
    const userToken = randomUUID();
    mkdirSync(projectRoot, { recursive: true });

    let userId: number | null = null;
    let deviceId: string | null = null;
    let deviceToken = '';
    let desktopLocalId: string | null = null;
    let desktopSdkId: string | null = null;
    let mobileSdkId: string | null = null;
    try {
      userId = Number(db.prepare(
        `INSERT INTO users (name, email, google_sub)
         VALUES (?, ?, ?)`,
      ).run(
        'Issue 1231 User',
        `issue-1231-${runId}@example.com`,
        `issue-1231-${runId}`,
      ).lastInsertRowid);
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
      ).run(
        projectId,
        'Issue 1231 Project',
        projectRoot,
        new Date().toISOString(),
      );

      const pairingCodeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: {
            ...desktopHeaders(userToken),
            'X-Rhythm-Human-Approval': humanCapability,
          },
          body: '{}',
        },
      );
      expect(pairingCodeResponse.status).toBe(201);
      const pairingCode = await pairingCodeResponse.json() as {
        pairingCode: string;
        hostId: string;
      };
      const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: pairingCode.pairingCode,
          hostId: pairingCode.hostId,
          deviceName: 'Issue 1231 Live iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = await pairResponse.json() as {
        deviceId: string;
        deviceToken: string;
      };
      deviceId = paired.deviceId;
      deviceToken = paired.deviceToken;

      const desktopCreate = await fetch(`${baseUrl}/agent-sessions`, {
        method: 'POST',
        headers: desktopHeaders(userToken),
        body: JSON.stringify({
          agentId: null,
          cwd: projectRoot,
          projectId,
          name: `Desktop ${runId}`,
        }),
      });
      expect(desktopCreate.status).toBe(201);
      const desktopSession = await desktopCreate.json() as {
        id: string;
        sdkSessionId: string;
      };
      desktopLocalId = desktopSession.id;
      desktopSdkId = desktopSession.sdkSessionId;

      const gatewayList = async (archived = false) => {
        const path = archived
          ? '/experimental/session?archived=true'
          : '/session';
        const response = await fetch(
          `${baseUrl}/mobile-gateway/opencode${path}`,
          { headers: gatewayHeaders(deviceToken, projectId) },
        );
        expect(response.status).toBe(200);
        return await response.json() as Array<{
          id: string;
          title?: string;
        }>;
      };
      expect((await gatewayList()).map(({ id }) => id)).toContain(desktopSdkId);

      const mobileCreate = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session`,
        {
          method: 'POST',
          headers: gatewayHeaders(deviceToken, projectId),
          body: JSON.stringify({ title: `Mobile ${runId}` }),
        },
      );
      expect(mobileCreate.status).toBe(200);
      const mobileSession = await mobileCreate.json() as { id: string };
      mobileSdkId = mobileSession.id;

      const desktopList = async (includeArchived = false) => {
        const response = await fetch(
          `${baseUrl}/agent-sessions?projectId=${encodeURIComponent(projectId)}&includeArchived=${includeArchived}`,
          { headers: desktopHeaders(userToken) },
        );
        expect(response.status).toBe(200);
        return (await response.json()) as {
          sessions: Array<{
            id: string;
            sdkSessionId: string;
            name: string;
            archivedAt: string | null;
          }>;
        };
      };
      expect(
        (await desktopList()).sessions.map(({ sdkSessionId }) => sdkSessionId),
      ).toContain(mobileSdkId);

      const renamed = `Renamed mobile ${runId}`;
      const renameResponse = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session/${mobileSdkId}`,
        {
          method: 'PATCH',
          headers: gatewayHeaders(deviceToken, projectId),
          body: JSON.stringify({ title: renamed }),
        },
      );
      expect(renameResponse.status).toBe(200);
      expect(
        (await desktopList()).sessions.find(
          ({ sdkSessionId }) => sdkSessionId === mobileSdkId,
        )?.name,
      ).toBe(renamed);

      const archiveResponse = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session/${mobileSdkId}`,
        {
          method: 'PATCH',
          headers: gatewayHeaders(deviceToken, projectId),
          body: JSON.stringify({ time: { archived: Date.now() } }),
        },
      );
      expect(archiveResponse.status).toBe(200);
      expect(
        (await desktopList(true)).sessions.find(
          ({ sdkSessionId }) => sdkSessionId === mobileSdkId,
        )?.archivedAt,
      ).toBeTruthy();
      expect((await gatewayList(true)).map(({ id }) => id)).toContain(mobileSdkId);

      const restoreResponse = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session/${mobileSdkId}`,
        {
          method: 'PATCH',
          headers: gatewayHeaders(deviceToken, projectId),
          body: JSON.stringify({ time: { archived: 0 } }),
        },
      );
      expect(restoreResponse.status).toBe(200);
      expect(
        (await desktopList()).sessions.find(
          ({ sdkSessionId }) => sdkSessionId === mobileSdkId,
        )?.archivedAt,
      ).toBeNull();

      const deleteResponse = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session/${mobileSdkId}`,
        {
          method: 'DELETE',
          headers: gatewayHeaders(deviceToken, projectId),
        },
      );
      expect(deleteResponse.status).toBe(200);
      expect(
        (await desktopList(true)).sessions.some(
          ({ sdkSessionId }) => sdkSessionId === mobileSdkId,
        ),
      ).toBe(false);
      mobileSdkId = null;
    } finally {
      if (mobileSdkId && deviceToken) {
        await fetch(
          `${baseUrl}/mobile-gateway/opencode/session/${mobileSdkId}`,
          {
            method: 'DELETE',
            headers: gatewayHeaders(deviceToken, projectId),
          },
        ).catch(() => undefined);
      }
      if (desktopLocalId) {
        await fetch(`${baseUrl}/agent-sessions/${desktopLocalId}/hard`, {
          method: 'DELETE',
          headers: desktopHeaders(userToken),
        }).catch(() => undefined);
      }
      if (deviceId) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      }
      db.prepare(
        `DELETE FROM mobile_opencode_resource_owners
          WHERE project_id = ?`,
      ).run(projectId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(userToken);
      if (userId) db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      db.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
