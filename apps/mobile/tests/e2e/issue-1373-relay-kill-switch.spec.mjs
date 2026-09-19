import { expect, test } from '@playwright/test';

// Run with EXPO_PUBLIC_RHYTHM_RELAY_DISABLED=1 so Playwright's web build
// embeds the switch. The default relay-enabled suite remains unchanged.
test('issue-1373: disabled relay keeps direct pairing usable in Settings', async ({ page, request }) => {
  test.skip(process.env.EXPO_PUBLIC_RHYTHM_RELAY_DISABLED !== '1', 'Requires a relay-disabled build');
  const fakeBase = `http://127.0.0.1:${process.env.PLAYWRIGHT_FAKE_PORT ?? '44096'}`;
  expect((await request.post(`${fakeBase}/__control/reset`, {
    data: { scenario: 'happy-path' },
  })).ok()).toBe(true);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Pair a Mac', exact: true }).click();
  await page.getByLabel('Pairing payload').fill(JSON.stringify({
    gatewayUrl: 'https://rhythm-mac.tail1234.ts.net',
    relayUrl: 'https://api.vcrcapps.com/relay',
    pairingCode: 'a'.repeat(43),
  }));
  await page.getByRole('button', { name: 'Pair securely' }).click();
  await expect(page.getByLabel('Paired Mac status: Connected').last()).toBeVisible();
  await expect(page.getByText('Secure Mac connection', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Refresh paired Mac status' }).click();
  await expect(page.getByLabel('Paired Mac status: Connected').last()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('e2e-device-token');
  const audit = await (await request.get(`${fakeBase}/__control/mobile`)).json();
  expect(audit.devices).toEqual([
    expect.objectContaining({ gatewayHost: 'rhythm-mac.tail1234.ts.net', revoked: false }),
  ]);
  expect(audit.events.filter((event) => event.path === '/mobile-gateway/pair')).toHaveLength(1);
  expect(audit.events.every((event) => event.transportHost === 'rhythm-mac.tail1234.ts.net')).toBe(true);
});
