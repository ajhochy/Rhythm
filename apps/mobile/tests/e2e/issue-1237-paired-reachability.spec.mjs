import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fakePort =
  process.env.RHYTHM_MOBILE_E2E_FAKE_PORT ??
  process.env.PLAYWRIGHT_FAKE_PORT ??
  '44096';
const fakeServer = `http://127.0.0.1:${fakePort}`;
const boundedOfflineTimeoutMs = 12_000;
const proofUiDir = fileURLToPath(
  new URL('../../../../.proof/i1237/ui/', import.meta.url),
);

async function setReachability(request, mode) {
  const response = await request.post(
    `${fakeServer}/__control/mobile-reachability`,
    { data: { mode } },
  );
  expect(response.ok()).toBeTruthy();
}

async function pairTestMac(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('tab', { name: /Settings$/ })
    .locator('visible=true')
    .click();
  await page
    .getByRole('button', { name: 'Pair a Mac', exact: true })
    .locator('visible=true')
    .click();
  await page
    .getByRole('button', { name: 'Scan test QR code', exact: true })
    .locator('visible=true')
    .click();
  await expect(
    page
      .getByLabel('Paired Mac status: Connected', { exact: true })
      .locator('visible=true'),
  ).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ request }) => {
  await mkdir(proofUiDir, { recursive: true });
  const response = await request.post(`${fakeServer}/__control/reset`, {
    data: { scenario: 'happy-path' },
  });
  expect(response.ok()).toBeTruthy();
});

test('issue-1237-c1: Settings and Agents converge on one paired-Mac reachability state', async ({
  page,
  request,
}) => {
  await pairTestMac(page);
  await setReachability(request, 'error');

  const settingsOffline = page
    .getByLabel('Paired Mac status: Tailscale unavailable', { exact: true })
    .locator('visible=true');
  await expect(settingsOffline).toBeVisible({
    timeout: boundedOfflineTimeoutMs,
  });

  await page
    .getByRole('tab', { name: /Agents$/ })
    .locator('visible=true')
    .click();
  await expect(
    page.getByTestId('paired-mac-offline-state').locator('visible=true'),
  ).toBeVisible();
  await expect(
    page.getByText(/Tailscale cannot reach the paired Mac/i).locator('visible=true').first(),
  ).toBeVisible();
  await page.screenshot({
    path: `${proofUiDir}/offline.png`,
    fullPage: true,
  });

  await setReachability(request, 'online');
  const createChat = page
    .getByRole('button', { name: 'Create chat', exact: true })
    .locator('visible=true');
  await expect(createChat).toBeEnabled({ timeout: boundedOfflineTimeoutMs });
  await page
    .getByRole('tab', { name: /Settings$/ })
    .locator('visible=true')
    .click();
  await expect(
    page
      .getByLabel('Paired Mac status: Connected', { exact: true })
      .locator('visible=true'),
  ).toBeVisible({ timeout: boundedOfflineTimeoutMs });
  await page
    .getByRole('tab', { name: /Agents$/ })
    .locator('visible=true')
    .click();
  await expect(createChat).toBeEnabled({ timeout: boundedOfflineTimeoutMs });
});

test('issue-1237-c2: paired Mac reachability loss becomes offline within the bounded timeout', async ({
  page,
  request,
}) => {
  await pairTestMac(page);
  const startedAt = Date.now();
  await setReachability(request, 'timeout');

  await expect(
    page
      .getByLabel('Paired Mac status: Tailscale unavailable', { exact: true })
      .locator('visible=true'),
  ).toBeVisible({ timeout: boundedOfflineTimeoutMs });
  expect(Date.now() - startedAt).toBeLessThanOrEqual(
    boundedOfflineTimeoutMs,
  );
});

