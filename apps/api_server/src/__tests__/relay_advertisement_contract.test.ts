/**
 * Track 3 acceptance contract (Mac side) — relay URL advertisement
 * (docs/ai/contracts/relay-t3-phone-transport.md).
 *
 * When RHYTHM_RELAY_PUBLIC_URL is configured, the Mac advertises it in the
 * pairing response and the gateway health body so phones adopt the relay
 * without re-pairing. When unset, neither body contains the field.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const RELAY_BASE = 'https://api.vcrcapps.com/relay';

async function makeMacApp(relayPublicUrl: string | null): Promise<{
  baseUrl: string;
  bearer: string;
  humanCapabilityHeader: Record<string, string>;
  close: () => Promise<void>;
}> {
  vi.resetModules();
  vi.stubEnv('RHYTHM_ROLE', 'all');
  vi.stubEnv('AGENT_LOCAL', 'true');
  vi.stubEnv('RHYTHM_RELAY_PUBLIC_URL', relayPublicUrl ?? '');

  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  const { installHumanApprovalTestCredentials } = await import(
    './helpers/human_approval_test_credentials'
  );
  const humanCapabilityHeader =
    installHumanApprovalTestCredentials().capabilityHeader;

  const { UsersRepository } = await import('../repositories/users_repository');
  const { SessionsRepository } = await import(
    '../repositories/sessions_repository'
  );
  const user = new UsersRepository().create({
    name: 'Advertiser',
    email: `ad-${randomUUID()}@example.com`,
  });
  const session = new SessionsRepository().create(user.id);

  const { createApp } = await import('../app');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    bearer: session.token,
    humanCapabilityHeader,
    close: async () => {
      await new Promise<void>((res, rej) =>
        server.close((e) => (e ? rej(e) : res())),
      );
      db.close();
      vi.unstubAllEnvs();
      vi.resetModules();
    },
  };
}

async function pair(app: Awaited<ReturnType<typeof makeMacApp>>) {
  const codeResponse = await fetch(`${app.baseUrl}/mobile-gateway/pairing-codes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${app.bearer}`,
      'Content-Type': 'application/json',
      ...app.humanCapabilityHeader,
    },
    body: '{}',
  });
  expect(codeResponse.status).toBe(201);
  const code = (await codeResponse.json()) as {
    pairingCode: string;
    hostId: string;
  };
  const pairResponse = await fetch(`${app.baseUrl}/mobile-gateway/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pairingCode: code.pairingCode,
      hostId: code.hostId,
      deviceName: 'Ad iPhone',
    }),
  });
  expect(pairResponse.status).toBe(201);
  return (await pairResponse.json()) as Record<string, unknown>;
}

describe('Track 3 contract — relay URL advertisement', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (close) await close();
    close = undefined;
  });

  it('env.relayPublicUrl parses from RHYTHM_RELAY_PUBLIC_URL (null when unset)', async () => {
    vi.resetModules();
    vi.stubEnv('RHYTHM_RELAY_PUBLIC_URL', ` ${RELAY_BASE} `);
    const { env } = await import('../config/env');
    expect(env.relayPublicUrl).toBe(RELAY_BASE);

    vi.resetModules();
    vi.stubEnv('RHYTHM_RELAY_PUBLIC_URL', '');
    const { env: unset } = await import('../config/env');
    expect(unset.relayPublicUrl).toBeNull();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('advertises relayUrl in the pairing-code, pair, and health responses when configured', async () => {
    const app = await makeMacApp(RELAY_BASE);
    close = app.close;

    // The pairing-code response is what the desktop QR is built from — it must
    // carry relayUrl so a scanned QR pairs over the relay, not Tailscale.
    const codeResponse = await fetch(
      `${app.baseUrl}/mobile-gateway/pairing-codes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${app.bearer}`,
          'Content-Type': 'application/json',
          ...app.humanCapabilityHeader,
        },
        body: '{}',
      },
    );
    expect(codeResponse.status).toBe(201);
    expect(
      ((await codeResponse.json()) as Record<string, unknown>).relayUrl,
    ).toBe(RELAY_BASE);

    const pairBody = await pair(app);
    expect(pairBody.relayUrl).toBe(RELAY_BASE);
    expect(typeof pairBody.deviceToken).toBe('string');

    const health = await fetch(`${app.baseUrl}/mobile-gateway/health`);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as Record<string, unknown>;
    expect(healthBody.relayUrl).toBe(RELAY_BASE);
  });

  it('omits relayUrl entirely when not configured', async () => {
    const app = await makeMacApp(null);
    close = app.close;

    const codeResponse = await fetch(
      `${app.baseUrl}/mobile-gateway/pairing-codes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${app.bearer}`,
          'Content-Type': 'application/json',
          ...app.humanCapabilityHeader,
        },
        body: '{}',
      },
    );
    expect('relayUrl' in ((await codeResponse.json()) as object)).toBe(false);

    const pairBody = await pair(app);
    expect('relayUrl' in pairBody).toBe(false);

    const health = await fetch(`${app.baseUrl}/mobile-gateway/health`);
    const healthBody = (await health.json()) as Record<string, unknown>;
    expect('relayUrl' in healthBody).toBe(false);
  });
});
