import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const mobileGatewayUrl = (
  process.env.RHYTHM_LIVE_MOBILE_GATEWAY_URL ?? ''
).replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const expectedPort = process.env.RHYTHM_SANDBOX_API_PORT ?? '';
const expectedMobilePort = process.env.RHYTHM_MOBILE_GATEWAY_PORT ?? '';

function bearer(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

describeLive('live E2E — issue #1171 desktop-to-iPhone mobile access', () => {
  it('drives diagnostics, one-time QR exchange, device health, and revocation through the sandbox API', async () => {
    if (
      !/^\d{4,5}$/.test(expectedPort) ||
      ['4001', '4096', '4097', '4098'].includes(expectedPort) ||
      baseUrl !== `http://127.0.0.1:${expectedPort}`
    ) {
      throw new Error(
        'RHYTHM_LIVE_URL must use the declared isolated alternate sandbox API port',
      );
    }
    if (
      !/^\d{4,5}$/.test(expectedMobilePort) ||
      ['4001', '4002', '4096', '4097', '4098'].includes(expectedMobilePort) ||
      mobileGatewayUrl !== `http://127.0.0.1:${expectedMobilePort}`
    ) {
      throw new Error(
        'RHYTHM_LIVE_MOBILE_GATEWAY_URL must use the declared isolated mobile gateway port',
      );
    }
    if (process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' || !dbPath.startsWith('/')) {
      throw new Error(
        'Live mobile-access test requires an attested isolated absolute DB path',
      );
    }
    if (dbPath.includes('/Library/Application Support/Rhythm/')) {
      throw new Error('Live mobile-access test refuses the installed app database');
    }

    const db = new Database(dbPath);
    const runId = randomUUID();
    const sessionToken = randomUUID();
    let userId: number | null = null;
    let pairingCodeId: string | null = null;
    let deviceId: string | null = null;
    try {
      userId = Number(
        db
          .prepare(
            `INSERT INTO users (name, email, google_sub)
             VALUES (?, ?, ?)`,
          )
          .run(
            'Issue 1171 Mobile User',
            `issue-1171-${runId}@example.com`,
            `issue-1171-${runId}`,
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

      const unauthenticatedAccess = await fetch(`${baseUrl}/mobile-gateway/access`);
      expect(unauthenticatedAccess.status).toBe(401);

      const accessResponse = await fetch(`${baseUrl}/mobile-gateway/access`, {
        headers: bearer(sessionToken),
      });
      expect(accessResponse.status).toBe(200);
      const access = (await accessResponse.json()) as {
        state: string;
        gatewayUrl?: string;
        message: string;
        canConfigure: boolean;
      };
      expect(['missing', 'loggedOut', 'wrongTarget', 'healthy']).toContain(
        access.state,
      );
      expect(typeof access.message).toBe('string');
      expect(typeof access.canConfigure).toBe('boolean');
      expect(JSON.stringify(access)).not.toContain(sessionToken);
      if (access.state === 'healthy') {
        expect(access.gatewayUrl).toMatch(/^https:\/\/[a-z0-9.-]+\.ts\.net$/);
      }

      const preflight = await fetch(`${mobileGatewayUrl}/mobile-gateway/health`, {
        headers: bearer(sessionToken),
      });
      expect(preflight.status).toBe(200);
      const compatibility = (await preflight.json()) as {
        status: string;
        features: string[];
      };
      expect(compatibility.status).toBe('ready');
      expect(compatibility.features).toEqual(
        expect.arrayContaining([
          'pairing',
          'device-revocation',
          'project-scope',
          'opencode-http-proxy',
        ]),
      );

      const codeResponse = await fetch(
        `${baseUrl}/mobile-gateway/pairing-codes`,
        {
          method: 'POST',
          headers: bearer(sessionToken),
          body: JSON.stringify({}),
        },
      );
      expect(codeResponse.status).toBe(201);
      const code = (await codeResponse.json()) as {
        id: string;
        pairingCode: string;
        expiresAt: string;
      };
      pairingCodeId = code.id;
      expect(code.pairingCode).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
      expect(new Date(code.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const qrPayload = {
        gatewayUrl:
          access.gatewayUrl ?? 'https://sandbox-device.test-tailnet.ts.net',
        pairingCode: code.pairingCode,
      };
      expect(Object.keys(qrPayload).sort()).toEqual([
        'gatewayUrl',
        'pairingCode',
      ]);
      expect(JSON.stringify(qrPayload)).not.toMatch(
        /deviceToken|sessionToken|userId|hostId/,
      );

      const pairResponse = await fetch(`${mobileGatewayUrl}/mobile-gateway/pair`, {
        method: 'POST',
        headers: bearer(sessionToken),
        body: JSON.stringify({
          pairingCode: code.pairingCode,
          userId,
          deviceName: 'Issue 1171 Sandbox iPhone',
        }),
      });
      expect(pairResponse.status).toBe(201);
      const paired = (await pairResponse.json()) as {
        deviceId: string;
        deviceToken: string;
        features: string[];
      };
      deviceId = paired.deviceId;
      expect(paired.deviceToken.length).toBeGreaterThanOrEqual(32);
      expect(paired.features).toEqual(expect.arrayContaining(compatibility.features));

      const codeAtRest = db
        .prepare(
          'SELECT code_verifier, consumed_at FROM mobile_pairing_codes WHERE id = ?',
        )
        .get(code.id) as { code_verifier: string; consumed_at: string };
      expect(codeAtRest.code_verifier).toMatch(/^[a-f0-9]{64}$/);
      expect(codeAtRest.consumed_at).toBeTruthy();
      expect(JSON.stringify(codeAtRest)).not.toContain(code.pairingCode);

      const deviceAtRest = db
        .prepare('SELECT token_verifier FROM mobile_devices WHERE id = ?')
        .get(paired.deviceId) as { token_verifier: string };
      expect(deviceAtRest.token_verifier).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(deviceAtRest)).not.toContain(paired.deviceToken);

      const connected = await fetch(`${mobileGatewayUrl}/mobile-gateway/health`, {
        headers: { Authorization: `Device ${paired.deviceToken}` },
      });
      expect(connected.status).toBe(200);
      expect(await connected.json()).toEqual(
        expect.objectContaining({ status: 'ready' }),
      );

      const revoke = await fetch(
        `${mobileGatewayUrl}/mobile-gateway/devices/${paired.deviceId}`,
        {
          method: 'DELETE',
          headers: bearer(sessionToken),
        },
      );
      expect(revoke.status).toBe(204);
      const revoked = await fetch(`${mobileGatewayUrl}/mobile-gateway/health`, {
        headers: { Authorization: `Device ${paired.deviceToken}` },
      });
      expect(revoked.status).toBe(401);

      for (const [method, privatePath] of [
        ['POST', '/mobile-gateway/pairing-codes'],
        ['GET', '/mobile-gateway/devices'],
        ['GET', '/mobile-gateway/access'],
        ['POST', '/mobile-gateway/access/enable'],
      ] as const) {
        const hidden = await fetch(`${mobileGatewayUrl}${privatePath}`, {
          method,
          headers: bearer(sessionToken),
        });
        expect(hidden.status, `${method} ${privatePath}`).toBe(404);
      }

      for (const legacyPath of [
        '/health',
        '/auth/me',
        '/agent-configs',
        '/agent-sessions',
        '/opencode/auth/status',
        '/system/refresh',
      ]) {
        const hidden = await fetch(`${mobileGatewayUrl}${legacyPath}`);
        expect(hidden.status, legacyPath).toBe(404);
      }
    } finally {
      if (deviceId) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      }
      if (pairingCodeId) {
        db.prepare('DELETE FROM mobile_pairing_codes WHERE id = ?').run(
          pairingCodeId,
        );
      }
      db.prepare('DELETE FROM sessions WHERE token = ?').run(sessionToken);
      if (userId !== null) {
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      }
      db.close();
    }
  });
});
