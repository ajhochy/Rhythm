import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const engineUrl = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const humanCapability = process.env.RHYTHM_LIVE_HUMAN_CAPABILITY ?? '';

interface LiveUser {
  id: number;
  bearer: string;
  deviceId?: string;
  deviceToken?: string;
}

function gatewayHeaders(
  deviceToken: string,
  projectId: string,
  ownerUnscopedDiscovery = false,
): Record<string, string> {
  return {
    Authorization: `Device ${deviceToken}`,
    'X-Rhythm-Project-ID': projectId,
    ...(ownerUnscopedDiscovery
      ? { 'X-Rhythm-Session-Discovery': 'owner-unscoped' }
      : {}),
  };
}

async function sessionIds(response: Response): Promise<string[]> {
  expect(response.status).toBe(200);
  return ((await response.json()) as Array<{ id: string }>)
    .map(({ id }) => id);
}

describeLive('live E2E — issue #1285 owner-scoped Chats discovery', () => {
  it('merges project chats with read-only HOME chats without activity leakage', async () => {
    const parsedApi = new URL(baseUrl);
    const parsedEngine = new URL(engineUrl);
    if (
      parsedApi.hostname !== '127.0.0.1' ||
      parsedEngine.hostname !== '127.0.0.1' ||
      !parsedApi.port ||
      !parsedEngine.port ||
      parsedApi.port === '4001' ||
      parsedApi.port === parsedEngine.port
    ) {
      throw new Error(
        'Issue #1285 live test requires distinct isolated loopback API and engine ports',
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
        'Issue #1285 live test requires an attested sandbox DB and explicit human capability',
      );
    }

    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    const runId = randomUUID();
    const projectId = randomUUID();
    const projectRoot = resolve(sandboxDir, `issue-1285-project-${runId}`);
    const homeRoot = resolve(sandboxDir, 'home');
    const users: LiveUser[] = [];
    const localSessionIds: string[] = [];
    const engineSessions: Array<{ id: string; directory: string }> = [];
    mkdirSync(projectRoot, { recursive: true });

    const insertUser = (label: string): LiveUser => {
      const bearer = randomUUID();
      const id = Number(db.prepare(
        `INSERT INTO users (name, email, google_sub)
         VALUES (?, ?, ?)`,
      ).run(
        `Issue 1285 ${label}`,
        `issue-1285-${label.toLowerCase()}-${runId}@example.test`,
        `issue-1285-${label.toLowerCase()}-${runId}`,
      ).lastInsertRowid);
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES (?, ?, ?)`,
      ).run(
        bearer,
        id,
        new Date(Date.now() + 10 * 60_000).toISOString(),
      );
      const user = { id, bearer };
      users.push(user);
      return user;
    };

    const pair = async (user: LiveUser, label: string): Promise<void> => {
      const codeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${user.bearer}`,
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
          deviceName: `Issue 1285 ${label} test device`,
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      user.deviceId = paired.deviceId;
      user.deviceToken = paired.deviceToken;
    };

    const createEngineSession = async (
      title: string,
      directory: string,
    ): Promise<string> => {
      const response = await fetch(
        `${engineUrl}/session?directory=${encodeURIComponent(directory)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        },
      );
      expect(response.status).toBe(200);
      const id = ((await response.json()) as { id: string }).id;
      engineSessions.push({ id, directory });
      return id;
    };

    const insertCatalogSession = (
      sdkSessionId: string,
      ownerUserId: number,
      options: {
        projectId?: string | null;
        category?: 'chat' | 'scheduled' | 'self_improvement';
        isSystem?: boolean;
      } = {},
    ): void => {
      const localId = randomUUID();
      localSessionIds.push(localId);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO agent_sessions
           (id, agent_kind, status, cwd, name, project_id, owner_user_id,
            category, is_system, sdk_session_id, created_at, updated_at)
         VALUES (?, 'codex', 'idle', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        localId,
        options.projectId ? projectRoot : homeRoot,
        sdkSessionId,
        options.projectId ?? null,
        ownerUserId,
        options.category ?? 'chat',
        options.isSystem ? 1 : 0,
        sdkSessionId,
        now,
        now,
      );
    };

    try {
      db.prepare(
        `INSERT INTO projects
           (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty,
            vcs_checked_at, created_at, archived_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
      ).run(
        projectId,
        'Issue 1285 registered project',
        projectRoot,
        new Date().toISOString(),
      );
      const ownerA = insertUser('Owner A');
      const ownerB = insertUser('Owner B');
      await pair(ownerA, 'Owner A');
      await pair(ownerB, 'Owner B');

      const scopedHuman = await createEngineSession(
        'Issue 1285 registered project chat',
        projectRoot,
      );
      const unscopedHuman = await createEngineSession(
        'Issue 1285 desktop All Sessions chat',
        homeRoot,
      );
      const otherOwnerHuman = await createEngineSession(
        'Issue 1285 other owner chat',
        homeRoot,
      );
      const scheduled = await createEngineSession(
        'Issue 1285 scheduled execution',
        homeRoot,
      );
      const optimizer = await createEngineSession(
        'Issue 1285 optimizer execution',
        homeRoot,
      );

      insertCatalogSession(scopedHuman, ownerA.id, { projectId });
      insertCatalogSession(unscopedHuman, ownerA.id);
      insertCatalogSession(otherOwnerHuman, ownerB.id);
      insertCatalogSession(scheduled, ownerA.id, {
        category: 'scheduled',
        isSystem: true,
      });
      insertCatalogSession(optimizer, ownerA.id, {
        category: 'self_improvement',
        isSystem: true,
      });

      const scopedIds = await sessionIds(await fetch(
        `${baseUrl}/mobile-gateway/opencode/session`,
        { headers: gatewayHeaders(ownerA.deviceToken!, projectId) },
      ));
      expect(scopedIds).toEqual([scopedHuman]);

      const unscopedResponse = await fetch(
        `${baseUrl}/mobile-gateway/opencode/experimental/session?limit=100`,
        {
          headers: gatewayHeaders(
            ownerA.deviceToken!,
            projectId,
            true,
          ),
        },
      );
      expect(unscopedResponse.status).toBe(200);
      const unscoped = (await unscopedResponse.json()) as Array<{
        id: string;
        projectId: string;
        interaction: string;
        directory?: string;
      }>;
      expect(unscoped.map(({ id }) => id)).toEqual([unscopedHuman]);
      expect(unscoped[0]).toMatchObject({
        projectId,
        interaction: 'read-only',
      });
      expect(unscoped[0]).not.toHaveProperty('directory');

      const unscopedLookup = await fetch(
        `${baseUrl}/mobile-gateway/opencode/experimental/session?limit=1&search=${encodeURIComponent(unscopedHuman)}`,
        {
          headers: gatewayHeaders(ownerA.deviceToken!, projectId, true),
        },
      );
      const unscopedLookupBody = await unscopedLookup.json();
      expect({
        status: unscopedLookup.status,
        body: unscopedLookupBody,
      }).toEqual({
        status: 200,
        body: [expect.objectContaining({ id: unscopedHuman })],
      });

      const crossOwnerLookup = await fetch(
        `${baseUrl}/mobile-gateway/opencode/experimental/session?limit=1&search=${encodeURIComponent(unscopedHuman)}`,
        {
          headers: gatewayHeaders(ownerB.deviceToken!, projectId, true),
        },
      );
      expect(crossOwnerLookup.status).toBe(200);
      expect(await crossOwnerLookup.json()).toEqual([]);

      const otherOwnerIds = await sessionIds(await fetch(
        `${baseUrl}/mobile-gateway/opencode/experimental/session?limit=100`,
        {
          headers: gatewayHeaders(
            ownerB.deviceToken!,
            projectId,
            true,
          ),
        },
      ));
      expect(otherOwnerIds).toEqual([otherOwnerHuman]);

      const unscopedRead = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(unscopedHuman)}/message`,
        { headers: gatewayHeaders(ownerA.deviceToken!, projectId) },
      );
      expect(unscopedRead.status).toBe(200);
      expect(await unscopedRead.json()).toEqual([]);

      const unscopedTodos = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(unscopedHuman)}/todo`,
        { headers: gatewayHeaders(ownerA.deviceToken!, projectId) },
      );
      expect(unscopedTodos.status).toBe(200);
      expect(await unscopedTodos.json()).toEqual([]);

      const crossOwnerRead = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(unscopedHuman)}/message`,
        { headers: gatewayHeaders(ownerB.deviceToken!, projectId) },
      );
      expect(crossOwnerRead.status).toBe(404);
    } finally {
      for (const session of engineSessions) {
        await fetch(
          `${engineUrl}/session/${encodeURIComponent(session.id)}` +
            `?directory=${encodeURIComponent(session.directory)}`,
          { method: 'DELETE' },
        ).catch(() => undefined);
      }
      if (localSessionIds.length > 0) {
        const placeholders = localSessionIds.map(() => '?').join(', ');
        db.prepare(`DELETE FROM agent_sessions WHERE id IN (${placeholders})`)
          .run(...localSessionIds);
      }
      for (const user of users) {
        if (user.deviceId) {
          db.prepare('DELETE FROM mobile_devices WHERE id = ?')
            .run(user.deviceId);
        }
        db.prepare('DELETE FROM mobile_pairing_codes WHERE user_id = ?')
          .run(user.id);
        db.prepare('DELETE FROM sessions WHERE token = ?').run(user.bearer);
      }
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      for (const user of users) {
        db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      }
      db.close();
      if (resolve(projectRoot).startsWith(`${resolve(sandboxDir)}/`)) {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    }
  });
});
