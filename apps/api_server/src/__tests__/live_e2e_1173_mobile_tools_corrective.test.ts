import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const humanCapability =
  process.env.RHYTHM_LIVE_HUMAN_CAPABILITY ?? '';

function cloudHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Rhythm-Human-Approval': humanCapability,
  };
}

function deviceHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Device ${token}`,
    'Content-Type': 'application/json',
  };
}

function signature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describeLive('live E2E — issue #1173 mobile Tools corrective', () => {
  it('rotates an owner-scoped webhook secret once and immediately invalidates the old secret', async () => {
    const parsedUrl = new URL(baseUrl);
    if (
      parsedUrl.hostname !== '127.0.0.1' ||
      parsedUrl.port === '4001' ||
      !parsedUrl.port
    ) {
      throw new Error(
        'Issue #1173 live test requires an explicit isolated 127.0.0.1 non-4001 API URL',
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
        'Issue #1173 live test requires an attested isolated sandbox database',
      );
    }

    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    const runId = randomUUID();
    const ownerSession = randomUUID();
    const otherSession = randomUUID();
    const now = new Date().toISOString();
    const userIds: number[] = [];
    const deviceIds: string[] = [];
    let webhookId: string | null = null;

    try {
      const insertUser = db.prepare(
        `INSERT INTO users (name, email, google_sub)
         VALUES (?, ?, ?)`,
      );
      const ownerId = Number(
        insertUser.run(
          'Issue 1173 Webhook Owner',
          `issue-1173-owner-${runId}@example.com`,
          `issue-1173-owner-${runId}`,
        ).lastInsertRowid,
      );
      const otherId = Number(
        insertUser.run(
          'Issue 1173 Webhook Other',
          `issue-1173-other-${runId}@example.com`,
          `issue-1173-other-${runId}`,
        ).lastInsertRowid,
      );
      userIds.push(ownerId, otherId);
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES (?, ?, ?), (?, ?, ?)`,
      ).run(
        ownerSession,
        ownerId,
        new Date(Date.now() + 10 * 60_000).toISOString(),
        otherSession,
        otherId,
        new Date(Date.now() + 10 * 60_000).toISOString(),
      );

      const pair = async (
        sessionToken: string,
        name: string,
      ): Promise<{ deviceId: string; deviceToken: string }> => {
        const codeResponse = await fetch(
          `${baseUrl}/mobile-gateway/pairing-codes`,
          {
            method: 'POST',
            headers: cloudHeaders(sessionToken),
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
            deviceName: name,
          }),
        });
        expect(pairResponse.status).toBe(201);
        const paired = (await pairResponse.json()) as {
          deviceId: string;
          deviceToken: string;
        };
        deviceIds.push(paired.deviceId);
        return paired;
      };

      const owner = await pair(ownerSession, 'Issue 1173 Owner iPhone');
      const other = await pair(otherSession, 'Issue 1173 Other iPhone');
      const createdResponse = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-webhooks`,
        {
          method: 'POST',
          headers: deviceHeaders(owner.deviceToken),
          body: JSON.stringify({
            name: `Issue 1173 webhook ${runId}`,
            eventTypes: ['expected'],
            targetPrompt: 'This prompt must not run during the live gate.',
          }),
        },
      );
      expect(createdResponse.status).toBe(201);
      const created = (await createdResponse.json()) as {
        id: string;
        secret: string;
        url: string;
      };
      webhookId = created.id;
      expect(created.secret).toMatch(/^[a-f0-9]{32}$/);
      expect(created.url).toBe(
        `${baseUrl}/agent-webhooks/${created.id}/receive`,
      );

      const crossOwner = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-webhooks/${created.id}/rotate-secret`,
        {
          method: 'POST',
          headers: deviceHeaders(other.deviceToken),
          body: '{}',
        },
      );
      expect(crossOwner.status).toBe(404);

      const rotatedResponse = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-webhooks/${created.id}/rotate-secret`,
        {
          method: 'POST',
          headers: deviceHeaders(owner.deviceToken),
          body: '{}',
        },
      );
      expect(rotatedResponse.status).toBe(200);
      const rotated = (await rotatedResponse.json()) as {
        id: string;
        secret: string;
        url: string;
      };
      expect(rotated.id).toBe(created.id);
      expect(rotated.secret).toMatch(/^[a-f0-9]{32}$/);
      expect(rotated.secret).not.toBe(created.secret);
      expect(rotated.url).toBe(created.url);

      const payload = JSON.stringify({ event: 'different', runId });
      const oldSecretResponse = await fetch(created.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature-SHA256': signature(created.secret, payload),
        },
        body: payload,
      });
      expect(oldSecretResponse.status).toBe(401);

      const replacementSecretResponse = await fetch(created.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature-SHA256': signature(rotated.secret, payload),
        },
        body: payload,
      });
      expect(replacementSecretResponse.status).toBe(200);
      expect(await replacementSecretResponse.json()).toEqual({
        status: 'ignored',
        reason: 'event type not in allowlist',
      });

      const detailResponse = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-webhooks/${created.id}`,
        { headers: deviceHeaders(owner.deviceToken) },
      );
      expect(detailResponse.status).toBe(200);
      expect(await detailResponse.json()).toMatchObject({
        id: created.id,
        secret: '[redacted]',
        url: created.url,
      });

      const deleted = await fetch(
        `${baseUrl}/mobile-gateway/tools/agent-webhooks/${created.id}`,
        {
          method: 'DELETE',
          headers: deviceHeaders(owner.deviceToken),
        },
      );
      expect(deleted.status).toBe(204);
      webhookId = null;
    } finally {
      if (webhookId) {
        db.prepare(
          'DELETE FROM pending_claude_triggers WHERE webhook_endpoint_id = ?',
        ).run(webhookId);
        db.prepare(
          'DELETE FROM agent_webhook_endpoints WHERE id = ?',
        ).run(webhookId);
      }
      if (deviceIds.length > 0) {
        db.prepare(
          `DELETE FROM mobile_devices
           WHERE id IN (${deviceIds.map(() => '?').join(', ')})`,
        ).run(...deviceIds);
      }
      if (userIds.length > 0) {
        db.prepare(
          `DELETE FROM mobile_pairing_codes
           WHERE user_id IN (${userIds.map(() => '?').join(', ')})`,
        ).run(...userIds);
        db.prepare(
          `DELETE FROM sessions
           WHERE user_id IN (${userIds.map(() => '?').join(', ')})`,
        ).run(...userIds);
        db.prepare(
          `DELETE FROM users
           WHERE id IN (${userIds.map(() => '?').join(', ')})`,
        ).run(...userIds);
      }
      db.close();
    }
  });
});
