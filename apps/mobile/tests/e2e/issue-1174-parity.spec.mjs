import { expect, test } from '@playwright/test';

const fakePort = process.env.RHYTHM_MOBILE_E2E_FAKE_PORT || '44096';
const fakeServer = `http://127.0.0.1:${fakePort}`;

async function reset(page, request) {
  const response = await request.post(`${fakeServer}/__control/reset`, {
    data: { scenario: 'happy-path' },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
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

async function openReadyChat(page, request) {
  await reset(page, request);
  const createChat = await openAgentsAction(page, 'Create chat');
  await expect(createChat).toBeEnabled({
    timeout: 30_000,
  });
  await activateMenuItem(createChat);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
}

async function backToAgents(page) {
  await page.getByRole('button', { name: 'Back to Agents' }).click();
  await expect(page.getByRole('tab', { name: 'Agents' })).toBeVisible();
}

async function openWorkspace(page) {
  await backToAgents(page);
  await activateMenuItem(await openAgentsAction(page, 'Open workspace'));
  await expect(page.getByRole('button', { name: 'Back to Agents' })).toBeVisible();
}

async function openTool(page, name) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Tools' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}\\.`) }).click();
}

test('issue-1174: workspace exposes adapter search, VCS inspection, and project metadata', async ({ page, request }, testInfo) => {
  await openReadyChat(page, request);
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Files', exact: true }).first().click();

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByTestId('workspace-file-search').fill('OpenCode');
  await page.getByTestId('workspace-search-button').click();
  await expect(page.getByText('README.md:3', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Symbols', exact: true }).click();
  await page.getByTestId('workspace-file-search').fill('feature');
  await page.getByTestId('workspace-search-button').click();
  await expect(page.getByText('feature', { exact: true })).toBeVisible();

  await page.getByTestId('workspace-vcs-raw-button').click();
  await expect(page.getByTestId('workspace-vcs-output')).toContainText('No changes.');

  await page.getByRole('button', { name: 'Tools', exact: true }).first().click();
  await page.getByTestId('workspace-project-name').fill('Parity project');
  await page.getByTestId('workspace-project-save').click();
  await expect.poll(async () => {
    const response = await request.get(`${fakeServer}/project/current`);
    return (await response.json()).name;
  }).toBe('Parity project');
  if (process.env.RHYTHM_CAPTURE_SCREENSHOTS === '1') {
    await page.screenshot({
      path: testInfo.outputPath('workspace.png'),
      fullPage: true,
    });
  }
});

test('issue-1174: chat session maintenance initializes, shells, edits, and deletes', async ({ page, request }, testInfo) => {
  await openReadyChat(page, request);
  await page.getByPlaceholder('Ask anything...').fill('Create an editable message');
  await page.getByTestId('chat-primary-button').click();
  await expect(page.getByText(/Finished: Create an editable message/).first()).toBeVisible({ timeout: 20_000 });

  await page.getByLabel('Chat menu').locator('visible=true').click();
  await page.getByTestId('chat-session-tools-toggle').locator('visible=true').click();
  await page.getByTestId('chat-session-children-button').click();
  await expect(page.getByText('No child sessions.', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('chat-session-init-button').click();
  await expect(page.getByTestId('chat-session-init-button')).toBeEnabled();

  await page.getByTestId('chat-session-shell-input').fill('npm test');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('chat-session-shell-button').click();
  await expect(page.getByText('Command /shell npm test completed.', { exact: true }).first()).toBeVisible();

  await expect(page.getByTestId('chat-message-part-input')).toHaveValue('Create an editable message');
  await page.getByTestId('chat-message-part-input').fill('Edited from mobile parity');
  await page.getByTestId('chat-message-part-save').click();
  await expect(page.getByText('Edited from mobile parity', { exact: true }).first()).toBeVisible();

  const sessions = await (await request.get(`${fakeServer}/session`)).json();
  const sessionId = sessions[0].id;
  const messageCount = (
    await (await request.get(`${fakeServer}/session/${sessionId}/message`)).json()
  ).length;
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('chat-message-delete').click();
  await expect.poll(async () => (
    await (await request.get(`${fakeServer}/session/${sessionId}/message`)).json()
  ).length).toBe(messageCount - 1);

  await page.getByPlaceholder('Ask anything...').fill('Create a deletable part');
  await page.getByTestId('chat-primary-button').click();
  await expect(page.getByText(/Finished: Create a deletable part/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('chat-message-part-input')).toHaveValue('Create a deletable part');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('chat-message-part-delete').click();
  await expect.poll(async () => {
    const messages = await (await request.get(`${fakeServer}/session/${sessionId}/message`)).json();
    return messages.some((message) => message.parts.some(
      (part) => part.type === 'text' && part.text === 'Create a deletable part',
    ));
  }).toBe(false);
  if (process.env.RHYTHM_CAPTURE_SCREENSHOTS === '1') {
    await page.screenshot({
      path: testInfo.outputPath('chat-maintenance.png'),
      fullPage: true,
    });
  }
});

test('issue-1174: terminal detail and resize use the PTY adapter surface', async ({ page, request }, testInfo) => {
  await openReadyChat(page, request);
  await backToAgents(page);
  await activateMenuItem(await openAgentsAction(page, 'Open terminal'));
  await page.getByTestId('terminal-create-button').click();
  await expect(page.getByTestId('terminal-detail-panel')).toContainText('/workspace/demo-project');
  await page.getByTestId('terminal-rows-input').fill('32');
  await page.getByTestId('terminal-columns-input').fill('120');
  await page.getByTestId('terminal-resize-button').click();
  await expect.poll(async () => {
    const terminals = await (await request.get(`${fakeServer}/pty`)).json();
    return terminals[0]?.size;
  }).toEqual({ rows: 32, cols: 120 });
  if (process.env.RHYTHM_CAPTURE_SCREENSHOTS === '1') {
    await page.screenshot({
      path: testInfo.outputPath('terminal.png'),
      fullPage: true,
    });
  }
});

test('issue-1174: runtime skills, schemas, resources, config reload, and OAuth removal are surfaced', async ({ page, request }, testInfo) => {
  await reset(page, request);
  await openTool(page, 'Skills');
  await page.getByTestId('opencode-skills-reload-button').click();
  await expect(page.getByText('Reloaded 1 runtime skills.', { exact: true })).toBeVisible();
  await page.getByTestId('opencode-runtime-inspect-button').click();
  await expect(page.getByTestId('opencode-runtime-skills')).toContainText('mobile-parity');
  if (process.env.RHYTHM_CAPTURE_SCREENSHOTS === '1') {
    await page.screenshot({
      path: testInfo.outputPath('skills.png'),
      fullPage: true,
    });
  }

  await page.getByRole('button', { name: 'Back to Tools' }).click();
  await page.getByRole('button', { name: /^Providers & Models\./ }).click();
  await page.getByTestId('opencode-config-reload-button').click();
  await expect(page.getByText('OpenCode configuration reloaded.', { exact: true })).toBeVisible();
  await page.getByTestId('opencode-runtime-inspect-button').click();
  await expect(page.getByTestId('opencode-runtime-tool-schemas')).toContainText('"id": "read"');
  await expect(page.getByTestId('opencode-runtime-config')).toContainText('[redacted]');
  await expect(page.getByTestId('opencode-runtime-config')).not.toContainText('sk-fake-secret');
  await expect(page.getByTestId('opencode-runtime-config')).not.toContainText('plain-fake-secret');
  if (process.env.RHYTHM_CAPTURE_SCREENSHOTS === '1') {
    await page.screenshot({
      path: testInfo.outputPath('models-config.png'),
      fullPage: true,
    });
  }

  await page.getByRole('button', { name: 'Back to Tools' }).click();
  await page.getByRole('button', { name: /^MCP\./ }).click();
  await page.getByTestId('opencode-runtime-inspect-button').click();
  await expect(page.getByTestId('opencode-runtime-resources')).toContainText('filesystem:readme');
  const oauthStart = await request.post(`${fakeServer}/mcp/filesystem/auth`, { data: {} });
  expect(oauthStart.ok()).toBeTruthy();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('mcp-remove-oauth-filesystem').click();
  await expect(page.getByText('MCP authorization removed.', { exact: true })).toBeVisible();
  const staleCallback = await request.post(`${fakeServer}/mcp/filesystem/auth/callback`, {
    data: { code: 'must-not-persist' },
  });
  expect(staleCallback.status()).toBe(400);
  if (process.env.RHYTHM_CAPTURE_SCREENSHOTS === '1') {
    await page.screenshot({
      path: testInfo.outputPath('mcp.png'),
      fullPage: true,
    });
  }
});
