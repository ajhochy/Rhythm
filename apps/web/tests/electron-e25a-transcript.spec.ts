import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
const source = '# Report\n\n- First\n- Second\n\n[Docs](https://example.com) [Bad](javascript:alert(1))\n\n```ts\nconst x = 1;\n```\n\n| Name | Value |\n| --- | --- |\n| A | 2 |\n\n<script>alert(1)</script>';
const tool = { id: 'tool', type: 'tool', tool: 'mcp_demo', callID: 'call-1', state: { status: 'error', input: { query: 'actual argument' }, output: 'actual output', error: 'actual failure', metadata: { content: [{ type: 'resource', resource: { uri: 'ui://demo', mimeType: 'text/html', text: '<h1>App</h1>' } }], _meta: { ui: { resourceUri: 'ui://demo' } } } } };
async function open(page: Page) {
  let socket: WebSocketRoute;
  const session = { id: 'e25a', name: 'E25A', profileId: 'profile', status: 'idle', createdAt: '2026-09-11T00:00:00Z' };
  const message = { sdkMessageId: 'm1', role: 'output', cost: 0.25, tokens: { input: 11, output: 22, cache: { read: 33, write: 44 } }, parts: [{ id: 'text', type: 'text', text: source }, tool] };
  await page.routeWebSocket(/\/ws\/agents$/, ws => { socket = ws; });
  await page.route(/https:\/\/e25a.invalid|http:\/\/127.0.0.1:(4199|4197)/, route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/agent-configs' ? [{ id: 'profile', label: 'Profile', enabled: true }] : path === '/agent-sessions' ? { sessions: [session] } : path === '/agent-sessions/e25a' ? { session, messages: [message] } : path.includes('/children/') ? { messages: [message] } : [] });
  });
  await page.goto('/tests/electron-e22-harness.html');
  await expect(page.getByTestId('message-m1')).toBeVisible();
  return (event: object) => socket!.send(JSON.stringify({ id: 'e25a', ...event }));
}
test('E25A-c1 REST and message.updated preserve role/cost/all token fields without erasing parts', async ({ page }) => {
  const send = await open(page);
  await expect(page.getByTestId('state')).toContainText('"cost":0.25');
  send({ type: 'message.updated', info: { id: 'm1', role: 'user', cost: 0.5, tokens: { input: 101, output: 202, cache: { read: 303, write: 404 } }, time: { created: 1789084800000 } } });
  await expect(page.getByTestId('message-m1').locator('.message-role')).toHaveText('You');
  for (const value of ['"cost":0.5', '"input":101', '"output":202', '"read":303', '"write":404']) await expect(page.getByTestId('state')).toContainText(value);
  await expect(page.getByTestId('message-m1')).toContainText('Report');
});
test('E25A-c2 removed message disappears and ws error preserves readable transcript', async ({ page }) => {
  const send = await open(page);
  send({ type: 'error', message: 'Provider unavailable' });
  await expect(page.getByRole('alert').filter({ hasText: 'Provider unavailable' })).toBeVisible();
  await expect(page.getByTestId('message-m1')).toBeVisible();
  send({ type: 'message.removed', messageId: 'm1' });
  await expect(page.getByTestId('message-m1')).toHaveCount(0);
});
test('E25A-c3 tool details show actual arguments/output/metadata/error, never fabricated success', async ({ page }) => {
  await open(page); const block = page.getByTestId('message-m1').locator('.tool-block'); await block.locator('summary').click();
  for (const text of ['actual argument', 'actual output', 'actual failure', 'ui://demo']) await expect(block).toContainText(text);
  await expect(block).not.toContainText('fixture source loaded successfully');
});
test('E25A-c4 canonical MCP envelopes/resources survive gateway consumption', async ({ page }) => {
  await open(page);
  const state = JSON.parse(await page.getByTestId('state').innerText());
  expect(state.selected.messages[0].blocks[1].tool).toEqual({ name: 'mcp_demo', callId: 'call-1', ...tool.state });
});
test('E25A-c5 safe semantic markdown and disabled external link, no HTML execution', async ({ page }) => {
  await open(page); const msg = page.getByTestId('message-m1');
  await expect(msg.getByRole('heading', { name: 'Report' })).toBeVisible();
  await expect(msg.locator('li')).toHaveText(['First', 'Second']);
  await expect(msg.getByRole('table')).toContainText('Value');
  await expect(msg.locator('pre code')).toHaveText('const x = 1;\n');
  await expect(msg.getByRole('link', { name: /Docs/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(msg).toContainText('External link opening unavailable');
  await expect(msg.locator('[href^="javascript:"], script, iframe')).toHaveCount(0);
});
test('E25A-c6 copies canonical markdown and fenced code exactly', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const x = 1;\n');
  await page.getByTestId('copy-m1').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${source}\n\n${JSON.stringify({ name: 'mcp_demo', callId: 'call-1', ...tool.state }, null, 2)}`);
});

test('E25A-c5/c6 ephemeral child uses the same safe renderer and canonical copy', async ({ page }) => {
  const send = await open(page);
  send({ type: 'message.part.updated', messageId: 'child-link', partId: 'child-part', part: { type: 'tool', tool: 'task', state: { status: 'completed', input: { description: 'Child' }, output: 'task_id: ses_child' } } });
  await page.getByTestId('open-child-ses_child').click();
  const msg = page.getByTestId('message-m1');
  await expect(msg.getByRole('heading', { name: 'Report' })).toBeVisible();
  await expect(msg.getByRole('table')).toContainText('Value');
  await expect(msg.locator('[href], script, iframe')).toHaveCount(0);
  await page.getByTestId('copy-m1').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${source}\n\n${JSON.stringify({ name: 'mcp_demo', callId: 'call-1', ...tool.state }, null, 2)}`);
});
test('E25A-c7 full part replaces deltas without duplicate content and metadata keeps blocks', async ({ page }) => {
  const send = await open(page);
  send({ type: 'message.part.delta', messageId: 'm2', partId: 'p2', field: 'text', delta: 'Hello' });
  send({ type: 'message.part.updated', messageId: 'm2', partId: 'p2', part: { type: 'text', text: 'Hello world' } });
  send({ type: 'message.updated', info: { id: 'm2', role: 'assistant', cost: 0.125 } });
  await expect(page.getByTestId('message-m2').locator('.markdown-copy')).toHaveText('Hello world');
  await expect(page.getByTestId('state')).toContainText('"cost":0.125');
});
