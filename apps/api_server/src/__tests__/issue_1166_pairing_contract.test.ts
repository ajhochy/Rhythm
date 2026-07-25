import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

function bearer(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

describe('issue #1166 pairing security contract', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let alice: { id: number; token: string };
  let bob: { id: number; token: string };

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);

    const users = new UsersRepository();
    const sessions = new SessionsRepository();
    const aliceUser = users.create({
      name: 'Alice',
      email: 'issue-1166-alice@example.com',
    });
    const bobUser = users.create({
      name: 'Bob',
      email: 'issue-1166-bob@example.com',
    });
    alice = { id: aliceUser.id, token: sessions.create(aliceUser.id).token };
    bob = { id: bobUser.id, token: sessions.create(bobUser.id).token };

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
  });

  it('issue-1166-c1: server identity owns verifier-only one-time expiring pairing codes', async () => {
    const unauthenticatedRequests = [
      fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: alice.id }),
      }),
      fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: 'not-a-code',
          userId: alice.id,
          deviceName: 'Untrusted iPhone',
        }),
      }),
      fetch(`${baseUrl}/mobile-gateway/devices?userId=${alice.id}`),
      fetch(`${baseUrl}/mobile-gateway/devices/not-a-device?userId=${alice.id}`, {
        method: 'DELETE',
      }),
      fetch(`${baseUrl}/mobile-gateway/health`),
    ];
    expect((await Promise.all(unauthenticatedRequests)).map((response) => response.status))
      .toEqual([401, 401, 401, 401, 401]);

    const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
      method: 'POST',
      headers: bearer(alice.token),
      body: JSON.stringify({ userId: bob.id }),
    });
    expect(codeResponse.status).toBe(201);
    const code = (await codeResponse.json()) as {
      id: string;
      pairingCode: string;
    };
    const storedCode = db
      .prepare(
        `SELECT user_id, code_verifier, consumed_at
         FROM mobile_pairing_codes WHERE id = ?`,
      )
      .get(code.id) as {
      user_id: number;
      code_verifier: string;
      consumed_at: string | null;
    };
    expect(storedCode.user_id).toBe(alice.id);
    expect(storedCode.code_verifier).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(storedCode)).not.toContain(code.pairingCode);

    const wrongUserResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: bearer(bob.token),
      body: JSON.stringify({
        pairingCode: code.pairingCode,
        userId: alice.id,
        deviceName: 'Bob iPhone',
      }),
    });
    expect(wrongUserResponse.status).toBe(403);

    const mismatchedClaimResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: bearer(alice.token),
      body: JSON.stringify({
        pairingCode: code.pairingCode,
        userId: bob.id,
        deviceName: 'Alice iPhone',
      }),
    });
    expect(mismatchedClaimResponse.status).toBe(403);

    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: bearer(alice.token),
      body: JSON.stringify({
        pairingCode: code.pairingCode,
        deviceName: 'Alice iPhone',
      }),
    });
    expect(pairResponse.status).toBe(201);
    const paired = (await pairResponse.json()) as {
      deviceId: string;
      deviceToken: string;
    };
    expect(JSON.stringify(db.prepare('SELECT * FROM mobile_devices').all()))
      .not.toContain(paired.deviceToken);

    const replayResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: bearer(alice.token),
      body: JSON.stringify({
        pairingCode: code.pairingCode,
        userId: alice.id,
        deviceName: 'Replay iPhone',
      }),
    });
    expect(replayResponse.status).toBe(409);

    const expiringResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
      method: 'POST',
      headers: bearer(alice.token),
      body: JSON.stringify({}),
    });
    const expiringCode = (await expiringResponse.json()) as {
      id: string;
      pairingCode: string;
    };
    db.prepare(
      `UPDATE mobile_pairing_codes
       SET expires_at = '2000-01-01T00:00:00.000Z'
       WHERE id = ?`,
    ).run(expiringCode.id);
    const expiredResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST',
      headers: bearer(alice.token),
      body: JSON.stringify({
        pairingCode: expiringCode.pairingCode,
        deviceName: 'Expired iPhone',
      }),
    });
    expect(expiredResponse.status).toBe(401);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM mobile_devices').get(),
    ).toEqual({ count: 1 });
  });

  it('issue-1166-c2: device credentials are verifier-only revocable and replace the active host', async () => {
    const pairDevice = async (name: string) => {
      const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
        method: 'POST',
        headers: bearer(alice.token),
        body: JSON.stringify({}),
      });
      const code = (await codeResponse.json()) as { pairingCode: string };
      const response = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: bearer(alice.token),
        body: JSON.stringify({
          pairingCode: code.pairingCode,
          deviceName: name,
        }),
      });
      expect(response.status).toBe(201);
      return response.json() as Promise<{
        deviceId: string;
        deviceToken: string;
      }>;
    };

    const first = await pairDevice('First iPhone');
    const storedFirst = db
      .prepare('SELECT token_verifier FROM mobile_devices WHERE id = ?')
      .get(first.deviceId) as { token_verifier: string };
    expect(storedFirst.token_verifier).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(storedFirst)).not.toContain(first.deviceToken);

    const firstHealth = await fetch(`${baseUrl}/mobile-gateway/health`, {
      headers: { Authorization: `Device ${first.deviceToken}` },
    });
    expect(firstHealth.status).toBe(200);

    const missingHealth = await fetch(`${baseUrl}/mobile-gateway/health`);
    const invalidHealth = await fetch(`${baseUrl}/mobile-gateway/health`, {
      headers: { Authorization: 'Device definitely-invalid' },
    });
    expect([missingHealth.status, invalidHealth.status]).toEqual([401, 401]);

    const replacement = await pairDevice('Replacement iPhone');
    const activeRows = db
      .prepare(
        `SELECT id, revoked_at FROM mobile_devices
         WHERE user_id = ? ORDER BY created_at, id`,
      )
      .all(alice.id) as Array<{ id: string; revoked_at: string | null }>;
    expect(activeRows).toHaveLength(2);
    expect(activeRows.find((row) => row.id === first.deviceId)?.revoked_at)
      .not.toBeNull();
    expect(activeRows.filter((row) => row.revoked_at === null))
      .toEqual([expect.objectContaining({ id: replacement.deviceId })]);

    const replacedTokenHealth = await fetch(`${baseUrl}/mobile-gateway/health`, {
      headers: { Authorization: `Device ${first.deviceToken}` },
    });
    const replacementTokenHealth = await fetch(`${baseUrl}/mobile-gateway/health`, {
      headers: { Authorization: `Device ${replacement.deviceToken}` },
    });
    expect([replacedTokenHealth.status, replacementTokenHealth.status])
      .toEqual([401, 200]);

    const revokeResponse = await fetch(
      `${baseUrl}/mobile-gateway/devices/${replacement.deviceId}?userId=${bob.id}`,
      {
        method: 'DELETE',
        headers: bearer(alice.token),
      },
    );
    expect(revokeResponse.status).toBe(204);
    const revokedTokenHealth = await fetch(`${baseUrl}/mobile-gateway/health`, {
      headers: { Authorization: `Device ${replacement.deviceToken}` },
    });
    expect(revokedTokenHealth.status).toBe(401);

    const deviceCannotManage = await fetch(
      `${baseUrl}/mobile-gateway/devices?userId=${alice.id}`,
      { headers: { Authorization: `Device ${replacement.deviceToken}` } },
    );
    expect(deviceCannotManage.status).toBe(401);
  });
});
