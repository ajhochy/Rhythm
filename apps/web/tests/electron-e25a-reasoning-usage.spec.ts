import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

const session = {
  id: 'reasoning-usage', name: 'Reasoning and usage', profileId: 'profile', status: 'working',
  createdAt: '2026-09-24T10:00:00Z',
};

const messages = [
  { sdkMessageId: 'empty', role: 'output', parts: [{ id: 'empty-part', type: 'reasoning', text: '' }, { id: 'space-part', type: 'reasoning', text: ' \n\t ' }] },
  { sdkMessageId: 'headline', role: 'output', parts: [{ id: 'headline-part', type: 'reasoning', text: '**Planning repository indexing and state tracking**\n\nCheck the **current state** before editing.' }] },
  { sdkMessageId: 'first-line', role: 'output', parts: [{ id: 'first-line-part', type: 'reasoning', text: '\n## Inspecting the streaming reconciliation path\n\nDetails follow.' }] },
  { sdkMessageId: 'long-label', role: 'output', parts: [{ id: 'long-label-part', type: 'reasoning', text: 'This reasoning headline is intentionally long enough that the collapsed transcript summary must truncate it instead of filling the entire row with unbounded text and losing the compact reading rhythm' }] },
  { sdkMessageId: 'inflight', role: 'output', cost: 0, tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } }, parts: [{ id: 'inflight-text', type: 'text', text: 'Still working' }] },
  { sdkMessageId: 'plan-priced', role: 'output', cost: 0, tokens: { input: 31159, output: 22, cache: { read: 30976, write: 0 } }, parts: [{ id: 'plan-text', type: 'text', text: 'Plan-priced result' }] },
  { sdkMessageId: 'priced', role: 'output', cost: 0.10543375, tokens: { input: 3390, output: 91, cache: { read: 53376, write: 7 } }, parts: [{ id: 'priced-text', type: 'text', text: 'Priced result' }] },
  { sdkMessageId: 'small-cost', role: 'output', cost: 0.0042, tokens: { input: 12, output: 3, cache: { read: 4, write: 0 } }, parts: [{ id: 'small-text', type: 'text', text: 'Small priced result' }] },
];

async function open(page: Page) {
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/ws\/agents$/, ws => { socket = ws; });
  await page.route(/https:\/\/transcript\.invalid|http:\/\/127\.0\.0\.1:711[12]/, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/agent-configs') return route.fulfill({ json: [{ id: 'profile', label: 'Profile', enabled: true }] });
    if (path === '/agent-sessions') return route.fulfill({ json: { sessions: [session] } });
    if (path === '/agent-sessions/reasoning-usage') return route.fulfill({ json: { session, messages, transcriptPage: { hasMore: false, nextCursor: null } } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/tests/electron-e22-harness.html');
  await expect(page.getByTestId('message-headline')).toBeVisible();
  await expect.poll(() => Boolean(socket)).toBe(true);
  return (event: Record<string, unknown>) => socket!.send(JSON.stringify({ v: 1, id: session.id, ...event }));
}

test('1553-empty: empty and whitespace reasoning create no row or click target', async ({ page }) => {
  await open(page);
  const message = page.getByTestId('message-empty');
  await expect(message.locator('.reasoning-block')).toHaveCount(0);
  await expect(message.locator('summary')).toHaveCount(0);
});

test('1553-stream: an empty live reasoning part appears once text arrives and updates its summary', async ({ page }) => {
  const send = await open(page);
  send({ type: 'message.updated', info: { id: 'streamed', role: 'assistant', time: { created: 1790269200000 } } });
  send({ type: 'message.part.updated', part: { id: 'streamed-part', messageID: 'streamed', type: 'reasoning', text: '' } });
  const message = page.getByTestId('message-streamed');
  await expect(message).toBeVisible();
  await expect(message.locator('.reasoning-block')).toHaveCount(0);
  send({ type: 'message.part.delta', messageId: 'streamed', partId: 'streamed-part', field: 'text', delta: '**Planning the live update**' });
  await expect(message.locator('.reasoning-block')).toBeVisible();
  await expect(message.locator('.reasoning-block summary')).toContainText('Planning the live update');
  send({ type: 'message.part.updated', part: { id: 'streamed-part', messageID: 'streamed', type: 'reasoning', text: '**Reconciled live headline**\n\nDone.', time: { end: 1790269201000 } } });
  await expect(message.locator('.reasoning-block summary')).toContainText('Reconciled live headline');
});

test('1553-label: collapsed reasoning prefers a markdown headline and strips its syntax', async ({ page }) => {
  await open(page);
  const summary = page.getByTestId('message-headline').locator('.reasoning-block summary');
  await expect(summary).toContainText('Planning repository indexing and state tracking');
  await expect(summary).not.toContainText('**');
  await expect(page.getByTestId('message-first-line').locator('.reasoning-block summary')).toContainText('Inspecting the streaming reconciliation path');
});

test('1553-label: long reasoning labels are truncated with an ellipsis', async ({ page }) => {
  await open(page);
  const label = await page.getByTestId('message-long-label').locator('.reasoning-block summary').innerText();
  expect(label).toMatch(/…$/);
  expect(label.length).toBeLessThan(100);
});

test('1553-markdown: reasoning body uses SafeMarkdown semantics', async ({ page }) => {
  await open(page);
  const block = page.getByTestId('message-headline').locator('.reasoning-block');
  await block.locator('summary').click();
  await expect(block.locator('.markdown-copy strong')).toContainText(['Planning repository indexing and state tracking', 'current state']);
  await expect(block).not.toContainText('**');
});

test('1554-inflight: an all-zero in-flight usage footer is absent', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('message-inflight').locator('.cost-line')).toHaveCount(0);
});

test('1554-plan-cost: plan-priced usage shows tokens without literal zero cost', async ({ page }) => {
  await open(page);
  const footer = page.getByTestId('message-plan-priced').locator('.cost-line');
  await expect(footer).toContainText('Input 31159 · Output 22 · Cache read 30976 · Cache write 0');
  await expect(footer).not.toContainText('Cost');
  await expect(footer).not.toContainText('$0');
});

test('1554-format: priced usage rounds raw floats and preserves small real costs', async ({ page }) => {
  await open(page);
  const priced = page.getByTestId('message-priced').locator('.cost-line');
  await expect(priced).toContainText('Cost $0.105');
  await expect(priced).not.toContainText('0.10543375');
  await expect(page.getByTestId('message-small-cost').locator('.cost-line')).toContainText('Cost $0.0042');
});

test('1554-completed: completed token counts are displayed exactly as reported', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('message-priced').locator('.cost-line')).toContainText('Input 3390 · Output 91 · Cache read 53376 · Cache write 7');
});

test('1554-tests: absent token counts do not create an empty usage placeholder', async ({ page }) => {
  const send = await open(page);
  send({ type: 'message.updated', info: { id: 'absent-usage', role: 'assistant', cost: 0, tokens: {}, time: { created: 1790269200000 } } });
  const message = page.getByTestId('message-absent-usage');
  await expect(message).toBeVisible();
  await expect(message.locator('.cost-line')).toHaveCount(0);
});
