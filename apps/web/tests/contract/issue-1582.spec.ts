import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

// These tests exercise the real React store under main.tsx's StrictMode and fake only
// the gateway transport. They catch store refs being mutated inside a replayable
// setState updater: React replays the updater, so a streamed fragment can be reduced
// twice and appear twice in the user-visible part.
const session = (id: string) => ({
  id, name: id, status: 'idle', category: 'chats', profileId: 'profile', cwd: '/test',
  createdAt: '2026-09-24T10:00:00Z',
});

async function open(page: Page, seedPart = true) {
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/ws\/agents$/, ws => { socket = ws; });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:6831') return route.continue();
    const send = (json: unknown) => route.fulfill({ json });
    if (url.pathname === '/agent-sessions') {
      return send({ sessions: [session('parent'), session('other')], resumable: [], pageInfo: { hasMore: false, nextCursor: null } });
    }
    if (/^\/agent-sessions\/(parent|other)$/.test(url.pathname)) {
      const id = url.pathname.split('/').at(-1)!;
      const messages = id === 'other' ? [{ sdkMessageId: 'msg_other', role: 'output', createdAt: '2026-09-24T10:01:00Z', parts: [{ id: 'prt_other', type: 'text', text: 'Other session transcript' }] }] : [];
      return send({ session: session(id), messages, transcriptPage: { hasMore: false, nextCursor: null } });
    }
    if (url.pathname === '/agent-configs') return send([{ id: 'profile', label: 'Agent', enabled: true, sessionSelectable: true }]);
    if (url.pathname.endsWith('/health')) return send({ status: 'ready' });
    return send([]);
  });
  await page.goto('/agents');
  await expect(page.getByTestId('session-parent')).toBeVisible();
  await expect.poll(() => Boolean(socket)).toBe(true);
  const send = async (event: Record<string, unknown>) => {
    socket!.send(JSON.stringify({ v: 1, id: 'parent', ...event }));
    await page.waitForTimeout(50);
  };
  await send({ type: 'message.updated', info: { id: 'msg_live_1582', role: 'assistant', time: { created: 1790269200000 } } });
  if (seedPart) await send({ type: 'message.part.updated', part: { id: 'prt_live_1582', messageID: 'msg_live_1582', type: 'text', text: '' } });
  return { send };
}

function renderedText(page: Page) {
  return page.getByTestId('message-msg_live_1582');
}

function occurrences(value: string, fragment: string) {
  return value.split(fragment).length - 1;
}

test('issue-1582-c3: each streamed fragment appears once in engine order in one stable message/part', async ({ page }) => {
  const app = await open(page);
  await app.send({ type: 'message.part.delta', messageId: 'msg_live_1582', partId: 'prt_live_1582', field: 'text', delta: 'first fragment ' });
  await app.send({ type: 'message.part.delta', messageId: 'msg_live_1582', partId: 'prt_live_1582', field: 'text', delta: 'second fragment' });

  const message = renderedText(page);
  await expect(message).toContainText('first fragment second fragment');
  const text = await message.innerText();
  expect(occurrences(text, 'first fragment')).toBe(1);
  expect(occurrences(text, 'second fragment')).toBe(1);
  await expect(page.getByTestId('transcript').locator('[data-testid="message-msg_live_1582"]')).toHaveCount(1);
  await expect(message.locator('.message-blocks > *')).toHaveCount(1);
});

test('issue-1582-c6: returning to a session restores streamed text once and in order', async ({ page }) => {
  const app = await open(page);
  await app.send({ type: 'message.part.delta', messageId: 'msg_live_1582', partId: 'prt_live_1582', field: 'text', delta: 'before switch ' });
  await app.send({ type: 'message.part.delta', messageId: 'msg_live_1582', partId: 'prt_live_1582', field: 'text', delta: 'after switch' });
  await page.getByTestId('session-other').click();
  await expect(page.getByTestId('transcript')).toHaveAttribute('aria-label', 'other transcript');
  await page.getByTestId('session-parent').click();

  const message = renderedText(page);
  await expect(message).toContainText('before switch after switch');
  const text = await message.innerText();
  expect(occurrences(text, 'before switch')).toBe(1);
  expect(occurrences(text, 'after switch')).toBe(1);
  await expect(page.getByTestId('transcript').locator('[data-testid="message-msg_live_1582"]')).toHaveCount(1);
});


test('issue-1582-c3: fragments arriving before part metadata render once', async ({ page }) => {
  const app = await open(page, false);
  await app.send({ type: 'message.part.delta', messageId: 'msg_live_1582', partId: 'prt_live_1582', field: 'text', delta: 'early fragment ' });
  await app.send({ type: 'message.part.delta', messageId: 'msg_live_1582', partId: 'prt_live_1582', field: 'text', delta: 'later fragment' });
  await app.send({ type: 'message.part.updated', part: { id: 'prt_live_1582', messageID: 'msg_live_1582', type: 'text', text: '' } });
  const message = renderedText(page);
  await expect(message).toContainText('early fragment later fragment');
  const text = await message.innerText();
  expect(occurrences(text, 'early fragment')).toBe(1);
  expect(occurrences(text, 'later fragment')).toBe(1);
});
