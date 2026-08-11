import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const fakePort = process.env.RHYTHM_MOBILE_E2E_FAKE_PORT || '44096';
const fakeServer = `http://127.0.0.1:${fakePort}`;

async function resetScenario(request, scenario) {
  const response = await request.post(`${fakeServer}/__control/reset`, {
    data: { scenario },
  });

  expect(response.ok()).toBeTruthy();
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
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: 'Agents' })).toBeVisible();
  const createChat = await openAgentsAction(page, 'Create chat');
  await expect(createChat).toBeEnabled({
    timeout: 30_000,
  });
  await activateMenuItem(createChat);
  await expect(page.getByLabel('Chat title')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Start a new task')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible();
}

async function backToAgents(page) {
  await page.getByRole('button', { name: 'Back to Agents' }).click();
  await expect(page.getByRole('tab', { name: 'Agents' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agents menu' })).toBeVisible();
}

async function openWorkspace(page) {
  await backToAgents(page);
  await activateMenuItem(await openAgentsAction(page, 'Open workspace'));
  await expect(page.getByRole('button', { name: 'Back to Agents' })).toBeVisible();
}

async function openTerminal(page) {
  await backToAgents(page);
  await activateMenuItem(await openAgentsAction(page, 'Open terminal'));
  await expect(page.getByRole('button', { name: 'Back to Agents' })).toBeVisible();
}

async function openSettings(page) {
  await backToAgents(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
}

async function sendPrompt(page, prompt) {
  await page.getByPlaceholder('Ask anything...').fill(prompt);
  await page.getByTestId('chat-primary-button').click();
}

async function waitForServer(request, url, timeoutMs = 10_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await request.get(url);
      if (response.ok()) {
        return;
      }
    } catch {
      // Keep polling until the timeout expires.
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for fake server at ${url}`);
}

// A hardcoded listen port is unsafe on CI: Linux hands out 32768-60999 as
// ephemeral ports, so any transient localhost socket in the job can already own
// it, the child dies with EADDRINUSE, and every retry re-picks the same doomed
// port (#1337). Bind port 0 instead and read back what the kernel assigned.
async function stopFakeServer(child) {
  if (!child) return;
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => child.once('close', resolve));
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const escalation = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 2_000);
    try {
      await exited;
    } finally {
      clearTimeout(escalation);
    }
  } else {
    await exited;
  }
}

async function startPrefixedFakeServer(basePath, timeoutMs = 5_000) {
  const child = spawn(process.execPath, ['tests/fake-opencode/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FAKE_OPENCODE_PORT: '0',
      FAKE_OPENCODE_SCENARIO: 'happy-path',
      FAKE_OPENCODE_BASE_PATH: basePath,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const port = await new Promise((resolve, reject) => {
    let output = '';
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const settle = (callback, value) => {
      cleanup();
      callback(value);
    };
    const onData = (chunk) => {
      output += chunk.toString();
      const [, listening] = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/) ?? [];
      if (!listening) return;
      child.stdout.resume();
      settle(resolve, Number(listening));
    };
    const onError = (error) => settle(reject, new Error(`Fake server failed to spawn: ${error.message}`));
    const onExit = (code, signal) =>
      settle(reject, new Error(`Fake server exited before listening (${signal ?? code}): ${output}`));
    timer = setTimeout(() =>
      settle(reject, new Error(`Fake server timed out after ${timeoutMs}ms waiting to listen: ${output}`)), timeoutMs);
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  }).catch(async (error) => {
    await stopFakeServer(child);
    throw error;
  });

  return { child, port };
}

test('happy path keeps the main chat flow stable', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Stabilize the chat flow against the fake server');

  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Flow stayed stable against the fake OpenCode server/).first()).toBeVisible();
  await page.getByText('1 Files Changed', { exact: true }).click();
  await expect(page.getByText('1 files changed, +6 / -1', { exact: true })).toBeVisible();
  await page.getByText('app/(tabs)/index.tsx', { exact: true }).click();
  await expect(page.getByText(/export default function ChatLandingScreen/)).toBeVisible();
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Files' }).click();
  await expect(page.getByText('2 changed files', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chats' }).click();
  await expect(page.getByText('Stabilize the chat flow', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('idle', { exact: true }).first()).toBeVisible();
});

test('issue-1233 model picker groups connected provider accounts and hides disconnected providers', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await page.getByRole('button', { name: 'Chat menu' }).click();
  await page.getByRole('button', { name: /Model, GPT-4\.1 mini/ }).click();
  await expect(page.getByRole('heading', { name: 'Choose Model' })).toBeVisible();
  await expect(page.getByText('OpenAI', { exact: true })).toBeVisible();
  // Selected/recent outranks recommended, so the just-clicked model reads Recent.
  await expect(page.getByText('OpenAI · Recent · Reasoning', { exact: true })).toBeVisible();
  await expect(page.getByText('OpenRouter', { exact: true })).not.toBeVisible();
});

test('files changed follows the latest user turn', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Create the first file diff');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByText('1 Files Changed', { exact: true }).click();
  await expect(page.getByText('app/(tabs)/index.tsx', { exact: true })).toBeVisible();

  await page.getByText('Session', { exact: true }).click();
  await sendPrompt(page, 'Create the second file diff');
  await expect(page.getByText(/Finished: Create the second file diff/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByText('1 Files Changed', { exact: true }).click();
  await expect(page.getByText('src/feature.ts', { exact: true })).toBeVisible();
  await expect(page.getByText('app/(tabs)/index.tsx', { exact: true })).not.toBeVisible();
});

test('permission requests unblock the agent flow', async ({ page, request }) => {
  await resetScenario(request, 'permission');
  await openReadyChat(page);

  await sendPrompt(page, 'Trigger a permission request');

  await expect(page.getByText('Permission request', { exact: true })).toBeVisible({ timeout: 15_000 });
  const allowOnceButton = page.getByRole('button', { name: 'Allow once', exact: true });
  await expect(allowOnceButton).toBeEnabled();
  await allowOnceButton.click();
  await expect(page.getByText(/permission resolved/).first()).toBeVisible({ timeout: 20_000 });
});

test('assistant questions unblock the agent flow', async ({ page, request }) => {
  await resetScenario(request, 'question');
  await openReadyChat(page);

  await sendPrompt(page, 'Ask an implementation question');

  await expect(page.getByText('Which implementation should be used?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText('Minimal', { exact: true }).click();
  await page.getByText('Submit answer', { exact: true }).click();
  await expect(page.getByText(/selected Minimal/).first()).toBeVisible({ timeout: 20_000 });
});

test('sessions can be renamed', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, 'Create a session to rename');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await openWorkspace(page);
  await page.getByLabel(/Actions for/).first().click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).not.toBeVisible();
  await page.getByTestId('workspace-session-title-input').fill('Renamed from Playwright');
  await page.getByText('Save', { exact: true }).click();
  await expect(page.getByText('Renamed from Playwright', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('workspace-session-title-input')).not.toBeVisible();
});

test('sessions require confirmation before deletion', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await sendPrompt(page, 'Delete this session safely');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await openWorkspace(page);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByLabel(/Actions for/).first().click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText('Delete this session safely', { exact: true })).not.toBeVisible();
});

test('commands execute through the primary chat action', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await sendPrompt(page, '/review src');
  await expect(page.getByText('Command /review src completed.', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});

test('workspace file search opens deterministic file content', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await openWorkspace(page);
  await page.getByText('Files', { exact: true }).click();
  await page.getByTestId('workspace-file-search').fill('demo');
  await page.getByText('Search', { exact: true }).click();
  await expect(page.getByText('src/demo.ts', { exact: true })).toBeVisible();
  await page.getByText('src/demo.ts', { exact: true }).click();
  await expect(page.getByText(/OpenCode 1\.14\.49/)).toBeVisible();
});

test('workspace files save through a conflict-checked VCS patch', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await openWorkspace(page);
  await page.getByText('Files', { exact: true }).click();
  await page.getByTestId('workspace-file-search').fill('demo');
  await page.getByText('Search', { exact: true }).click();
  await page.getByText('src/demo.ts', { exact: true }).click();
  await page.getByText('Edit', { exact: true }).click();
  await page.getByTestId('workspace-file-editor').fill('export const demo = "OpenCode SDK 1.14.49";\n');
  await page.getByTestId('workspace-file-save-button').click();
  await expect(page.getByText(/OpenCode SDK 1\.14\.49/)).toBeVisible();
});

test('sessions archive and restore without deletion', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await sendPrompt(page, 'Archive this session safely');
  await expect(page.getByText(/Finished:/).first()).toBeVisible({ timeout: 20_000 });
  await openWorkspace(page);
  await page.getByLabel(/Actions for/).first().click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Show archived chats' }).click();
  await expect(page.getByText('Archive this session safely', { exact: true }).last()).toBeVisible();
  await page.getByLabel(/Restore Archive this session safely/).click();
  await expect(page.getByText('No archived chats.', { exact: true })).toBeVisible();
});

test('worktrees and MCP servers can be created', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Tools' }).click();
  await page.getByTestId('workspace-worktree-name').fill('mobile-test');
  await page.getByTestId('workspace-worktree-create').click();
  await expect(page.getByText('mobile-test', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Back to Agents' }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByText('Advanced', { exact: true }).click();
  await page.getByText('Remote', { exact: true }).click();
  await page.getByTestId('settings-mcp-name').fill('web-tools');
  await page.getByTestId('settings-mcp-target').fill('https://example.test/mcp');
  await page.getByTestId('settings-mcp-add').click();
  await expect(page.getByText('web-tools', { exact: true })).toBeVisible();
});

test('terminal streams input and output over the PTY websocket', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);
  await openTerminal(page);
  await page.getByTestId('terminal-create-button').click();
  await page.getByTestId('terminal-line-input').fill('echo web');
  await page.getByLabel('Send command').click();
  await expect(page.getByTestId('terminal-output')).toContainText('ran: echo web');
});

test('settings can configure an additional provider against the fake server', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  await openReadyChat(page);

  await openSettings(page);
  await expect(page.getByText('AI defaults')).toBeVisible();
  await page.getByTestId('settings-add-provider-button').click();
  await expect(page.getByRole('button', { name: 'OpenRouter', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'OpenRouter', exact: true }).click();
  await expect(page.getByText('Configure OpenRouter')).toBeVisible();
  await page.getByPlaceholder('Paste your API key').fill('sk-test-openrouter');
  await page.getByTestId('settings-provider-save-button').click();
  await expect(page.getByText('Configure OpenRouter')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'OpenRouter', exact: true })).toBeVisible();
});

test('polling fallback still finishes the flow when SSE is unavailable', async ({ page, request }) => {
  await resetScenario(request, 'stream-disconnect');
  await openReadyChat(page);

  await sendPrompt(page, 'Finish through polling fallback');

  await expect(page.getByText(/Finished: Finish through polling fallback/).first()).toBeVisible({ timeout: 40_000 });
  await page.getByText('1 Files Changed', { exact: true }).click();
  await expect(page.getByText('app/(tabs)/index.tsx', { exact: true })).toBeVisible({ timeout: 40_000 });
});

test('settings explain root-vs-api mismatches and reconnect through a prefixed API base URL', async ({ page, request }) => {
  await resetScenario(request, 'happy-path');
  let server;

  try {
    const started = await startPrefixedFakeServer('/api');
    server = started.child;
    const { port } = started;
    await waitForServer(request, `http://127.0.0.1:${port}/api/path`);
    await openReadyChat(page);

    await openSettings(page);
    await expect(page.getByText('Connection')).toBeVisible();
    await page.getByRole('button', { name: /Connection Connected/ }).click();

    await page.getByTestId('settings-server-url-input').fill(`http://127.0.0.1:${port}`);
    await page.getByTestId('settings-reconnect-button').click();
    await expect(page.getByText(new RegExp(`OpenCode endpoint not found at http://127.0.0.1:${port}`)).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(`http://127.0.0.1:${port}/api`)).first()).toBeVisible();

    await page.getByTestId('settings-server-url-input').fill(`http://127.0.0.1:${port}/api`);
    await page.getByTestId('settings-reconnect-button').click();
    await expect(page.getByRole('button', { name: 'Connection Connected' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Connection Connected/ }).click();
    await expect(page.getByText(new RegExp(`Connected to http://127.0.0.1:${port}/api`))).toBeVisible();
  } finally {
    await stopFakeServer(server);
  }
});
