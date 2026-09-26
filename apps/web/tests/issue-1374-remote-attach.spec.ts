import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const session = { id: 'local-1', name: 'Local session', ownerUserId: 4189, profileId: 'profile', status: 'idle', createdAt: '2026-09-24T00:00:00Z' };

async function installAgentsFixture(page: Page) {
  await page.routeWebSocket(/\/ws\/agents$/, () => {});
  await page.route(/https:\/\/issue1374.invalid|http:\/\/127.0.0.1:(7525|7526)/, async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    let json: unknown = [];
    if (path === '/agent-configs') json = [{ id: 'profile', label: 'Profile', enabled: true }];
    else if (path === '/agent-sessions') json = { sessions: [session] };
    else if (path === '/agent-sessions/local-1') json = { session, messages: [] };
    else if (path.endsWith('/messages')) json = { messages: [], pageInfo: { hasMore: false } };
    await route.fulfill({ json });
  });
}

// Runs entirely inside the page: window.rhythmShell.remoteEnvironments is the exact bridge shape
// apps/electron/src/preload.cjs exposes. No electron process exists in this harness, so this
// stands in for it the same way page.route stands in for the production/local HTTP servers above.
function installRemoteFixture(config: {
  enabled: boolean;
  environments: Array<{ id: string; name: string; status: 'online' | 'offline'; historyAvailable: boolean }>;
  connect: Record<string, { state: string; environmentId?: string; deviceId?: string }>;
  responses: Array<{ method: string; path: string; result: { state: string; status?: number; body?: string } }>;
}) {
  (window as any).__remoteFixtureConfig = config;
  (window as any).__remoteFixtureCalls = [];
  (window as any).rhythmShell = {
    ...(window as any).rhythmShell,
    remoteEnvironments: {
      enabled: config.enabled,
      list: async () => {
        (window as any).__remoteFixtureCalls.push(['list']);
        return { state: 'ok', environments: (window as any).__remoteFixtureConfig.environments };
      },
      connect: async (id: string) => {
        (window as any).__remoteFixtureCalls.push(['connect', id]);
        return (window as any).__remoteFixtureConfig.connect[id] ?? { state: 'error' };
      },
      disconnect: async () => { (window as any).__remoteFixtureCalls.push(['disconnect']); },
      request: async (req: { method: string; path: string; body?: unknown }) => {
        (window as any).__remoteFixtureCalls.push(['request', req.method, req.path, req.body]);
        const rules: typeof config.responses = (window as any).__remoteFixtureConfig.responses;
        const rule = rules.find((row) => row.method === req.method && row.path === req.path);
        return rule ? rule.result : { state: 'ok', status: 200, body: '[]' };
      },
      subscribe: async (sessionId: string) => {
        (window as any).__remoteFixtureCalls.push(['subscribe', sessionId]);
        (window as any).__remoteSubscribed = sessionId;
        return { state: 'ok', unsubscribe: async () => {} };
      },
    },
  };
}

const baseConfig = {
  enabled: true,
  environments: [
    { id: 'primary', name: 'Rhythm Mac', status: 'online' as const, historyAvailable: true },
    { id: 'kitchen', name: 'Kitchen Mac', status: 'offline' as const, historyAvailable: true },
  ],
  connect: {
    primary: { state: 'connected', environmentId: 'primary', deviceId: 'device-1' },
    kitchen: { state: 'offline' },
  },
  responses: [
    { method: 'GET', path: '/mobile-gateway/opencode/experimental/session', result: { state: 'ok', status: 200, body: JSON.stringify([{ id: 'ses_remote_1', title: 'Remote task' }]) } },
    { method: 'GET', path: '/mobile-gateway/opencode/session/ses_remote_1/message', result: { state: 'ok', status: 200, body: JSON.stringify([{ info: { id: 'msg_1', role: 'user', time: { created: 1 } }, parts: [{ id: 'prt_1', type: 'text', text: 'Hello from the primary Mac' }] }]) } },
  ],
};

test.beforeEach(async ({ page }) => { await installAgentsFixture(page); });

test('1374:remote-attach-ui:1 flag off shows no remote UI and leaves the local session untouched', async ({ page }) => {
  await page.addInitScript(installRemoteFixture, { ...baseConfig, enabled: false });
  await page.goto('/tests/electron-e22-harness.html');
  await expect(page.getByTestId('rail-remote-computers')).toHaveCount(0);
  await expect(page.locator('.session-header')).toBeVisible();
  await expect(page.locator('.transcript-reader')).toBeVisible();
  await expect(page.locator('.composer')).toBeVisible();
});

