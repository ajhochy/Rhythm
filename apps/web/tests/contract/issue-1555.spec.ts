import { expect, test, type Page, type Route } from '@playwright/test';

test.skip(process.env.RHYTHM_ISSUE_1555_CONTRACT !== '1', 'Run with the issue-1555 Playwright config');

type RestartReply = { status: number; json: unknown };
type RouteState = { runtimeBootId?: string; runtimePid?: number; apiHealthCalls?: number; engineHealthCalls?: number };

async function installRoutes(page: Page, restartReplies: RestartReply[] = [], state: RouteState = {}) {
  const writes: string[] = [];
  await page.route('http://127.0.0.1:7442/**', route => {
    state.engineHealthCalls = (state.engineHealthCalls ?? 0) + 1;
    return route.fulfill({ status: 200, json: { healthy: true } });
  });
  await page.route('https://issue1555.invalid/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/optimizer/auto-promotion') return route.fulfill({ status: 200, json: { availability: true, state: { autoPromotionEnabled: false, enabledAt: null, autoPromotionEligible: true, totalVerified: 5, totalRegressions: 0, trustThreshold: 5 } } });
    return route.fulfill({ status: 200, json: [] });
  });
  await page.route('http://127.0.0.1:7441/**', (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST') writes.push(path);
    if (path === '/health') {
      state.apiHealthCalls = (state.apiHealthCalls ?? 0) + 1;
      return route.fulfill({ status: 200, json: { healthy: true } });
    }
    if (path === '/opencode/runtime') return route.fulfill({ status: 200, json: {
      engine: { port: 7442, pid: state.runtimePid ?? 4321, bootId: state.runtimeBootId ?? 'boot-A', version: '1.14.49', status: 'ready', bridgeLive: true },
      api: { port: 7441 }, remoteOverride: null,
    } });
    if (path === '/system/refresh') return route.fulfill({ status: 200, json: { status: 'ok', refreshed: ['skills', 'agent-profiles'] } });
    if (path === '/system/restart-engine') {
      const reply = restartReplies.shift() ?? { status: 200, json: { status: 'ready', bootId: 'boot-B', previousBootId: 'boot-A' } };
      return route.fulfill(reply);
    }
    if (path === '/opencode/auth/accounts') return route.fulfill({ status: 200, json: { accounts: [] } });
    if (path === '/opencode/auth') return route.fulfill({ status: 200, json: { providers: [] } });
    if (path === '/agent-configs' || path === '/opencode/mcp') return route.fulfill({ status: 200, json: [] });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  return writes;
}

async function openRuntime(page: Page, restartReplies: RestartReply[] = [], state: RouteState = {}) {
  const writes = await installRoutes(page, restartReplies, state);
  await page.goto('/#/tools/agent-settings?settingsSection=runtime');
  await expect(page.getByRole('heading', { name: 'Runtime / OpenCode server' })).toBeVisible();
  return { detail: page.getByTestId('list-inspector-detail'), writes };
}

test('1555:web-runtime-inspector-controls:1 renders runtime facts and removes the false redirect in live and fixture', async ({ page }) => {
  // This contract intentionally cold-loads both configured Vite origins; keep both assertions under
  // one criterion while allowing each server its normal first-transform budget.
  test.setTimeout(60_000);
  const { detail } = await openRuntime(page);
  for (const value of ['4321', 'boot-A', '1.14.49', '7442', '7441']) await expect(detail).toContainText(value);
  await expect(detail).not.toContainText('Flutter Agent settings');
  await expect(detail).not.toContainText('PATCH /opencode/runtime');

  await page.goto('http://127.0.0.1:7443/#/tools/agent-settings?settingsSection=runtime');
  const fixture = page.getByTestId('list-inspector-detail');
  await expect(fixture).not.toContainText('Flutter Agent settings');
  await expect(fixture).not.toContainText('PATCH /opencode/runtime');
});

test('1555:web-runtime-inspector-controls:2 reload config and skills is the first-line action and posts once', async ({ page }) => {
  const { detail, writes } = await openRuntime(page);
  const escalation = detail.getByTestId('runtime-control-actions').getByRole('button');
  await expect(escalation.first()).toHaveText('Reload engine config & skills');
  await escalation.first().click();
  await expect(detail.getByRole('status')).toContainText('skills, agent-profiles');
  expect(writes.filter(path => path === '/system/refresh')).toHaveLength(1);
});

test('1555:web-runtime-inspector-controls:3 engine restart confirms loss and surfaces success, blockers, and timeout', async ({ page }) => {
  const replies: RestartReply[] = [
    { status: 200, json: { status: 'ready', bootId: 'boot-B', previousBootId: 'boot-A' } },
    { status: 409, json: { status: 'blocked', blockers: [{ type: 'session', id: 'session-1', name: 'Working agent', status: 'working' }, { type: 'permission', sessionId: 'session-2', permissionId: 'permission-7', summary: 'Approve deployment' }] } },
    { status: 503, json: { status: 'unavailable', statusMessage: 'Engine did not become ready before the deadline' } },
  ];
  const { detail, writes } = await openRuntime(page, replies);
  const restart = detail.getByRole('button', { name: 'Restart engine' });

  await restart.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/in-flight turns/i);
  await expect(dialog).toContainText(/permission prompts/i);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(writes.filter(path => path === '/system/restart-engine')).toHaveLength(0);

  await restart.click();
  await dialog.getByRole('button', { name: 'Restart engine' }).click();
  await expect(detail.getByRole('status').filter({ hasText: 'boot-B' })).toContainText('boot-B');

  await restart.click();
  await dialog.getByRole('button', { name: 'Restart engine' }).click();
  await expect(detail.getByRole('alert')).toContainText('Working agent');
  await expect(detail.getByRole('alert')).toContainText('permission-7');

  await restart.click();
  await dialog.getByRole('button', { name: 'Restart engine' }).click();
  await expect(detail.getByRole('alert')).toContainText('Engine did not become ready before the deadline');
  await expect(detail.getByRole('button', { name: 'Check local API' })).toBeEnabled();
});

