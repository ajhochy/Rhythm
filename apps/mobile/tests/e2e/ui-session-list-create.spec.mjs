import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// After-only visual capture for the mobile session-list + chat-create UI
// (docs/ai/spec-session-list-and-create-ui.md gap #1/#3): no baseline
// screenshots exist anywhere for these two screens, so these are NOT
// before/after diffs -- just the first-ever look at the rendered result of
// PR #1585's compact-headers/create-sheet work.

const fakePort =
  process.env.PLAYWRIGHT_FAKE_PORT ??
  process.env.RHYTHM_MOBILE_E2E_FAKE_PORT ??
  '44096';
const fakeServer = `http://127.0.0.1:${fakePort}`;
const proofDir = fileURLToPath(
  new URL('../../../../.proof/ui-session-list-create/', import.meta.url),
);

async function resetScenario(request) {
  const response = await request.post(`${fakeServer}/__control/reset`, {
    data: { scenario: 'happy-path' },
  });
  expect(response.ok()).toBeTruthy();
}

async function openAgents(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible({
    timeout: 30_000,
  });
}

async function openAgentsAction(page, name) {
  await expect(page.getByRole('menuitem')).toHaveCount(0, { timeout: 10_000 });
  await page
    .getByRole('button', { name: 'Chats menu', exact: true })
    .locator('visible=true')
    .click();
  const action = page
    .getByRole('menuitem', { name, exact: true })
    .locator('visible=true');
  await expect(action).toBeVisible({ timeout: 30_000 });
  return action;
}

async function activateMenuItem(item) {
  await item.click();
}

// Fresh sessions report status "idle", which the default "active" lifecycle
// filter hides entirely (0 active). Switch to "All chat states" so the
// created row is actually visible in the screenshot, then expand the
// project group's disclosure.
async function showAllChatStatesAndExpand(page) {
  await activateMenuItem(await openAgentsAction(page, 'All chat states'));
  const collapsedHeader = page
    .getByRole('button', { name: /demo-project.*collapsed/ })
    .locator('visible=true');
  if (await collapsedHeader.count()) {
    await collapsedHeader.click();
  }
}

// The fake server's happy-path scenario starts with zero sessions. With no
// sessions the list renders the pairedHost bootstrap-recovery empty state
// instead of any project headers/rows (chat-list.tsx `showsBootstrapRecovery`
// hides listItems whenever `visibleSessionCount === 0`) -- so at least one
// real session has to exist before the session-list screen has anything to
// screenshot.
async function createChat(page, title) {
  const create = await openAgentsAction(page, 'Create chat');
  await expect(create).toBeEnabled({ timeout: 30_000 });
  await activateMenuItem(create);
  const titleInput = page
    .getByLabel('Chat title', { exact: true })
    .locator('visible=true');
  await titleInput.fill(title);
  await titleInput.press('Tab');
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        new URL(res.url()).pathname === '/session',
    ),
    page
      .getByRole('button', { name: 'Create', exact: true })
      .locator('visible=true')
      .click(),
  ]);
  const session = await response.json();
  await expect(
    page.getByPlaceholder('Ask anything...').locator('visible=true'),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole('button', { name: 'Back to Agents', exact: true })
    .locator('visible=true')
    .click();
  return session.id;
}

test.beforeAll(async () => {
  await mkdir(proofDir, { recursive: true });
});

test.beforeEach(async ({ request }) => {
  await resetScenario(request);
});

for (const viewport of [
  { width: 375, height: 812, label: '375' },
  { width: 430, height: 932, label: '430' },
]) {
  test(`session list renders at ${viewport.label}pt phone width`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await openAgents(page);
    await createChat(page, 'Weekly planning sync');
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible({
      timeout: 30_000,
    });
    await showAllChatStatesAndExpand(page);
    await expect(
      page.getByText('Weekly planning sync').locator('visible=true'),
    ).toBeVisible({ timeout: 30_000 });
    // Full-width search row (AJ: "shape collisions w the search bar").
    await expect(
      page.getByTestId('chat-list-search').locator('visible=true'),
    ).toBeVisible();
    await expect(
      page.getByLabel('Search chats').locator('visible=true'),
    ).toBeVisible();
    // Compact per-project header + "New chat in <project>" button.
    await expect(
      page.getByLabel(/New chat in .+/).locator('visible=true'),
    ).toBeVisible();
    await page.screenshot({
      path: `${proofDir}/session-list-${viewport.label}.png`,
      fullPage: true,
    });
  });

  test(`chat-create sheet renders at ${viewport.label}pt phone width`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await openAgents(page);
    const createChatAction = await openAgentsAction(page, 'Create chat');
    await activateMenuItem(createChatAction);
    await expect(
      page.getByLabel('Chat title').locator('visible=true'),
    ).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      path: `${proofDir}/create-sheet-${viewport.label}.png`,
      fullPage: true,
    });
  });
}
