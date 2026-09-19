import { describe, expect, it } from 'vitest';

const enabled = process.env.RHYTHM_LIVE_E2E === '1' &&
  process.env.RHYTHM_LIVE_E2E_ISOLATED === '1';
const baseUrl = process.env.RHYTHM_LIVE_URL ?? '';
const isolatedLoopback = /^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl);

describe.skipIf(!enabled || !isolatedLoopback)('desktop login-only live API boundary', () => {
  it('advertises the login-only exchange and rejects a missing code through the real API', async () => {
    const health = await fetch(`${baseUrl}/opencode/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ready' });

    const capability = await fetch(`${baseUrl}/auth/google/desktop-login-capability`);
    expect(capability.status).toBe(200);
    expect(capability.headers.get('cache-control')).toContain('no-store');
    expect(await capability.json()).toEqual({ loginOnlyDesktopExchange: true });

    const invalid = await fetch(`${baseUrl}/auth/google/desktop-login-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(invalid.status).toBe(400);
  });
});