test('1374:remote-attach-ui:2 lists computers, then sessions labeled "Running on <name>"', async ({ page }) => {
  await page.addInitScript(installRemoteFixture, baseConfig);
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId('rail-remote-computers').click();
  const list = page.getByRole('navigation', { name: 'Remote computers list' });
  await expect(list).toContainText('Rhythm Mac');
  await expect(list).toContainText('Kitchen Mac');
  await page.getByTestId('remote-environment-primary').click();
  await expect(page.getByTestId('remote-session-ses_remote_1')).toContainText('Running on Rhythm Mac');
});

test('1374:remote-attach-ui:3 attaching streams the transcript', async ({ page }) => {
  await page.addInitScript(installRemoteFixture, baseConfig);
  await page.addInitScript(() => {
    const original = (window as any).rhythmShell.remoteEnvironments.subscribe;
    (window as any).rhythmShell.remoteEnvironments.subscribe = async (sessionId: string, onChunk: (chunk: string) => void) => {
      const result = await original(sessionId, onChunk);
      const frame = { type: 'message.updated', info: { id: 'msg_2', role: 'assistant', time: { created: 2 } } } as const;
      const part = { type: 'message.part.updated', part: { id: 'prt_2', messageID: 'msg_2', type: 'text', text: 'Streamed from the primary Mac' } } as const;
      setTimeout(() => onChunk(`event: message\ndata: ${JSON.stringify(frame)}\n\nevent: message\ndata: ${JSON.stringify(part)}\n\n`), 10);
      return result;
    };
  });
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId('rail-remote-computers').click();
  await page.getByTestId('remote-environment-primary').click();
  await page.getByTestId('remote-session-ses_remote_1').click();
  const transcript = page.getByLabel('Remote session running on Rhythm Mac');
  await expect(transcript).toContainText('Hello from the primary Mac');
  await expect(transcript).toContainText('Streamed from the primary Mac');
});

test('1374:remote-attach-ui:4 permission and question prompts are answerable', async ({ page }) => {
  await page.addInitScript(installRemoteFixture, baseConfig);
  await page.addInitScript(() => {
    const original = (window as any).rhythmShell.remoteEnvironments.subscribe;
    (window as any).rhythmShell.remoteEnvironments.subscribe = async (sessionId: string, onChunk: (chunk: string) => void) => {
      const result = await original(sessionId, onChunk);
      setTimeout(() => onChunk('event: message\ndata: {"type":"permission.asked","permissionID":"perm_1","tool":"bash","patterns":[]}\n\n'), 10);
      return result;
    };
  });
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId('rail-remote-computers').click();
  await page.getByTestId('remote-environment-primary').click();
  await page.getByTestId('remote-session-ses_remote_1').click();
  const decision = page.getByRole('group', { name: 'Permission requested' });
  await expect(decision).toContainText('Allow bash?');
  await decision.getByRole('button', { name: 'Allow once' }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).__remoteFixtureCalls.some((c: unknown[]) => c[0] === 'request' && c[2] === '/mobile-gateway/opencode/permission/perm_1/reply' && JSON.stringify(c[3]) === JSON.stringify({ reply: 'once' })))).toBe(true);
});

test('1374:remote-attach-ui:5 Cancel stops the turn via the abort path', async ({ page }) => {
  await page.addInitScript(installRemoteFixture, baseConfig);
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId('rail-remote-computers').click();
  await page.getByTestId('remote-environment-primary').click();
  await page.getByTestId('remote-session-ses_remote_1').click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).__remoteFixtureCalls.some((c: unknown[]) => c[0] === 'request' && c[1] === 'POST' && c[2] === '/mobile-gateway/opencode/session/ses_remote_1/abort'))).toBe(true);
});

test('1374:remote-attach-ui:6 create, delete and worktree controls are disabled with an explanation', async ({ page }) => {
  await page.addInitScript(installRemoteFixture, baseConfig);
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId('rail-remote-computers').click();
  await page.getByTestId('remote-environment-primary').click();
  await page.getByTestId('remote-session-ses_remote_1').click();
  const transcript = page.getByLabel('Remote session running on Rhythm Mac');
  await expect(transcript).toContainText('New session, delete, and worktree changes aren’t available for a remote session');
  await expect(transcript.getByRole('button', { name: /new session/i })).toHaveCount(0);
  await expect(transcript.getByRole('button', { name: /delete/i })).toHaveCount(0);
  await expect(transcript.getByRole('button', { name: /worktree/i })).toHaveCount(0);
});

