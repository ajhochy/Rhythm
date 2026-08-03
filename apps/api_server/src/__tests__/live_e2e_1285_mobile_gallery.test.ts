import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const humanCapability = process.env.RHYTHM_LIVE_HUMAN_CAPABILITY ?? '';

describeLive('live E2E — issue #1285 paired Gallery parity', () => {
  it('returns desktop Gallery metadata through Device auth without exposing its path', async () => {
    const parsedUrl = new URL(baseUrl);
    if (
      parsedUrl.hostname !== '127.0.0.1' ||
      parsedUrl.port === '4001' ||
      !parsedUrl.port
    ) {
      throw new Error(
        'Issue #1285 live test requires an explicit isolated 127.0.0.1 non-4001 API URL',
      );
    }
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !sandboxDir.startsWith('/') ||
      !dbPath.startsWith('/') ||
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      dbPath.includes('/Library/Application Support/Rhythm/') ||
      humanCapability.length < 24
    ) {
      throw new Error(
        'Issue #1285 live test requires an attested isolated sandbox database',
      );
    }

    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    const runId = randomUUID();
    const sessionToken = randomUUID();
    const projectId = randomUUID();
    const designId = randomUUID();
    const now = new Date().toISOString();
    let userId: number | null = null;
    let workspaceId: number | null = null;
    let deviceId: string | null = null;

    try {
      userId = Number(
        db
          .prepare(
            `INSERT INTO users (name, email, google_sub)
             VALUES (?, ?, ?)`,
          )
          .run(
            'Issue 1285 Gallery Admin',
            `issue-1285-gallery-${runId}@example.com`,
            `issue-1285-gallery-${runId}`,
          ).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES (?, ?, ?)`,
      ).run(
        sessionToken,
        userId,
        new Date(Date.now() + 10 * 60_000).toISOString(),
      );
      workspaceId = Number(
        db
          .prepare(
            `INSERT INTO workspaces (name, join_code, created_by, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(
            'Issue 1285 Gallery Workspace',
            randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase(),
            userId,
            now,
          ).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO workspace_members
           (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'admin', ?)`,
      ).run(workspaceId, userId, now);
      db.prepare(
        `INSERT INTO projects
           (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty,
            vcs_checked_at, created_at, archived_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
      ).run(projectId, 'Issue 1285 Gallery Project', sandboxDir, now);
      db.prepare(
        `INSERT INTO agent_designs
           (id, title, provider, artifact_type, file_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        designId,
        'Issue 1285 live desktop design',
        'built-in',
        'png',
        resolve(sandboxDir, 'private-gallery-artifact.png'),
        now,
      );

      const codeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
            'X-Rhythm-Human-Approval': humanCapability,
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
          deviceName: 'Issue 1285 Live iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      deviceId = paired.deviceId;

      const route = `${baseUrl}/mobile-gateway/tools/agent-designs`;
      expect((await fetch(route)).status).toBe(401);
      const headers = {
        Authorization: `Device ${paired.deviceToken}`,
        'X-Rhythm-Project-ID': projectId,
      };
      const listResponse = await fetch(route, { headers });
      expect(listResponse.status).toBe(200);
      const list = (await listResponse.json()) as Record<string, unknown>[];
      expect(list).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: designId,
            title: 'Issue 1285 live desktop design',
            provider: 'built-in',
          }),
        ]),
      );
      expect(JSON.stringify(list)).not.toContain('filePath');
      expect(JSON.stringify(list)).not.toContain(
        'private-gallery-artifact.png',
      );

      const detailResponse = await fetch(`${route}/${designId}`, { headers });
      expect(detailResponse.status).toBe(200);
      const detail = (await detailResponse.json()) as Record<string, unknown>;
      expect(detail).toMatchObject({ id: designId });
      expect(detail).not.toHaveProperty('filePath');

      const staleProject = await fetch(route, {
        headers: {
          Authorization: `Device ${paired.deviceToken}`,
          'X-Rhythm-Project-ID': 'unregistered-project',
        },
      });
      expect(staleProject.status).toBe(404);
      expect(
        (await fetch(`${route}/${designId}/artifact`, { headers })).status,
      ).toBe(404);
    } finally {
      db.prepare('DELETE FROM agent_designs WHERE id = ?').run(designId);
      if (deviceId) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      }
      if (userId !== null) {
        db.prepare('DELETE FROM mobile_pairing_codes WHERE user_id = ?').run(
          userId,
        );
      }
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      if (workspaceId !== null) {
        db.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').run(
          workspaceId,
        );
        db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
      }
      if (userId !== null) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      }
      db.close();
    }
  });
});
