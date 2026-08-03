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

interface EngineSession {
  id: string;
  mcpAllowlist?: {
    servers: string[];
    tools: string[];
  };
  skillAllowlist?: {
    skills: string[];
  };
}

describeLive('live E2E — issue #1282 mobile session scope parity', () => {
  it('persists the selected profile allowlists on the real engine session', async () => {
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
        'Issue #1282 live test requires distinct isolated loopback API and engine ports',
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
        'Issue #1282 live test requires an attested sandbox DB and explicit human capability',
      );
    }

    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    const runId = randomUUID();
    const projectId = randomUUID();
    const profileId = `issue-1282-${runId}`;
    const projectRoot = resolve(sandboxDir, `issue-1282-${runId}`);
    const bearer = randomUUID();
    let userId: number | null = null;
    let deviceId: string | null = null;
    let deviceToken: string | null = null;
    let sdkSessionId: string | null = null;
    mkdirSync(projectRoot, { recursive: true });

    try {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO projects
           (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty,
            vcs_checked_at, created_at, archived_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
      ).run(projectId, 'Issue 1282 project', projectRoot, now);
      db.prepare(
        `INSERT INTO agent_configs
           (id, label, icon, command, enabled, is_agent,
            allowed_mcps_json, allowed_skills_json, model_provider, model_id,
            oc_agent, session_selectable, created_at, updated_at)
         VALUES (?, ?, 'mail', '', 1, 1, ?, ?, 'anthropic',
                 'claude-sonnet-4-6', 'secretary', 1, ?, ?)`,
      ).run(
        profileId,
        'Issue 1282 Secretary',
        JSON.stringify(['rhythm']),
        JSON.stringify(['smoke-test']),
        now,
        now,
      );
      userId = Number(
        db.prepare(
          `INSERT INTO users (name, email, google_sub)
           VALUES (?, ?, ?)`,
        ).run(
          'Issue 1282 owner',
          `issue-1282-${runId}@example.test`,
          `issue-1282-${runId}`,
        ).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES (?, ?, ?)`,
      ).run(
        bearer,
        userId,
        new Date(Date.now() + 10 * 60_000).toISOString(),
      );

      const codeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${bearer}`,
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
          deviceName: 'Issue 1282 iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };
      deviceId = paired.deviceId;
      deviceToken = paired.deviceToken;

      const createResponse = await fetch(
        `${baseUrl}/mobile-gateway/opencode/session`,
        {
          method: 'POST',
          headers: {
            Authorization: `Device ${deviceToken}`,
            'Content-Type': 'application/json',
            'X-Rhythm-Project-ID': projectId,
          },
          body: JSON.stringify({
            title: 'Issue 1282 scoped mobile session',
            profileId,
          }),
        },
      );
      expect(createResponse.status).toBe(200);
      sdkSessionId =
        ((await createResponse.json()) as { id: string }).id;

      const engineResponse = await fetch(
        `${engineUrl}/session/${encodeURIComponent(sdkSessionId)}` +
          `?directory=${encodeURIComponent(projectRoot)}`,
      );
      expect(engineResponse.status).toBe(200);
      const engineSession = (await engineResponse.json()) as EngineSession;
      expect(engineSession.mcpAllowlist).toEqual({
        servers: ['rhythm'],
        tools: [],
      });
      expect(engineSession.skillAllowlist).toEqual({
        skills: ['smoke-test'],
      });
    } finally {
      if (sdkSessionId) {
        await fetch(
          `${engineUrl}/session/${encodeURIComponent(sdkSessionId)}` +
            `?directory=${encodeURIComponent(projectRoot)}`,
          { method: 'DELETE' },
        ).catch(() => undefined);
        db.prepare(
          'DELETE FROM mobile_opencode_resource_owners WHERE resource_id = ?',
        ).run(sdkSessionId);
        db.prepare('DELETE FROM agent_sessions WHERE sdk_session_id = ?')
          .run(sdkSessionId);
      }
      if (deviceId) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      }
      if (userId !== null) {
        db.prepare('DELETE FROM mobile_pairing_codes WHERE user_id = ?')
          .run(userId);
      }
      db.prepare('DELETE FROM sessions WHERE token = ?').run(bearer);
      db.prepare('DELETE FROM agent_configs WHERE id = ?').run(profileId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      if (userId !== null) {
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      }
      db.close();
      if (resolve(projectRoot).startsWith(`${resolve(sandboxDir)}/`)) {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    }
  });
});