test('1374:remote-attach-ui:7 an offline Mac renders a distinct, actionable state', async ({ page }) => {
  await page.addInitScript(installRemoteFixture, baseConfig);
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId('rail-remote-computers').click();
  await page.getByTestId('remote-environment-kitchen').click();
  await expect(page.getByRole('alert')).toContainText('Kitchen Mac is offline');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('1374:remote-attach-ui:8 a revoked grant renders a distinct state with Reconnect', async ({ page }) => {
  await page.addInitScript(installRemoteFixture, { ...baseConfig, responses: [{ method: 'GET', path: '/mobile-gateway/opencode/experimental/session', result: { state: 'revoked' } }] });
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId('rail-remote-computers').click();
  await page.getByTestId('remote-environment-primary').click();
  await expect(page.getByRole('alert')).toContainText('revoked');
  await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
});

test('1374:remote-attach-ui:9 a 409 session_busy prompt renders a distinct busy state', async ({ page }) => {
  await page.addInitScript(installRemoteFixture, { ...baseConfig, responses: [...baseConfig.responses, { method: 'POST', path: '/mobile-gateway/opencode/session/ses_remote_1/prompt_async', result: { state: 'ok', status: 409, body: JSON.stringify({ error: 'session_busy' }) } }] });
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId('rail-remote-computers').click();
  await page.getByTestId('remote-environment-primary').click();
  await page.getByTestId('remote-session-ses_remote_1').click();
  await page.getByLabel('Message').fill('are you there?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('alert')).toContainText('busy on another device');
});

test('1374:remote-attach-ui:11 retrying a failed prompt reuses the same clientMessageId', async ({ page }) => {
  await page.addInitScript((config: typeof baseConfig) => {
    (window as any).__remoteFixtureConfig = config;
    (window as any).__remoteFixtureCalls = [];
    let promptAttempts = 0;
    (window as any).rhythmShell = {
      ...(window as any).rhythmShell,
      remoteEnvironments: {
        enabled: config.enabled,
        list: async () => { (window as any).__remoteFixtureCalls.push(['list']); return { state: 'ok', environments: (window as any).__remoteFixtureConfig.environments }; },
        connect: async (id: string) => { (window as any).__remoteFixtureCalls.push(['connect', id]); return (window as any).__remoteFixtureConfig.connect[id] ?? { state: 'error' }; },
        disconnect: async () => { (window as any).__remoteFixtureCalls.push(['disconnect']); },
        request: async (req: { method: string; path: string; body?: unknown }) => {
          (window as any).__remoteFixtureCalls.push(['request', req.method, req.path, req.body]);
          if (req.path.endsWith('/prompt_async')) {
            promptAttempts += 1;
            // First attempt is an ambiguous failure (e.g. the response was lost); the retry must
            // carry the same messageID so the server's idempotency-by-messageID cannot double-send.
            return promptAttempts === 1 ? { state: 'ok', status: 503 } : { state: 'ok', status: 200, body: '{}' };
          }
          const rules: typeof config.responses = (window as any).__remoteFixtureConfig.responses;
          const rule = rules.find((row) => row.method === req.method && row.path === req.path);
          return rule ? rule.result : { state: 'ok', status: 200, body: '[]' };
        },
        subscribe: async (sessionId: string) => { (window as any).__remoteFixtureCalls.push(['subscribe', sessionId]); return { state: 'ok', unsubscribe: async () => {} }; },
      },
    };
  }, baseConfig);
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId('rail-remote-computers').click();
  await page.getByTestId('remote-environment-primary').click();
  await page.getByTestId('remote-session-ses_remote_1').click();
  await page.getByLabel('Message').fill('are you there?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be sent');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__remoteFixtureCalls.filter((c: unknown[]) => c[0] === 'request' && (c[2] as string).endsWith('/prompt_async')).length,
  )).toBe(2);
  const messageIds = await page.evaluate(() =>
    (window as any).__remoteFixtureCalls
      .filter((c: unknown[]) => c[0] === 'request' && (c[2] as string).endsWith('/prompt_async'))
      .map((c: unknown[]) => (c[3] as { messageID?: string })?.messageID),
  );
  expect(messageIds).toHaveLength(2);
  expect(messageIds[0]).toBeTruthy();
  expect(messageIds[1]).toBe(messageIds[0]);
});

test('1374:remote-attach-ui:10 the computer list and an attached transcript have no serious or critical axe violations', async ({ page }) => {
  await page.addInitScript(installRemoteFixture, baseConfig);
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId('rail-remote-computers').click();
  let result = await new AxeBuilder({ page }).include('[aria-label="Remote computers"]').analyze();
  expect(result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
  await page.getByTestId('remote-environment-primary').click();
  await page.getByTestId('remote-session-ses_remote_1').click();
  result = await new AxeBuilder({ page }).include('[aria-label="Remote session running on Rhythm Mac"]').analyze();
  expect(result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});