test('issue-1237-c3: session loading exits to an offline state', async ({
  page,
  request,
}) => {
  await pairTestMac(page);
  await page
    .getByRole('tab', { name: /Agents$/ })
    .locator('visible=true')
    .click();
  await page
    .getByRole('button', { name: 'Create chat', exact: true })
    .locator('visible=true')
    .waitFor({ state: 'visible' });
  await expect(
    page
      .getByRole('button', { name: 'Create chat', exact: true })
      .locator('visible=true'),
  ).toBeEnabled({ timeout: 30_000 });
  await page
    .getByRole('button', { name: 'Create chat', exact: true })
    .locator('visible=true')
    .click();
  await page
    .getByRole('button', { name: 'Create', exact: true })
    .locator('visible=true')
    .click();
  await expect(
    page.getByPlaceholder('Ask anything...').locator('visible=true'),
  ).toBeVisible({ timeout: 30_000 });
  await setReachability(request, 'error');

  await expect(
    page.getByText('Opening chat', { exact: true }).locator('visible=true'),
  ).toBeVisible({ timeout: boundedOfflineTimeoutMs });
  await expect(
    page
      .getByText(/Tailscale cannot reach the paired Mac/i)
      .locator('visible=true')
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByText('Loading the transcript and agent state.', { exact: true })
      .locator('visible=true'),
  ).toHaveCount(0);
});

test('issue-1237-mutations: paired-Mac mutations stay disabled while offline', async ({
  page,
  request,
}) => {
  await pairTestMac(page);
  await setReachability(request, 'error');
  await expect(
    page
      .getByLabel('Paired Mac status: Tailscale unavailable', { exact: true })
      .locator('visible=true'),
  ).toBeVisible({ timeout: boundedOfflineTimeoutMs });
  await expect(
    page
      .getByRole('button', {
        name: 'Revoke this iPhone from the paired Mac',
        exact: true,
      })
      .locator('visible=true'),
  ).toBeDisabled();
  await expect(
    page
      .getByRole('button', { name: 'Pair a different Mac', exact: true })
      .locator('visible=true'),
  ).toBeDisabled();
});

test('issue-1237-c5: automatic reconnect performs one authoritative recovery refresh', async ({
  page,
  request,
}) => {
  await pairTestMac(page);
  await page
    .getByRole('tab', { name: /Agents$/ })
    .locator('visible=true')
    .click();
  await expect(
    page
      .getByRole('button', { name: 'Create chat', exact: true })
      .locator('visible=true'),
  ).toBeEnabled({ timeout: 30_000 });
  await page
    .getByRole('button', { name: 'Create chat', exact: true })
    .locator('visible=true')
    .click();
  await page
    .getByRole('button', { name: 'Create', exact: true })
    .locator('visible=true')
    .click();
  const prompt = page
    .getByPlaceholder('Ask anything...')
    .locator('visible=true');
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await prompt.fill('Keep recovery transcript unique');
  await page
    .getByTestId('chat-primary-button')
    .locator('visible=true')
    .click();
  const finalTranscriptLine = page
    .getByText(
      'Finished: Keep recovery transcript unique. Flow stayed stable against the fake OpenCode server.',
      { exact: true },
    )
    .locator('visible=true');
  await expect(finalTranscriptLine).toBeVisible({ timeout: 20_000 });

  await setReachability(request, 'error');
  await expect(
    page
      .getByText('Opening chat', { exact: true })
      .locator('visible=true'),
  ).toBeVisible({ timeout: boundedOfflineTimeoutMs });

  const before = await (
    await request.get(`${fakeServer}/__control/mobile`)
  ).json();
  await setReachability(request, 'online');
  await expect(finalTranscriptLine).toBeVisible({
    timeout: boundedOfflineTimeoutMs,
  });
  await expect(finalTranscriptLine).toHaveCount(1);
  const afterRecovery = await (
    await request.get(`${fakeServer}/__control/mobile`)
  ).json();
  const healthRequests = (events) =>
    events.filter((event) => event.path === '/mobile-gateway/health').length;
  expect(
    healthRequests(afterRecovery.events) - healthRequests(before.events),
  ).toBe(1);

  await page
    .getByRole('button', { name: 'Back to Agents', exact: true })
    .locator('visible=true')
    .click();
  await expect(
    page.getByRole('button', { name: 'Create chat', exact: true }).locator('visible=true'),
  ).toBeEnabled({ timeout: boundedOfflineTimeoutMs });
  await page
    .getByRole('button', { name: 'Show activity', exact: true })
    .locator('visible=true')
    .click();
  const activityIds = await page
    .locator('[data-testid^="activity-item-"]')
    .locator('visible=true')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
  expect(new Set(activityIds).size).toBe(activityIds.length);
  await page.screenshot({
    path: `${proofUiDir}/recovered.png`,
    fullPage: true,
  });
});
