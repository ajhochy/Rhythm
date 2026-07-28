import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

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
  json = false,
): Record<string, string> {
  return {
    Authorization: `Device ${deviceToken}`,
    'X-Rhythm-Project-ID': projectId,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
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

function rejectedUpgradeStatus(
  url: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const socket = new WebSocket(url, { headers });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out waiting for PTY ownership rejection'));
    }, 5_000);
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout);
      response.resume();
      resolveStatus(response.statusCode ?? 0);
    });
    socket.once('open', () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error('Cross-user PTY WebSocket unexpectedly opened'));
    });
    socket.once('error', () => undefined);
  });
}

describeLive('live E2E — issue #1175 corrective security boundaries', () => {
  it('enforces desktop-human administration and durable two-user OpenCode ownership', async () => {
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
        'Corrective live test requires distinct isolated loopback API and engine ports',
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
        'Corrective live test requires an attested sandbox DB and explicit human capability',
      );
    }

    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    const runId = randomUUID();
    const projectId = randomUUID();
    const projectRoot = resolve(sandboxDir, `corrective-${runId}`);
    mkdirSync(projectRoot, { recursive: true });
    const users: LiveUser[] = [];
    let aliceSession: string | null = null;
    let bobSession: string | null = null;
    let legacySession: string | null = null;
    let alicePty: string | null = null;

    const tableExists = (name: string): boolean => Boolean(
      db.prepare(
        `SELECT 1 FROM sqlite_master
         WHERE type = 'table' AND name = ?`,
      ).get(name),
    );
    const pairingCodeCount = (): number => {
      if (!tableExists('mobile_pairing_codes')) return 0;
      return (db.prepare(
        'SELECT COUNT(*) AS count FROM mobile_pairing_codes',
      ).get() as { count: number }).count;
    };

    const insertUser = (name: string): LiveUser => {
      const bearer = randomUUID();
      const id = Number(
        db.prepare(
          `INSERT INTO users (name, email, google_sub)
           VALUES (?, ?, ?)`,
        ).run(
          name,
          `${name.toLowerCase()}-${runId}@example.test`,
          `${name.toLowerCase()}-${runId}`,
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
      const user: LiveUser = { id, bearer };
      users.push(user);
      return user;
    };

    const pair = async (
      user: (typeof users)[number],
      name: string,
    ): Promise<void> => {
      const deniedBefore = pairingCodeCount();
      const denied = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${user.bearer}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      );
      expect(denied.status).toBe(403);
      expect(pairingCodeCount()).toBe(deniedBefore);

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
          deviceName: `${name} live iPhone`,
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
      db.prepare(
        `INSERT INTO projects
           (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty,
            vcs_checked_at, created_at, archived_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
      ).run(
        projectId,
        'Issue 1175 Corrective',
        projectRoot,
        new Date().toISOString(),
      );
      const alice = insertUser('Alice');
      const bob = insertUser('Bob');
      await pair(alice, 'Alice');
      await pair(bob, 'Bob');

      const createSession = async (
        deviceToken: string,
        title: string,
      ): Promise<string> => {
        const response = await gatewayRequest(
          deviceToken,
          projectId,
          '/session',
          {
            method: 'POST',
            body: JSON.stringify({ title }),
          },
        );
        expect(response.status).toBe(200);
        return ((await response.json()) as { id: string }).id;
      };
      aliceSession = await createSession(
        alice.deviceToken!,
        'Alice corrective session',
      );
      bobSession = await createSession(
        bob.deviceToken!,
        'Bob corrective session',
      );

      const directLegacy = await fetch(
        `${engineUrl}/session?directory=${encodeURIComponent(projectRoot)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Unmapped legacy session' }),
        },
      );
      expect(directLegacy.status).toBe(200);
      legacySession = ((await directLegacy.json()) as { id: string }).id;

      const aliceList = await gatewayRequest(
        alice.deviceToken!,
        projectId,
        '/session',
      );
      expect(aliceList.status).toBe(200);
      const aliceIds = ((await aliceList.json()) as Array<{ id: string }>)
        .map(({ id }) => id);
      expect(aliceIds).toContain(aliceSession);
      expect(aliceIds).not.toContain(bobSession);
      expect(aliceIds).not.toContain(legacySession);

      const bobList = await gatewayRequest(
        bob.deviceToken!,
        projectId,
        '/session',
      );
      const bobIds = ((await bobList.json()) as Array<{ id: string }>)
        .map(({ id }) => id);
      expect(bobIds).toContain(bobSession);
      expect(bobIds).not.toContain(aliceSession);

      for (const foreignSession of [bobSession, legacySession]) {
        const denied = await gatewayRequest(
          alice.deviceToken!,
          projectId,
          `/session/${foreignSession}/message`,
        );
        expect(denied.status).toBe(404);
        const deniedSse = await fetch(
          `${baseUrl}/mobile-gateway/sessions/` +
            `${encodeURIComponent(foreignSession)}/events`,
          { headers: gatewayHeaders(alice.deviceToken!, projectId) },
        );
        expect(deniedSse.status).toBe(404);
      }

      const ptyResponse = await gatewayRequest(
        alice.deviceToken!,
        projectId,
        '/pty',
        {
          method: 'POST',
          body: JSON.stringify({
            command: '/bin/sh',
            args: ['-lc', 'sleep 30'],
            title: 'Alice corrective PTY',
          }),
        },
      );
      expect(ptyResponse.status).toBe(200);
      alicePty = ((await ptyResponse.json()) as { id: string }).id;
      const bobTicketDenied = await gatewayRequest(
        bob.deviceToken!,
        projectId,
        `/pty/${alicePty}/connect-token`,
        { method: 'POST', body: '{}' },
      );
      expect(bobTicketDenied.status).toBe(404);

      const aliceTicketResponse = await gatewayRequest(
        alice.deviceToken!,
        projectId,
        `/pty/${alicePty}/connect-token`,
        { method: 'POST', body: '{}' },
      );
      expect(aliceTicketResponse.status).toBe(200);
      const { ticket } = (await aliceTicketResponse.json()) as {
        ticket: string;
      };
      const wsUrl = new URL(baseUrl);
      wsUrl.protocol = 'ws:';
      wsUrl.pathname =
        `/mobile-gateway/pty/${encodeURIComponent(alicePty)}/connect`;
      wsUrl.search = new URLSearchParams({ ticket }).toString();
      expect(await rejectedUpgradeStatus(wsUrl.toString(), {
        Authorization: `Device ${bob.deviceToken}`,
        'X-Rhythm-Project-ID': projectId,
      })).toBe(404);

      const bearerRevoke = await fetch(
        `${baseUrl}/mobile-gateway/devices/${alice.deviceId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${alice.bearer}` },
        },
      );
      expect(bearerRevoke.status).toBe(403);
      expect(
        db.prepare(
          'SELECT revoked_at FROM mobile_devices WHERE id = ?',
        ).get(alice.deviceId),
      ).toEqual({ revoked_at: null });
    } finally {
      const alice = users[0];
      if (alice?.deviceToken && alicePty) {
        await gatewayRequest(
          alice.deviceToken,
          projectId,
          `/pty/${alicePty}`,
          { method: 'DELETE' },
        ).catch(() => undefined);
      }
      for (const [user, sessionId] of [
        [users[0], aliceSession],
        [users[1], bobSession],
      ] as const) {
        if (!user?.deviceToken || !sessionId) continue;
        await gatewayRequest(
          user.deviceToken,
          projectId,
          `/session/${sessionId}`,
          { method: 'DELETE' },
        ).catch(() => undefined);
      }
      if (legacySession) {
        await fetch(
          `${engineUrl}/session/${encodeURIComponent(legacySession)}` +
            `?directory=${encodeURIComponent(projectRoot)}`,
          { method: 'DELETE' },
        ).catch(() => undefined);
      }
      for (const user of users) {
        if (user.deviceId) {
          db.prepare('DELETE FROM mobile_devices WHERE id = ?')
            .run(user.deviceId);
        }
        if (tableExists('mobile_pairing_codes')) {
          db.prepare('DELETE FROM mobile_pairing_codes WHERE user_id = ?')
            .run(user.id);
        }
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
