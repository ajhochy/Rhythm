import { expect, test } from '@playwright/test';

const fakeServer = `http://127.0.0.1:${
  process.env.PLAYWRIGHT_FAKE_PORT ??
  process.env.RHYTHM_MOBILE_E2E_FAKE_PORT ??
  '44096'
}`;

const representativeTools = [
  ['Brain', 'Sunday service checklist'],
  ['Research', 'Selected research target'],
  ['Scheduled Jobs', 'Selected schedule target'],
  ['Webhooks', 'Planning Center intake'],
  ['Profiles', 'Secretary'],
  ['Cookbook', 'Selected recipe target'],
  ['Review Queue', 'High-risk model change'],
  ['Report Card', 'Secretary'],
  ['Email', 'Volunteer reply'],
  ['Gallery', 'Sunday service graphic'],
  ['Skills', 'approved-skill'],
  ['Playbooks', 'weekly-review'],
  ['MCP', 'filesystem'],
  ['Providers & Models', 'OpenAI'],
];

async function setToolState(request, state) {
  const response = await request.post(`${fakeServer}/__control/rhythm-tools-state`, {
    data: { state },
  });
  expect(response.ok()).toBeTruthy();
}

async function openTool(page, name) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Tools' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}\\.`) }).click();
}

test.beforeEach(async ({ request }) => {
  await setToolState(request, 'data');
});

test.afterEach(async ({ request }) => {
  await setToolState(request, 'data');
});

test('issue-1234-c3: all Tool screens render representative fake-server data', async ({
  page,
}) => {
  for (const [tool, content] of representativeTools) {
    await openTool(page, tool);
    await expect(page.getByText(content, { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Back to Tools' }).click();
  }
});

for (const stateCase of [
  ['empty', 'Nothing here yet'],
  ['expired-auth', 'Sign in again'],
  ['forbidden', 'Access unavailable'],
  ['error', 'Could not load this screen'],
]) {
  const [serverState, visibleTitle] = stateCase;
  test(`issue-1234-c3: ${serverState} is explicit rather than blank`, async ({
    page,
    request,
  }) => {
    await setToolState(request, serverState);
    await openTool(page, 'Research');
    await expect(page.getByRole('heading', { name: visibleTitle })).toBeVisible();
  });
}

test('issue-1234-c3: cached data becomes an explicit offline state', async ({
  page,
  request,
}) => {
  await openTool(page, 'Research');
  await expect(page.getByText('Selected research target')).toBeVisible();
  await setToolState(request, 'offline');
  await page.getByLabel('Refresh Research').click();
  await expect(page.getByText('Mac offline — saved data is read-only.')).toBeVisible();
  await expect(page.getByText('Selected research target')).toBeVisible();
});
