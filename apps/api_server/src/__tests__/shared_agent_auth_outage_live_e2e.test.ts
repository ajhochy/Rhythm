/**
 * Real sandbox API/engine gate for the shared-agent registrar's unavailable
 * Cloud identity path. Requires the sandbox's owned synthetic bridge fixture
 * and a separate loopback /auth/me service that drops the connection.
 */
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_SHARED_AGENTS_AUTH_OUTAGE_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;
const localToken = 'e02-synthetic-session-not-a-secret';

function guardedFixture(): { api: string; upstream: string; registrar: string } {
  const api = process.env.RHYTHM_LIVE_URL ?? '';
  const upstream = process.env.RHYTHM_SANDBOX_AUTH_FIXTURE_URL ?? '';
  const apiPort = process.env.RHYTHM_SANDBOX_API_PORT ?? '';
  const urlPattern = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})$/;
  const apiMatch = urlPattern.exec(api);
  const upstreamMatch = urlPattern.exec(upstream);
  if (!apiMatch || !upstreamMatch || apiMatch[1] !== apiPort ||
      apiMatch[1] === upstreamMatch[1] ||
      [apiMatch[1], upstreamMatch[1]].some((port) => ['4001', '4002', '4096'].includes(port))) {
    throw new Error('live gate requires distinct, explicit loopback sandbox and auth fixture ports');
  }

  const sourceRoot = realpathSync(process.env.RHYTHM_APPROVED_FIXTURE_ROOT ?? '');
  const registrarPath = realpathSync(process.env.RHYTHM_SANDBOX_BRIDGE_REGISTRAR_FILE ?? '');
  if (!sourceRoot.startsWith(`/private/tmp${sep}`) ||
      !registrarPath.startsWith(`${sourceRoot}${sep}`)) {
    throw new Error('live gate requires an owned private synthetic registrar reference');
  }
  const sourceInfo = lstatSync(sourceRoot);
  const registrarInfo = lstatSync(registrarPath);
  if (!sourceInfo.isDirectory() || !registrarInfo.isFile() ||
      sourceInfo.uid !== process.getuid?.() || registrarInfo.uid !== process.getuid?.() ||
      (sourceInfo.mode & 0o022) !== 0 || (registrarInfo.mode & 0o777) !== 0o600 ||
      registrarInfo.size > 128) {
    throw new Error('live gate requires owned, protected synthetic fixture files');
  }
  const registrar = readFileSync(registrarPath, 'utf8').trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(registrar)) {
    throw new Error('live gate requires a generated synthetic registrar');
  }
  return { api, upstream, registrar };
}

describeLive('shared-agent registrar Cloud authentication outage through real sandbox', () => {
  it('returns bounded 503 without a grant while retaining an existing local grant', async () => {
    const { api, upstream, registrar } = guardedFixture();
    const syntheticOwner = await fetch(`${api}/auth/me`, {
      headers: { Authorization: `Bearer ${localToken}` }, signal: AbortSignal.timeout(5_000),
    });
    expect(syntheticOwner.status).toBe(200);
    expect((await syntheticOwner.json() as { user: { email: string } }).user.email).toBe('admin@example.invalid');
    const authFixtureStatus = async () => {
      const response = await fetch(`${upstream}/fixture/status`, { signal: AbortSignal.timeout(5_000) });
      expect(response.status).toBe(200);
      const status = await response.json() as { mode: string; authRequests: number };
      expect(status.mode).toBe('connection-reset');
      return status.authRequests;
    };
    const authRequestsBefore = await authFixtureStatus();

    const headers = { 'Content-Type': 'application/json', 'X-Rhythm-Bridge-Registrar': registrar };
    const grantId = randomUUID();
    const validCapability = `synthetic-live-valid-${randomUUID()}`;
    const rejectedCapability = `synthetic-live-rejected-${randomUUID()}`;
    const register = (capability: string, sessionToken: string) => fetch(`${api}/agent-bridge/v1/registrar/grants`, {
      method: 'POST', headers, signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({
        grantId: capability === validCapability ? grantId : randomUUID(),
        capabilitySha256: createHash('sha256').update(capability).digest('hex'),
        sessionToken, hermesProfile: 'default', runtimeGeneration: randomUUID(),
        serverOrigin: api, authGeneration: 'synthetic-auth-outage-live', scopes: ['catalog.read'],
      }),
    });
    try {
      const accepted = await register(validCapability, localToken);
      expect(accepted.status).toBe(201);

      const unavailable = await register(rejectedCapability, 'synthetic-unresolved-not-a-session');
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toMatchObject({ error: { code: 'bridge_unavailable' } });
      expect(await authFixtureStatus()).toBe(authRequestsBefore + 1);

      const catalog = (capability: string) => fetch(`${api}/agent-bridge/v1/catalog`, {
        headers: { 'X-Rhythm-Bridge-Capability': capability }, signal: AbortSignal.timeout(5_000),
      });
      const rejected = await catalog(rejectedCapability);
      expect(rejected.status).toBe(401);
      expect(await rejected.json()).toMatchObject({ error: { code: 'bridge_capability_unknown' } });
      expect((await catalog(validCapability)).status).toBe(200);
    } finally {
      const revoked = await fetch(`${api}/agent-bridge/v1/registrar/grants/${grantId}`, {
        method: 'DELETE', headers: { 'X-Rhythm-Bridge-Registrar': registrar },
        signal: AbortSignal.timeout(5_000),
      });
      expect(revoked.status).toBe(204);
    }
  }, 25_000);
});