test('1555:web-runtime-inspector-controls:4 local restart is disabled when unowned and calls IPC once when owned', async ({ browser }) => {
  for (const owned of [false, true]) {
    const context = await browser.newContext();
    await context.addInitScript(({ owned }) => {
      let restarts = 0;
      Object.defineProperty(window, 'rhythmShell', { value: Object.freeze({
        agentServer: Object.freeze({
          status: async () => ({ status: 'ready', owned, ownership: owned ? 'electron' : 'external' }),
          onStatusChange: () => () => {},
          restart: async () => { restarts++; return { ok: true }; },
        }),
        __restartCount: () => restarts,
      }) });
    }, { owned });
    const page = await context.newPage();
    const { detail } = await openRuntime(page);
    const button = detail.getByRole('button', { name: 'Restart local runtime' });
    if (!owned) {
      await expect(button).toBeDisabled();
      await expect(detail).toContainText('owned by another app');
    } else {
      await expect(button).toBeEnabled();
      await button.click();
      await expect.poll(() => page.evaluate(() => (window.rhythmShell as unknown as { __restartCount(): number }).__restartCount())).toBe(1);
    }
    await context.close();
  }
});

test('review:AgentSettingsTool.tsx:786 disables every runtime control during local restart', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, 'rhythmShell', { value: Object.freeze({
      agentServer: Object.freeze({
        status: async () => ({ status: 'ready', owned: true, ownership: 'electron' }),
        onStatusChange: () => () => {},
        restart: async () => new Promise(() => {}),
      }),
    }) });
  });
  const page = await context.newPage();
  const { detail } = await openRuntime(page);
  await detail.getByRole('button', { name: 'Restart local runtime' }).click();
  for (const name of ['Check local API', 'Check OpenCode engine', 'Reload engine config & skills', 'Restart engine', 'Restart local runtime']) {
    await expect(detail.getByRole('button', { name })).toBeDisabled();
  }
  await context.close();
});

test('review:AgentSettingsTool.tsx:629 failed owned restart shows actionable mapped error and Retry', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, 'rhythmShell', { value: Object.freeze({
      agentServer: Object.freeze({
        status: async () => ({ status: 'failed', owned: true, ownership: 'electron', errorMessage: 'Previous failure' }),
        onStatusChange: () => () => {},
        restart: async () => ({ ok: false, reason: 'startup_failed', status: { errorMessage: 'Port 4001 is still in use. Close it, then Retry.' } }),
      }),
    }) });
  });
  const page = await context.newPage();
  const { detail } = await openRuntime(page);
  const retry = detail.getByRole('button', { name: 'Retry local runtime' });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(detail.getByRole('alert')).toContainText('Port 4001 is still in use. Close it, then Retry.');
  await expect(detail.getByRole('alert')).not.toContainText('startup_failed');
  await expect(detail).not.toContainText('owned by another app');
  await expect(retry).toBeEnabled();
  await context.close();
});

test('review:AgentSettingsTool.tsx:630 successful local restart refreshes runtime facts and health', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, 'rhythmShell', { value: Object.freeze({
      agentServer: Object.freeze({
        status: async () => ({ status: 'ready', owned: true, ownership: 'electron' }),
        onStatusChange: () => () => {},
        restart: async () => ({ ok: true }),
      }),
    }) });
  });
  const page = await context.newPage();
  const state: RouteState = { runtimeBootId: 'boot-A', runtimePid: 4321 };
  const { detail } = await openRuntime(page, [], state);
  await expect(detail).toContainText('boot-A');
  const apiChecks = state.apiHealthCalls ?? 0;
  const engineChecks = state.engineHealthCalls ?? 0;
  state.runtimeBootId = 'boot-B';
  state.runtimePid = 9876;
  await detail.getByRole('button', { name: 'Restart local runtime' }).click();
  await expect(detail).toContainText('boot-B');
  await expect(detail).toContainText('9876');
  await expect.poll(() => state.apiHealthCalls ?? 0).toBeGreaterThan(apiChecks);
  await expect.poll(() => state.engineHealthCalls ?? 0).toBeGreaterThan(engineChecks);
  await context.close();
});
