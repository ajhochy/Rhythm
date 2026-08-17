import { expect, test, type Page, type Route } from '@playwright/test';

// post-m1-p9-c1b/c1c/c1e (live half): the same Mobile Access surface, driven entirely through
// Playwright page.route interception of the live gateway's network calls — no product test-hook,
// no VITE_RHYTHM_LIVE_TOKEN. This mirrors apps/web/tests/post-m1-phase-8-live-artifacts.redspec.ts's
// installAuthenticatedHost + page.route pattern: a fake `window.rhythmShell.auth.signInWithGoogle`
// stands in for the Electron preload bridge, and every request to the api/engine loopback origins
// is answered by this test rather than a running server.

const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4181',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-rhythm-human-approval',
};

async function json(route: Route, status: number, value: unknown) {
  await route.fulfill({ status, headers: cors, json: value });
}

async function installAuthenticatedHost(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'rhythmShell', {
      configurable: true,
      value: Object.freeze({
        version: 9,
        gateway: Object.freeze({ apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097' }),
        auth: Object.freeze({
          signInWithGoogle: async () => ({
            sessionToken: 'phase-9-owner-token',
            user: { id: 91, name: 'Avery Owner', email: 'avery@example.test', role: 'admin', artifactTabIds: [] },
          }),
        }),
      }),
    });
  });
}

test('post-m1-p9-c1b/c1c/c1e (live): Mobile Access diagnoses, enables, offers pairing (gatewayUrl+pairingCode+relayUrl), detects consumption, and administers devices via /mobile-gateway/*', async ({ page }) => {
  let servePayload = {
    state: 'wrongTarget',
    gatewayUrl: 'https://ajh-mac.tailnetxyz.ts.net',
    message: 'Mobile access is not configured for Rhythm.',
    canConfigure: true,
  };
  const devices: Array<{ id: string; hostId: string; userId: number; name: string; revokedAt: string | null; createdAt: string }> = [
    { id: 'device-1', hostId: 'host-abc', userId: 91, name: "AJ's iPhone", revokedAt: null, createdAt: '2026-08-01T00:00:00.000Z' },
  ];
  let pairingCounter = 0;
  const receipts: string[] = [];

  await installAuthenticatedHost(page);
  await page.route('http://127.0.0.1:4097/**', (route) => json(route, 200, { healthy: true }));
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    if (url.pathname === '/health') return json(route, 200, { healthy: true });

    if (url.pathname === '/mobile-gateway/access' && request.method() === 'GET') {
      receipts.push('GET /mobile-gateway/access');
      return json(route, 200, servePayload);
    }
    if (url.pathname === '/mobile-gateway/access/enable' && request.method() === 'POST') {
      receipts.push('POST /mobile-gateway/access/enable');
      servePayload = { state: 'healthy', gatewayUrl: servePayload.gatewayUrl, message: 'Mobile access is available on your private tailnet.', canConfigure: false };
      return json(route, 200, servePayload);
    }
    if (url.pathname === '/mobile-gateway/pairing-codes' && request.method() === 'POST') {
      pairingCounter += 1;
      receipts.push('POST /mobile-gateway/pairing-codes');
      return json(route, 201, {
        id: `offer-${pairingCounter}`,
        hostId: 'host-abc',
        pairingCode: `code-${pairingCounter}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        relayUrl: 'https://relay.example.com',
      });
    }
    if (url.pathname === '/mobile-gateway/devices' && request.method() === 'GET') {
      receipts.push('GET /mobile-gateway/devices');
      return json(route, 200, devices);
    }
    const revokeMatch = url.pathname.match(/^\/mobile-gateway\/devices\/(.+)$/);
    if (revokeMatch && request.method() === 'DELETE') {
      receipts.push(`DELETE /mobile-gateway/devices/${revokeMatch[1]}`);
      const device = devices.find((item) => item.id === revokeMatch[1]);
      if (!device) return json(route, 404, { error: { code: 'NOT_FOUND', message: 'Mobile device not found' } });
      device.revokedAt = new Date().toISOString();
      return route.fulfill({ status: 204, headers: cors });
    }
    return json(route, 404, { error: { code: 'NOT_FOUND' } });
  });

  await page.goto('/#/mobile-access');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByTestId('page-mobile-access')).toBeVisible();

  // Canonical wire state, never a display string.
  await expect(page.getByTestId('mobile-access-diagnostic')).toHaveAttribute('data-access-state', 'wrongTarget');
  await expect(page.getByTestId('mobile-access-enable')).toBeVisible();
  await page.getByTestId('mobile-access-enable').click();
  await expect(page.getByTestId('mobile-access-diagnostic')).toHaveAttribute('data-access-state', 'healthy');

  await page.getByTestId('mobile-access-generate-pairing').click();
  const payload = JSON.parse(await page.getByTestId('mobile-access-pairing-payload').textContent() ?? '{}');
  expect(payload).toEqual({ gatewayUrl: servePayload.gatewayUrl, pairingCode: 'code-1', relayUrl: 'https://relay.example.com' });

  // Simulate the phone consuming the code: a device the desktop didn't create appears server-side.
  devices.push({ id: 'device-2', hostId: 'host-abc', userId: 91, name: 'New phone', revokedAt: null, createdAt: new Date().toISOString() });
  await expect(page.getByTestId('mobile-access-pairing-consumed')).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId('mobile-access-pairing-offer')).toHaveCount(0);
  await expect(page.getByTestId('mobile-access-device-device-2')).toBeVisible();

  await page.getByTestId('mobile-access-device-revoke-device-1').click();
  await expect(page.getByTestId('mobile-access-device-revoked-device-1')).toBeVisible();

  expect(receipts).toContain('GET /mobile-gateway/access');
  expect(receipts).toContain('POST /mobile-gateway/access/enable');
  expect(receipts).toContain('POST /mobile-gateway/pairing-codes');
  expect(receipts).toContain('DELETE /mobile-gateway/devices/device-1');
});
