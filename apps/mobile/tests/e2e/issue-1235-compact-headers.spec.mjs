import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fakePort =
  process.env.PLAYWRIGHT_FAKE_PORT ??
  process.env.RHYTHM_MOBILE_E2E_FAKE_PORT ??
  '44096';
const fakeServer = `http://127.0.0.1:${fakePort}`;
const proofDir = fileURLToPath(new URL('../../../../.proof/i1235/ui/', import.meta.url));

async function resetScenario(request) {
  const response = await request.post(`${fakeServer}/__control/reset`, {
    data: { scenario: 'happy-path' },
  });
  expect(response.ok()).toBeTruthy();
}

async function openAgents(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible({
    timeout: 30_000,
  });
}

async function openAgentsAction(page, name) {
  await expect(page.getByRole('menuitem')).toHaveCount(
    0,
    { timeout: 10_000 },
  );
  await page.getByRole('button', { name: 'Agents menu', exact: true }).click();
  const action = page
    .getByRole('menuitem', { name, exact: true })
    .locator('visible=true');
  await expect(action).toBeVisible({ timeout: 30_000 });
  return action;
}

async function activateMenuItem(item) {
  await item.focus();
  await item.press('Enter');
}

async function openReadyChat(page) {
  await openAgents(page);
  const createChat = await openAgentsAction(page, 'Create chat');
  await expect(createChat).toBeEnabled();
  await activateMenuItem(createChat);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible({
    timeout: 30_000,
  });
}

test.beforeAll(async () => {
  await mkdir(proofDir, { recursive: true });
});

test.beforeEach(async ({ request }) => {
  await resetScenario(request);
});

test('issue-1235: agents tab has one compact header', async ({ page }) => {
  await openAgents(page);
  await expect(page.getByRole('heading', { name: 'Agents' })).toHaveCount(1);
  await expect(page.getByLabel('Agents menu').locator('visible=true')).toHaveCount(1);
  await page.screenshot({
    path: `${proofDir}/agents-tab.png`,
    fullPage: true,
  });
});

test('issue-1235: chat has one header and secondary actions in overflow', async ({
  page,
}) => {
  await openReadyChat(page);
  await expect(page.getByLabel('Back to Agents')).toHaveCount(1);
  await expect(page.getByLabel('Choose chat')).toHaveCount(1);
  await expect(page.getByLabel(/Chat status:/)).toHaveCount(1);
  await expect(page.getByLabel('Chat menu').locator('visible=true')).toHaveCount(1);
  await expect(page.getByLabel(/Files Changed/)).toHaveCount(0);
  await expect(page.getByText(/Agents\s*\/\s*Chats\s*\//)).toHaveCount(0);
  await page.screenshot({
    path: `${proofDir}/chat-default.png`,
    fullPage: true,
  });

  await page.getByLabel('Chat menu').locator('visible=true').click();
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Manage' })).toBeVisible();
  await page.screenshot({
    path: `${proofDir}/chat-overflow-open.png`,
    fullPage: true,
  });
});

test('issue-1235: tool detail has one combined identity/action header', async ({
  page,
}) => {
  await openAgents(page);
  await page.getByRole('tab', { name: 'Tools' }).click();
  await page.getByRole('button', { name: /^Brain\./ }).click();
  await expect(page.getByLabel('Back to Tools')).toHaveCount(1);
  await expect(page.getByLabel('Refresh Brain')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Brain' })).toHaveCount(1);
  await page.screenshot({
    path: `${proofDir}/tool-brain.png`,
    fullPage: true,
  });
});
