import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const describeLive =
  process.env.RHYTHM_LIVE_E2E === '1' &&
  process.env.RHYTHM_LIVE_ISSUE_1230 === '1'
    ? describe
    : describe.skip;

describeLive('live E2E — issue #1230 immutable cloud/local identity binding', () => {
  it('pairs the Google-subject-bound local user despite a numeric Cloud/local collision', async () => {
    // Regression caught: the real gateway persists Cloud's numeric id, thereby
    // authorizing the unrelated local row that happens to share it.
    const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
    const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
    const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
    const humanCapability = process.env.RHYTHM_LIVE_HUMAN_CAPABILITY ?? '';
    const cloudPort = Number(process.env.RHYTHM_LIVE_CLOUD_PORT ?? '4199');
    const parsedUrl = new URL(baseUrl);
    if (
      parsedUrl.hostname !== '127.0.0.1' ||
      parsedUrl.port === '4001' ||
      !parsedUrl.port ||
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
      humanCapability.length < 24 ||
      !Number.isInteger(cloudPort) ||
      cloudPort < 1024
    ) {
      throw new Error('Issue #1230 requires an attested isolated sandbox');
    }

    const db = new Database(dbPath);
    const marker = randomUUID();
    const subject = `issue-1230-${marker}`;
    const email = `issue-1230-${marker}@example.com`;
    const wrongEmail = `issue-1230-wrong-${marker}@example.com`;
    const insert = db.prepare(
      `INSERT INTO users (name, email, google_sub) VALUES (?, ?, ?)`,
    );
    const wrongId = Number(
      insert.run('Numeric Collision', wrongEmail, `wrong-${subject}`).lastInsertRowid,
    );
    const boundId = Number(
      insert.run('Bound User', email, subject).lastInsertRowid,
    );
    const deviceIds: string[] = [];
    const cloud = createServer((req, res) => {
      if (
        req.url !== '/auth/me' ||
        req.headers.authorization !== 'Bearer issue-1230-cloud-token'
      ) {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          user: {
            id: wrongId,
            name: 'Bound User',
            email,
            googleSub: subject,
            photoUrl: null,
            role: 'member',
            isFacilitiesManager: false,
            emailNotificationsEnabled: true,
            timezone: 'America/Los_Angeles',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          workspace: null,
        }),
      );
    });
    await new Promise<void>((resolveListen, reject) => {
      cloud.once('error', reject);
      cloud.listen(cloudPort, '127.0.0.1', resolveListen);
    });

    try {
      const headers = {
        Authorization: 'Bearer issue-1230-cloud-token',
        'Content-Type': 'application/json',
        'X-Rhythm-Human-Approval': humanCapability,
      };
      const health = await fetch(`${baseUrl}/mobile-gateway/health`);
      const hostId = ((await health.json()) as { hostId: string }).hostId;
      const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
        method: 'POST',
        headers,
        body: '{}',
      });
      expect(codeResponse.status).toBe(201);
      const code = (await codeResponse.json()) as { pairingCode: string };
      const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode: code.pairingCode,
          hostId,
          deviceName: 'Issue 1230 iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        userId: number;
      };
      deviceIds.push(paired.deviceId);
      expect(paired.userId).toBe(boundId);
      expect(paired.userId).not.toBe(wrongId);
      expect(
        db.prepare('SELECT user_id FROM mobile_devices WHERE id = ?').get(
          paired.deviceId,
        ),
      ).toEqual({ user_id: boundId });
    } finally {
      await new Promise<void>((resolveClose) => cloud.close(() => resolveClose()));
      for (const id of deviceIds) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(id);
      }
      db.prepare('DELETE FROM mobile_pairing_codes WHERE user_id IN (?, ?)').run(
        wrongId,
        boundId,
      );
      db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(wrongId, boundId);
      db.close();
    }
  });
});
