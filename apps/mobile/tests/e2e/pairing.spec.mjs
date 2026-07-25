import { expect, test } from '@playwright/test';

const fakeBaseUrl =
  `http://127.0.0.1:${process.env.PLAYWRIGHT_FAKE_PORT ?? '44096'}`;

async function resetMobile(request) {
  const response = await request.post(
    `${fakeBaseUrl}/__control/reset`,
    { data: { scenario: 'happy-path' } },
  );
  expect(response.ok()).toBeTruthy();
}

async function openPairingFromSettings(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByText('Paired Mac', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pair a Mac' }).click();
  await expect(page.getByRole('heading', { name: 'Pair a Mac' })).toBeVisible();
}

async function scanTestQr(page) {
  await page.getByRole('button', { name: 'Scan test QR code' }).click();
}

test.beforeEach(async ({ request }) => {
  await resetMobile(request);
});

test('scanner pairing and Settings revocation work without exposing credentials', async ({
  page,
  request,
}) => {
  await openPairingFromSettings(page);
  await scanTestQr(page);

  await expect(page.getByLabel('Paired Mac status: Connected').last()).toBeVisible();
  await expect(page.getByText('rhythm-mac.tail1234.ts.net').last()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('e2e-device-token');
  await expect(page.locator('body')).not.toContainText('a'.repeat(43));

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Revoke this iPhone from the paired Mac' }).click();
  await expect(page.getByLabel('Paired Mac status: Not paired').last()).toBeVisible();

  const audit = await request.get(`${fakeBaseUrl}/__control/mobile`);
  const body = await audit.json();
  expect(body.devices).toEqual([
    expect.objectContaining({ gatewayHost: 'rhythm-mac.tail1234.ts.net', revoked: true }),
  ]);
});

test('confirmed replacement revokes the old Mac before committing the new one', async ({
  page,
  request,
}) => {
  await openPairingFromSettings(page);
  await scanTestQr(page);
  await expect(page.getByLabel('Paired Mac status: Connected').last()).toBeVisible();

  await page.getByRole('button', { name: 'Pair a different Mac' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await scanTestQr(page);
  await expect(page.getByText('other-mac.tail1234.ts.net').last()).toBeVisible();

  const audit = await request.get(`${fakeBaseUrl}/__control/mobile`);
  const body = await audit.json();
  const oldDelete = body.events.findIndex(
    (event) =>
      event.method === 'DELETE' &&
      event.gatewayHost === 'rhythm-mac.tail1234.ts.net',
  );
  expect(oldDelete).toBeGreaterThan(-1);
  expect(body.devices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ gatewayHost: 'rhythm-mac.tail1234.ts.net', revoked: true }),
      expect.objectContaining({ gatewayHost: 'other-mac.tail1234.ts.net', revoked: false }),
    ]),
  );
});

test('failed old-Mac revocation rolls back the new credential and remains usable', async ({
  page,
  request,
}) => {
  await openPairingFromSettings(page);
  await scanTestQr(page);
  await expect(page.getByLabel('Paired Mac status: Connected').last()).toBeVisible();
  await request.post(`${fakeBaseUrl}/__control/mobile-revoke-failure`, {
    data: { enabled: true },
  });

  await page.getByRole('button', { name: 'Pair a different Mac' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await scanTestQr(page);
  await expect(page.getByText(/previous Mac could not be revoked/).last()).toBeVisible();

  await page.getByLabel('Close pairing').click();
  await page.getByRole('button', { name: 'Refresh paired Mac status' }).click();
  await expect(page.getByLabel('Paired Mac status: Connected').last()).toBeVisible();
  await expect(page.getByText('rhythm-mac.tail1234.ts.net').last()).toBeVisible();

  const audit = await request.get(`${fakeBaseUrl}/__control/mobile`);
  const body = await audit.json();
  expect(body.devices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ gatewayHost: 'rhythm-mac.tail1234.ts.net', revoked: false }),
      expect.objectContaining({ gatewayHost: 'other-mac.tail1234.ts.net', revoked: true }),
    ]),
  );
});

test('revoke failure remains visible and retryable without an unhandled rejection', async ({
  page,
  request,
}) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPairingFromSettings(page);
  await scanTestQr(page);
  await expect(page.getByLabel('Paired Mac status: Connected').last()).toBeVisible();
  await request.post(`${fakeBaseUrl}/__control/mobile-revoke-failure`, {
    data: { enabled: true },
  });

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Revoke this iPhone from the paired Mac' }).click();
  await expect(
    page.getByLabel('Paired Mac status: Tailscale unavailable').last(),
  ).toBeVisible();
  await expect(page.getByText(/not revoked.*still active/i).last()).toBeVisible();
  expect(pageErrors).toEqual([]);

  const audit = await request.get(`${fakeBaseUrl}/__control/mobile`);
  const body = await audit.json();
  expect(body.devices).toEqual([
    expect.objectContaining({ gatewayHost: 'rhythm-mac.tail1234.ts.net', revoked: false }),
  ]);
});

test('forget failure remains visible and retryable without an unhandled rejection', async ({
  page,
  request,
}) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openPairingFromSettings(page);
  await scanTestQr(page);
  await expect(page.getByLabel('Paired Mac status: Connected').last()).toBeVisible();
  await request.post(`${fakeBaseUrl}/__control/mobile-storage-failure`, {
    data: { enabled: true },
  });

  await page.getByRole('button', { name: 'Forget the paired Mac on this iPhone' }).click();
  await expect(page.getByLabel('Paired Mac status: Mac unhealthy').last()).toBeVisible();
  await expect(page.getByText(/credential remains.*retry/i).last()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('pairing remains reachable at a small phone viewport with enlarged text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPairingFromSettings(page);
  const heading = page.getByText('Scan the code from Rhythm on your Mac', {
    exact: true,
  });
  const beforeFontSize = Number.parseFloat(
    await heading.evaluate((element) => getComputedStyle(element).fontSize),
  );
  await heading.evaluate((element) => {
    element.style.setProperty('font-size', '36px', 'important');
    element.style.setProperty('line-height', '48px', 'important');
  });
  const afterFontSize = Number.parseFloat(
    await heading.evaluate((element) => getComputedStyle(element).fontSize),
  );
  expect(afterFontSize).toBeGreaterThan(beforeFontSize);
  await expect(page.getByRole('button', { name: 'Scan test QR code' })).toBeVisible();
  await scanTestQr(page);
  await expect(page.getByLabel('Paired Mac status: Connected').last()).toBeVisible();
});
