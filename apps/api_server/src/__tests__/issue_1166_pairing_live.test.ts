import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';

function bearer(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

describeLive('live E2E — issue #1166 pairing security', () => {
  it('issue-1166-c4: live sandbox enforces pairing and device credential security', async () => {
    if (baseUrl !== 'http://127.0.0.1:4098') {
      throw new Error('RHYTHM_LIVE_URL must be the isolated sandbox API on 127.0.0.1:4098');
    }
    if (process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' || !dbPath.startsWith('/')) {
      throw new Error('Live pairing test requires an attested isolated absolute DB path');
    }
    if (dbPath.includes('/Library/Application Support/Rhythm/')) {
      throw new Error('Live pairing test refuses the installed app database');
    }

    const db = new Database(dbPath);
    const runId = randomUUID();
    const aliceToken = randomUUID();
    const bobToken = randomUUID();
    let aliceId: number | null = null;
    let bobId: number | null = null;
    try {
      const insertUser = db.prepare(
        `INSERT INTO users (name, email, google_sub)
         VALUES (?, ?, ?)`,
      );
      aliceId = Number(
        insertUser.run(
          'Issue 1166 Alice',
          `issue-1166-alice-${runId}@example.com`,
          `issue-1166-alice-${runId}`,
        ).lastInsertRowid,
      );
      bobId = Number(
        insertUser.run(
          'Issue 1166 Bob',
          `issue-1166-bob-${runId}@example.com`,
          `issue-1166-bob-${runId}`,
        ).lastInsertRowid,
      );
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES (?, ?, ?)`,
      ).run(aliceToken, aliceId, expiresAt);
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES (?, ?, ?)`,
      ).run(bobToken, bobId, expiresAt);

      const unauthenticated = await fetch(`${baseUrl}/mobile-gateway/devices`);
      expect(unauthenticated.status).toBe(401);
      const missingDeviceToken = await fetch(`${baseUrl}/mobile-gateway/health`);
      const invalidDeviceToken = await fetch(`${baseUrl}/mobile-gateway/health`, {
        headers: { Authorization: 'Device invalid-device-token' },
      });
      expect([missingDeviceToken.status, invalidDeviceToken.status]).toEqual([
        200,
        200,
      ]);

      const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
        method: 'POST',
        headers: bearer(aliceToken),
        body: JSON.stringify({ userId: bobId }),
      });
      expect(codeResponse.status).toBe(201);
      const code = (await codeResponse.json()) as {
        id: string;
        pairingCode: string;
        hostId: string;
      };
      const codeAtRest = db
        .prepare(
          `SELECT user_id, code_verifier FROM mobile_pairing_codes WHERE id = ?`,
        )
        .get(code.id) as { user_id: number; code_verifier: string };
      expect(codeAtRest.user_id).toBe(aliceId);
      expect(codeAtRest.code_verifier).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(codeAtRest)).not.toContain(code.pairingCode);

      const wrongHost = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: code.pairingCode,
          hostId: 'wrong-host',
          deviceName: 'Wrong-host iPhone',
        }),
      });
      expect(wrongHost.status).toBe(403);

      const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: code.pairingCode,
          hostId: code.hostId,
          userId: bobId,
          deviceName: 'Live Test iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const first = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
        userId: number;
      };
      expect(first.userId).toBe(aliceId);
      const firstAtRest = db
        .prepare('SELECT token_verifier FROM mobile_devices WHERE id = ?')
        .get(first.deviceId) as { token_verifier: string };
      expect(firstAtRest.token_verifier).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(firstAtRest)).not.toContain(first.deviceToken);
      const listed = await fetch(`${baseUrl}/mobile-gateway/devices?userId=${bobId}`, {
        headers: bearer(aliceToken),
      });
      expect(listed.status).toBe(200);
      const listedDevices = (await listed.json()) as Array<Record<string, unknown>>;
      expect(listedDevices).toEqual([
        expect.objectContaining({ id: first.deviceId, userId: aliceId }),
      ]);
      expect(JSON.stringify(listedDevices)).not.toMatch(
        new RegExp(`${first.deviceToken}|tokenVerifier`),
      );

      const replay = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: code.pairingCode,
          hostId: code.hostId,
          deviceName: 'Replay iPhone',
        }),
      });
      expect(replay.status).toBe(409);

      const expiringCodeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
        method: 'POST',
        headers: bearer(aliceToken),
        body: JSON.stringify({}),
      });
      const expiringCode = (await expiringCodeResponse.json()) as {
        id: string;
        pairingCode: string;
        hostId: string;
      };
      db.prepare(
        `UPDATE mobile_pairing_codes
         SET expires_at = '2000-01-01T00:00:00.000Z'
         WHERE id = ?`,
      ).run(expiringCode.id);
      const expired = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: expiringCode.pairingCode,
          hostId: expiringCode.hostId,
          deviceName: 'Expired iPhone',
        }),
      });
      expect(expired.status).toBe(401);

      const replacementCodeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: bearer(aliceToken),
          body: JSON.stringify({}),
        },
      );
      const replacementCode = (await replacementCodeResponse.json()) as {
        pairingCode: string;
        hostId: string;
      };
      const replacementResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: replacementCode.pairingCode,
          hostId: replacementCode.hostId,
          deviceName: 'Replacement iPhone',
        }),
      });
      expect(replacementResponse.status).toBe(201);
      const replacement = (await replacementResponse.json()) as {
        deviceId: string;
        deviceToken: string;
      };

      const oldToken = await fetch(`${baseUrl}/mobile-gateway/projects`, {
        headers: { Authorization: `Device ${first.deviceToken}` },
      });
      const activeToken = await fetch(`${baseUrl}/mobile-gateway/projects`, {
        headers: { Authorization: `Device ${replacement.deviceToken}` },
      });
      expect([oldToken.status, activeToken.status]).toEqual([200, 200]);

      const revokeOld = await fetch(
        `${baseUrl}/mobile-gateway/devices/${first.deviceId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Device ${first.deviceToken}` },
        },
      );
      expect(revokeOld.status).toBe(204);

      const revoke = await fetch(
        `${baseUrl}/mobile-gateway/devices/${replacement.deviceId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Device ${replacement.deviceToken}` },
        },
      );
      expect(revoke.status).toBe(204);
      const revokedToken = await fetch(`${baseUrl}/mobile-gateway/projects`, {
        headers: { Authorization: `Device ${replacement.deviceToken}` },
      });
      expect(revokedToken.status).toBe(401);
    } finally {
      db.prepare(
        `DELETE FROM mobile_devices
         WHERE user_id IN (
           SELECT id FROM users WHERE google_sub LIKE ?
         )`,
      ).run(`issue-1166-%-${runId}`);
      db.prepare(
        `DELETE FROM mobile_pairing_codes
         WHERE user_id IN (
           SELECT id FROM users WHERE google_sub LIKE ?
         )`,
      ).run(`issue-1166-%-${runId}`);
      db.prepare('DELETE FROM sessions WHERE token IN (?, ?)').run(aliceToken, bobToken);
      if (aliceId !== null) {
        db.prepare('DELETE FROM users WHERE id = ?').run(aliceId);
      }
      if (bobId !== null) {
        db.prepare('DELETE FROM users WHERE id = ?').run(bobId);
      }
      db.close();
    }
  });
});
