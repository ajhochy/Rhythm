import { expect, test } from '@playwright/test';

const fakeBaseUrl =
  `http://127.0.0.1:${process.env.PLAYWRIGHT_FAKE_PORT ?? '44096'}`;

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

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${fakeBaseUrl}/__control/reset`, {
    data: { scenario: 'happy-path' },
  });
  expect(response.ok()).toBeTruthy();
});

test('paired production transport drives projects, chat, SSE, and activity without filesystem scope', async ({
  page,
  request,
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Pair a Mac' }).click();
  await page.getByRole('button', { name: 'Scan test QR code' }).click();
  await expect(
    page.getByLabel('Paired Mac status: Connected').last(),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'Agents' }).click();
  const createChat = await openAgentsAction(page, 'Create chat');
  await expect(createChat).toBeEnabled({ timeout: 30_000 });
  await activateMenuItem(createChat);
  await page.getByLabel('Chat title').fill('Paired gateway chat');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Start a new task')).toBeVisible({
    timeout: 30_000,
  });
  await page
    .getByPlaceholder('Ask anything...')
    .fill('Prove the paired production gateway is live');
  await page.getByTestId('chat-primary-button').click();
  await expect(page.getByText(/Finished:/).first()).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('button', { name: 'Back to Agents' }).click();
  await page.getByRole('button', { name: 'Agents menu' }).click();
  await page.getByRole('menuitem', { name: 'Activity' }).click();
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `${fakeBaseUrl}/__control/mobile`,
        );
        const body = await response.json();
        return body.events.map((event) => event.path);
      },
      { timeout: 10_000 },
    )
    .toContain('/mobile-gateway/agent-activity');
  await expect(
    page.getByText('Paired agent completed a task'),
  ).toBeVisible({ timeout: 10_000 });

  const auditResponse = await request.get(
    `${fakeBaseUrl}/__control/mobile`,
  );
  expect(auditResponse.ok()).toBeTruthy();
  const audit = await auditResponse.json();
  const paths = audit.events.map((event) => event.path);
  expect(paths).toContain('/mobile-gateway/projects');
  expect(paths).toContain('/mobile-gateway/events');
  expect(
    paths.some((path) => path.startsWith('/mobile-gateway/opencode/session')),
  ).toBeTruthy();
  expect(paths).toContain('/mobile-gateway/agent-activity');
  for (const event of audit.events.filter(
    (entry) =>
      entry.path === '/mobile-gateway/events' ||
      entry.path.startsWith('/mobile-gateway/opencode/'),
  )) {
    expect(event.projectId).toBe('project-demo');
    expect(event.queryKeys).not.toEqual(
      expect.arrayContaining([
        'cwd',
        'directory',
        'root',
        'workspace',
        'worktreeDir',
      ]),
    );
  }
  expect(JSON.stringify(audit)).not.toContain('/workspace');
  expect(JSON.stringify(audit)).not.toContain('e2e-device-token');
});
