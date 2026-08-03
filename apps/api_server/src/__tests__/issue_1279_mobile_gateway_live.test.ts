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
const humanCapability =
  process.env.RHYTHM_LIVE_HUMAN_CAPABILITY ?? '';

interface LiveUser {
  id: number;
  bearer: string;
  deviceId?: string;
  deviceToken?: string;
}

function gatewayHeaders(
  deviceToken: string,
  projectId: string,
): Record<string, string> {
  return {
    Authorization: `Device ${deviceToken}`,
    'X-Rhythm-Project-ID': projectId,
  };
}

async function gatewaySessions(
  user: LiveUser,
  projectId: string,
): Promise<string[]> {
  const response = await fetch(
    `${baseUrl}/mobile-gateway/opencode/session`,
    { headers: gatewayHeaders(user.deviceToken!, projectId) },
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as Array<{ id: string }>)
    .map(({ id }) => id);
}

async function waitFor<T>(
  read: () => T | undefined,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for live behavior`);
}

describeLive('live E2E — issue #1279 desktop session claim fallback', () => {
  it('shows projectless desktop sessions only to their exact owner', async () => {
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
        'Issue #1279 live test requires distinct isolated loopback API and engine ports',
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
        'Issue #1279 live test requires an attested sandbox DB and explicit human capability',
      );
    }

    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    const runId = randomUUID();
    const projectPId = randomUUID();
    const projectQId = randomUUID();
    const projectRoot = resolve(sandboxDir, `issue-1279-${runId}`);
    const users: LiveUser[] = [];
    const localSessionIds = [randomUUID(), randomUUID()];
    const sdkSessionIds: string[] = [];
    mkdirSync(projectRoot, { recursive: true });

    const insertUser = (name: string): LiveUser => {
      const bearer = randomUUID();
      const id = Number(
        db.prepare(
          `INSERT INTO users (name, email, google_sub)
           VALUES (?, ?, ?)`,
        ).run(
          name,
          `issue-1279-${name.toLowerCase()}-${runId}@example.test`,
          `issue-1279-${name.toLowerCase()}-${runId}`,
        ).lastInsertRowid,
      );
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

    const pair = async (user: LiveUser, name: string): Promise<void> => {
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
          deviceName: `Issue 1279 ${name} iPhone`,
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

    try {
      const insertProject = db.prepare(
        `INSERT INTO projects
           (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty,
            vcs_checked_at, created_at, archived_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
      );
      insertProject.run(
        projectPId,
        'Issue 1279 project P',
        projectRoot,
        new Date().toISOString(),
      );
      // The same root deliberately isolates the ownership-project check from
      // path containment when caller A selects project Q.
      insertProject.run(
        projectQId,
        'Issue 1279 project Q',
        projectRoot,
        new Date().toISOString(),
      );

      const userA = insertUser('A');
      const userB = insertUser('B');
      await pair(userA, 'A');
      await pair(userB, 'B');

      const scopedDesktop = await fetch(
        `${engineUrl}/session?directory=${encodeURIComponent(projectRoot)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Issue 1279 scoped desktop session' }),
        },
      );
      expect(scopedDesktop.status).toBe(200);
      const scopedSdkSessionId =
        ((await scopedDesktop.json()) as { id: string }).id;
      sdkSessionIds.push(scopedSdkSessionId);

      const unscopedDesktop = await fetch(
        `${engineUrl}/session?directory=${encodeURIComponent(projectRoot)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Issue 1279 All Sessions desktop session',
          }),
        },
      );
      expect(unscopedDesktop.status).toBe(200);
      const unscopedSdkSessionId =
        ((await unscopedDesktop.json()) as { id: string }).id;
      sdkSessionIds.push(unscopedSdkSessionId);

      const now = new Date().toISOString();
      const insertAgentSession = db.prepare(
        `INSERT INTO agent_sessions
           (id, agent_kind, status, cwd, name, project_id, owner_user_id,
            category, sdk_session_id, created_at, updated_at)
         VALUES (?, 'codex', 'idle', ?, ?, ?, ?, 'chat', ?, ?, ?)`,
      );
      insertAgentSession.run(
        localSessionIds[0],
        projectRoot,
        'Issue 1279 scoped desktop session',
        projectPId,
        userA.id,
        scopedSdkSessionId,
        now,
        now,
      );
      insertAgentSession.run(
        localSessionIds[1],
        projectRoot,
        'Issue 1279 All Sessions desktop session',
        null,
        userA.id,
        unscopedSdkSessionId,
        now,
        now,
      );
      const claimCount = (sdkSessionId: string): number => (
        db.prepare(
          `SELECT COUNT(*) AS count
             FROM mobile_opencode_resource_owners
            WHERE resource_kind = 'session'
              AND resource_id = ?`,
        ).get(sdkSessionId) as { count: number }
      ).count;
      expect(claimCount(scopedSdkSessionId)).toBe(0);
      expect(claimCount(unscopedSdkSessionId)).toBe(0);

      const ownerProjectP = await gatewaySessions(userA, projectPId);
      expect(ownerProjectP).toContain(scopedSdkSessionId);
      expect(ownerProjectP).toContain(unscopedSdkSessionId);

      const otherOwnerProjectP = await gatewaySessions(userB, projectPId);
      expect(otherOwnerProjectP).not.toContain(scopedSdkSessionId);
      expect(otherOwnerProjectP).not.toContain(unscopedSdkSessionId);

      const ownerProjectQ = await gatewaySessions(userA, projectQId);
      expect(ownerProjectQ).not.toContain(scopedSdkSessionId);
      expect(ownerProjectQ).toContain(unscopedSdkSessionId);

      const executionStateBody = JSON.stringify({
        profileId: null,
        opencodeAgentId: null,
        providerId: null,
        modelId: null,
        thinkingBudget: null,
        permissionMode: 'default',
      });
      const updateState = (
        user: LiveUser,
        projectId: string,
        sdkSessionId: string,
      ) => fetch(
        `${baseUrl}/mobile-gateway/sessions/` +
          `${encodeURIComponent(sdkSessionId)}/state`,
        {
          method: 'PATCH',
          headers: {
            ...gatewayHeaders(user.deviceToken!, projectId),
            'Content-Type': 'application/json',
          },
          body: executionStateBody,
        },
      );
      expect((await updateState(
        userA,
        projectPId,
        unscopedSdkSessionId,
      )).status).toBe(200);
      expect((await updateState(
        userA,
        projectQId,
        unscopedSdkSessionId,
      )).status).toBe(200);
      expect((await updateState(
        userB,
        projectPId,
        unscopedSdkSessionId,
      )).status).toBe(404);
      expect((await updateState(
        userA,
        projectQId,
        scopedSdkSessionId,
      )).status).toBe(404);

      const promptMarker = `issue-1279-mobile-sync-${runId}`;
      const promptResponse = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session/` +
          `${encodeURIComponent(unscopedSdkSessionId)}/prompt_async`,
        {
          method: 'POST',
          headers: {
            ...gatewayHeaders(userA.deviceToken!, projectQId),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            parts: [{
              type: 'text',
              text: `Respond exactly "${promptMarker}" and nothing else.`,
            }],
          }),
        },
      );
      expect(promptResponse.status).toBe(204);

      const persistedMobileInput = await waitFor(() => db.prepare(
        `SELECT role, raw_text
           FROM agent_session_messages
          WHERE session_id = ?
            AND role = 'input'
            AND raw_text LIKE ?
          ORDER BY created_at DESC
          LIMIT 1`,
      ).get(localSessionIds[1], `%${promptMarker}%`) as
        | { role: string; raw_text: string }
        | undefined);
      expect(persistedMobileInput.role).toBe('input');
      expect(persistedMobileInput.raw_text).toContain(promptMarker);
      // Read visibility must not silently relax the explicit-claim predicate
      // used by catalog reconciliation.
      expect(claimCount(scopedSdkSessionId)).toBe(0);
      expect(claimCount(unscopedSdkSessionId)).toBe(0);
    } finally {
      for (const sdkSessionId of sdkSessionIds) {
        await fetch(
          `${engineUrl}/session/${encodeURIComponent(sdkSessionId)}` +
            `?directory=${encodeURIComponent(projectRoot)}`,
          { method: 'DELETE' },
        ).catch(() => undefined);
      }
      db.prepare('DELETE FROM agent_sessions WHERE id IN (?, ?)')
        .run(localSessionIds[0], localSessionIds[1]);
      for (const user of users) {
        if (user.deviceId) {
          db.prepare('DELETE FROM mobile_devices WHERE id = ?')
            .run(user.deviceId);
        }
        db.prepare('DELETE FROM mobile_pairing_codes WHERE user_id = ?')
          .run(user.id);
        db.prepare('DELETE FROM sessions WHERE token = ?').run(user.bearer);
      }
      db.prepare('DELETE FROM projects WHERE id IN (?, ?)')
        .run(projectPId, projectQId);
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
