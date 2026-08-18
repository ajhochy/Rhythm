import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import express from 'express';
import { describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { errorHandler } from '../middleware/error_handler';
import { createRelayGatewayRouter } from '../routes/relay_gateway_routes';
import { RelayUplinkServer } from '../services/relay_uplink_server';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const humanCapability = process.env.RHYTHM_LIVE_HUMAN_CAPABILITY ?? '';
const relayBearer = process.env.RHYTHM_RELAY_BEARER ?? '';
const relayPort = Number(process.env.RHYTHM_LIVE_RELAY_PORT ?? '0');

describeLive('live E2E — issue #1387 bodyless relay catalog reads', () => {
  it('loads projects and sessions through the real sandbox Mac uplink without a 502', async () => {
    const apiAddress = new URL(baseUrl);
    if (
      apiAddress.hostname !== '127.0.0.1' ||
      !apiAddress.port ||
      apiAddress.port === '4001' ||
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !sandboxDir.startsWith('/') ||
      !dbPath.startsWith('/') ||
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      dbPath.includes('/Library/Application Support/Rhythm/') ||
      humanCapability.length < 24 ||
      relayBearer.length < 16 ||
      !Number.isSafeInteger(relayPort) ||
      relayPort < 1024
    ) {
      throw new Error(
        'Issue #1387 live test requires isolated loopback API/relay ports, sandbox DB, and throwaway credentials',
      );
    }

    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    setDb(db);
    const runId = randomUUID();
    const userToken = randomUUID();
    const projectId = randomUUID();
    const projectRoot = resolve(sandboxDir, `issue-1387-project-${runId}`);
    mkdirSync(projectRoot, { recursive: true });

    const uplink = new RelayUplinkServer({
      bearerValidator: async (token) =>
        token === relayBearer ? { userId: 1 } : null,
    });
    const relayApp = express();
    relayApp.use(express.json({ limit: '2mb' }));
    relayApp.use('/relay', createRelayGatewayRouter({ uplink }));
    relayApp.use(errorHandler);
    const relayServer = http.createServer(relayApp);
    relayServer.on('upgrade', (request, socket, head) => {
      if (!uplink.handleUpgrade(request, socket, head)) socket.destroy();
    });

    let userId: number | null = null;
    let deviceId: string | null = null;
    const localAgentSessionId = randomUUID();
    const localSdkSessionId = `ses_issue1387_${runId.replaceAll('-', '')}`;
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        relayServer.once('error', rejectListen);
        relayServer.listen(relayPort, '127.0.0.1', () => resolveListen());
      });

      const onlineDeadline = Date.now() + 30_000;
      let macOnline = false;
      while (Date.now() < onlineDeadline) {
        const health = await fetch(
          `http://127.0.0.1:${relayPort}/relay/mobile-gateway/health`,
        );
        if (health.ok) {
          const body = (await health.json()) as { macOnline?: boolean };
          if (body.macOnline === true) {
            macOnline = true;
            break;
          }
        }
        await new Promise((wait) => setTimeout(wait, 100));
      }
      expect(macOnline, 'sandbox Mac uplink never reached the live relay').toBe(
        true,
      );

      userId = Number(
        db.prepare(
          `INSERT INTO users (name, email, google_sub)
           VALUES (?, ?, ?)`,
        ).run(
          'Issue 1387 Relay User',
          `issue-1387-${runId}@example.test`,
          `issue-1387-${runId}`,
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
      ).run(
        projectId,
        'Issue 1387 Relay Project',
        projectRoot,
        new Date().toISOString(),
      );

      const codeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userToken}`,
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
          deviceName: 'Issue 1387 Relay iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      deviceId = paired.deviceId;

      const authDeadline = Date.now() + 10_000;
      let projectsResponse: Response | null = null;
      while (Date.now() < authDeadline) {
        const candidate = await fetch(
          `http://127.0.0.1:${relayPort}/relay/mobile-gateway/projects`,
          { headers: { Authorization: `Device ${paired.deviceToken}` } },
        );
        if (candidate.status !== 401) {
          projectsResponse = candidate;
          break;
        }
        await new Promise((wait) => setTimeout(wait, 100));
      }
      expect(projectsResponse).not.toBeNull();
      const projectsBody = await projectsResponse!.json();
      expect(
        projectsResponse!.status,
        `relay projects response: ${JSON.stringify(projectsBody)}`,
      ).toBe(200);
      expect(projectsBody).toMatchObject({
        projects: expect.arrayContaining([
          expect.objectContaining({ id: projectId }),
        ]),
      });

      const sessionsResponse = await fetch(
        `http://127.0.0.1:${relayPort}/relay/mobile-gateway/opencode/session`,
        {
          headers: {
            Authorization: `Device ${paired.deviceToken}`,
            'X-Rhythm-Project-ID': projectId,
          },
        },
      );
      const sessionsBody = await sessionsResponse.json();
      expect(
        sessionsResponse.status,
        `relay sessions response: ${JSON.stringify(sessionsBody)}`,
      ).toBe(200);
      expect(sessionsBody).toEqual(expect.any(Array));

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO agent_sessions
           (id, agent_kind, status, cwd, name, project_id, owner_user_id,
            category, sdk_session_id, created_at, updated_at)
         VALUES (?, 'codex', 'idle', ?, ?, ?, ?, 'chat', ?, ?, ?)`,
      ).run(
        localAgentSessionId,
        projectRoot,
        'Issue 1387 Mac owner catalog chat',
        projectId,
        userId,
        localSdkSessionId,
        now,
        now,
      );

      const ownerCatalogResponse = await fetch(
        `http://127.0.0.1:${relayPort}/relay/mobile-gateway/chat-catalog?limit=10`,
        {
          headers: {
            Authorization: `Device ${paired.deviceToken}`,
            'X-Rhythm-Project-ID': projectId,
          },
        },
      );
      const ownerCatalog = await ownerCatalogResponse.json();
      expect(
        ownerCatalogResponse.status,
        `relay owner catalog response: ${JSON.stringify(ownerCatalog)}`,
      ).toBe(200);
      expect(ownerCatalog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: localSdkSessionId,
            projectId,
          }),
        ]),
      );
    } finally {
      db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(
        localAgentSessionId,
      );
      if (deviceId) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      }
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      if (userId) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      }
      db.close();
      uplink.stop();
      await new Promise<void>((resolveClose) =>
        relayServer.close(() => resolveClose()),
      );
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
