import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

const row = (id: string) => ({ id, name: id, status: 'idle', category: 'chats', profileId: 'profile', cwd: '/test', createdAt: '2026-09-01T00:00:00Z' });
const message = (id: string) => ({ sdkMessageId: id, role: 'output', createdAt: '2026-09-01T00:00:00Z', parts: [{ id: `part-${id}`, type: 'text', text: `${id}\n${'Readable transcript line\n'.repeat(6)}` }] });
const messages = Array.from({ length: 30 }, (_, i) => message(`m${i}`));
messages[12].parts.push({ id: 'child-tool', type: 'tool', text: '' } as any);
Object.assign(messages[12].parts[1], { tool: 'task', state: { status: 'completed', input: { description: 'Child work' }, output: 'task_id: child-sdk' } });

async function open(page: Page) {
  let socket: WebSocketRoute | undefined;
  let olderRequests = 0;
  let release: (fail?: boolean) => void = () => {};
  await page.routeWebSocket(/\/ws\/agents$/, (ws) => { socket = ws; });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4185') return route.continue();
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (url.pathname === '/agent-sessions') return send({ sessions: [row('parent'), row('other')], resumable: [], pageInfo: { hasMore: false, nextCursor: null } });
    if (/\/children\/child-sdk\/messages$/.test(url.pathname)) return send({ messages });
    if (/\/messages$/.test(url.pathname)) {
      olderRequests++;
      const fail = await new Promise<boolean>((resolve) => { release = (fail = false) => resolve(fail); });
      return send(fail ? { error: 'Test page unavailable' } : { messages: Array.from({ length: 8 }, (_, i) => ({ ...message(`older${i}`), createdAt: '2026-08-31T00:00:00Z' })), pageInfo: { hasMore: true, nextCursor: 'next' } }, fail ? 503 : 200);
    }
    if (/^\/agent-sessions\/(parent|other)$/.test(url.pathname)) return send({ session: row(url.pathname.split('/').at(-1)!), messages, transcriptPage: { hasMore: true, nextCursor: 'before' } });
    if (url.pathname === '/agent-configs') return send([{ id: 'profile', label: 'Agent', enabled: true, sessionSelectable: true }]);
    if (url.pathname.endsWith('/health')) return send({ status: 'ready' });
    return send([]);
  });
  await page.goto('/agents');
  await expect(page.getByTestId('message-m29')).toBeAttached();
  await expect.poll(() => Boolean(socket)).toBe(true);
  const sendStream = (id: string) => {
    if (!messages.some((entry) => entry.sdkMessageId === id)) {
      socket!.send(JSON.stringify({ v: 1, type: 'message.updated', id: 'parent', info: { id, role: 'assistant', time: { created: Date.now() } } }));
      socket!.send(JSON.stringify({ v: 1, type: 'message.part.updated', id: 'parent', part: { id: `part-${id}`, messageID: id, type: 'text', text: '' } }));
    }
    socket!.send(JSON.stringify({ v: 1, type: 'message.part.delta', id: 'parent', messageId: id, partId: `part-${id}`, field: 'text', delta: '\nSTREAM OUTPUT\n'.repeat(20) }));
  };
  return {
    emit: async (event: Record<string, unknown>) => {
      socket!.send(JSON.stringify({ v: 1, id: 'parent', ...event }));
      await page.waitForTimeout(25);
    },
    stream: async (id = 'm29') => {
      sendStream(id);
      await expect(page.getByTestId(`message-${id}`)).toContainText('STREAM OUTPUT');
    },
    releaseWithAppend: (id: string) => { release(); sendStream(id); },
    requests: () => olderRequests, release: (fail = false) => release(fail),
  };
}
const scroller = (page: Page) => page.locator('.transcript-scroll');
const gap = (page: Page) => scroller(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
const top = (page: Page) => scroller(page).evaluate((el) => el.scrollTop);
async function readAt(page: Page, y: number) {
  await scroller(page).evaluate((el, y) => { el.scrollTop = y; el.dispatchEvent(new Event('scroll')); }, y);
}
async function anchor(page: Page) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await scroller(page).evaluate((el) => {
      const top = el.getBoundingClientRect().top;
      const item = [...el.querySelectorAll<HTMLElement>('.message')].find((message) => message.getBoundingClientRect().bottom > top);
      return item ? { id: item.dataset.testid, offset: item.getBoundingClientRect().top - top } : null;
    });
    if (result) return result;
    await page.waitForTimeout(20);
  }
  throw new Error('Transcript never rendered a visible message for anchor inspection');
}

async function trackScrollTopWrites(page: Page) {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    let writes = 0;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        if ((this as Element).classList?.contains('transcript-scroll')) writes += 1;
        descriptor.set!.call(this, value);
      },
    });
    Object.assign(window, {
      __transcriptScrollWrites: () => writes,
      __resetTranscriptScrollWrites: () => { writes = 0; },
    });
  });
}

test('E52A-c1 pinned reader follows both streamed growth and appended output', async ({ page }) => {
  const app = await open(page);
  await expect.poll(() => gap(page)).toBeLessThan(2);
  await readAt(page, await scroller(page).evaluate((el) => el.scrollHeight - el.clientHeight - 24));
  await app.stream();
  await expect.poll(() => gap(page)).toBeLessThan(2);
  await app.stream('new-message');
  await expect.poll(() => gap(page)).toBeLessThan(2);
});

test('E52A-c2 scrolled reader keeps viewport/focus; visible jump repins without live tokens', async ({ page }, info) => {
  const app = await open(page);
  await readAt(page, 1000);
  await page.getByTestId('message-m4').evaluate((el) => el.focus({ preventScroll: true }));
  const before = await top(page);
  await app.stream();
  expect(await top(page)).toBe(before);
  await expect(page.getByTestId('message-m4')).toBeFocused();
  await app.stream('new-while-reading');
  expect(await top(page)).toBe(before);
  await expect(page.getByTestId('message-m4')).toBeFocused();
  const jump = page.getByRole('button', { name: 'New output', exact: true });
  await expect(jump).toBeInViewport();
  await page.screenshot({ path: info.outputPath('new-output.png') });
  await expect(page.getByTestId('transcript')).not.toHaveAttribute('aria-live', /polite|assertive/);
  await jump.click();
  await expect.poll(() => gap(page)).toBeLessThan(2);
  await expect(scroller(page)).toBeFocused();
  await expect(jump).toHaveCount(0);
  await app.stream('new-message');
  await expect.poll(() => gap(page)).toBeLessThan(2);
});

test('E52A-c3 prepend preserves first visible message offset and keyboard focus', async ({ page }) => {
  const app = await open(page);
  await readAt(page, 0);
  await page.getByTestId('load-older').click();
  await expect.poll(app.requests).toBe(1);
  // Reader can keep reading while the network page is pending.
  await readAt(page, 1000);
  await page.getByTestId('message-m4').evaluate((el) => el.focus({ preventScroll: true }));
  const before = await anchor(page);
  app.release();
  await expect(page.getByTestId('message-older0')).toBeAttached();
  const after = await anchor(page);
  expect(after.id).toBe(before.id);
  expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('message-m4')).toBeFocused();
  await expect(page.getByRole('button', { name: 'New output', exact: true })).toHaveCount(0);
});

test('E52A-c4 older request is pending/disabled, single-flight, and recoverable on failure', async ({ page }) => {
  const app = await open(page);
  await readAt(page, 0);
  const load = page.getByTestId('load-older');
  await load.click();
  await expect(load).toBeDisabled();
  await expect(load).toContainText('Loading');
  await load.evaluate((el) => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  expect(app.requests()).toBe(1);
  app.release(true);
  await expect(page.getByRole('alert').filter({ hasText: 'Older messages could not be loaded' })).toBeVisible();
  await expect(load).toBeEnabled();
  await load.click();
  await expect.poll(app.requests).toBe(2);
  app.release();
  await expect(page.getByTestId('message-older0')).toBeAttached();
  await expect(page.getByRole('alert').filter({ hasText: 'Older messages could not be loaded' })).toHaveCount(0);
});

test('E52A-c5 session and read-only child return restore independent reader positions', async ({ page }) => {
  await open(page);
  await readAt(page, 1000);
  const before = await anchor(page);
  await page.getByTestId('session-other').click();
  await expect(page.getByTestId('transcript')).toHaveAttribute('aria-label', 'other transcript');
  await expect.poll(() => gap(page)).toBeLessThan(2);
  await readAt(page, 500);
  await page.getByTestId('session-parent').click();
  await expect(page.getByTestId('transcript')).toHaveAttribute('aria-label', 'parent transcript');
  expect(await anchor(page)).toEqual(before);
  await page.getByTestId('open-child-child-sdk').scrollIntoViewIfNeeded();
  const parentAnchor = await anchor(page);
  await page.getByTestId('open-child-child-sdk').click();
  await expect(page.getByTestId('child-back')).toBeVisible();
  await expect.poll(() => gap(page)).toBeLessThan(2);
  await readAt(page, 700);
  const childAnchor = await anchor(page);
  await page.getByTestId('child-back').click();
  await expect(page.getByTestId('transcript')).toHaveAttribute('aria-label', 'parent transcript');
  expect(await gap(page)).toBeGreaterThan(100);
  // Opening the chip scrolls it into view; parent restoration must preserve that location.
  const restored = await anchor(page);
  expect(restored.id).toBe(parentAnchor.id);
  expect(Math.abs(restored.offset - parentAnchor.offset)).toBeLessThanOrEqual(1);
  await page.getByTestId('open-child-child-sdk').click();
  await expect(page.getByTestId('child-back')).toBeVisible();
  const restoredChild = await anchor(page);
  expect(restoredChild.id).toBe(childAnchor.id);
  expect(Math.abs(restoredChild.offset - childAnchor.offset)).toBeLessThanOrEqual(1);
});

test('E52A-c6 one wheel-up unpins before the next streamed delta', async ({ page }) => {
  const app = await open(page);
  await expect.poll(() => gap(page)).toBeLessThan(2);
  const bounds = await scroller(page).boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel(0, -24);
  await expect.poll(() => gap(page)).toBeGreaterThan(0);
  expect(await gap(page)).toBeLessThanOrEqual(48);
  await app.stream();
  await expect.poll(() => gap(page)).toBeGreaterThan(50);
  await expect(page.getByRole('button', { name: 'New output', exact: true })).toBeVisible();
});

test('E52A-c7 three no-change reconciles do not announce new output', async ({ page }) => {
  const app = await open(page);
  await expect(page.getByTestId('message-m29').locator('time')).toHaveAttribute('datetime', '2026-09-01T00:00:00.000Z');
  const noChange = { type: 'message.updated', info: { id: 'm29', role: 'assistant', time: { created: Date.parse('2026-09-01T00:00:00Z') } } };
  await app.emit(noChange);
  await readAt(page, 1000);
  await expect(page.getByRole('button', { name: 'New output', exact: true })).toHaveCount(0);
  for (let index = 0; index < 3; index += 1) {
    await app.emit(noChange);
  }
  await expect(page.getByRole('button', { name: 'New output', exact: true })).toHaveCount(0);
});

test('E52A-c8 unpinned streaming performs zero scrollTop writes across 20 frames', async ({ page }) => {
  await trackScrollTopWrites(page);
  const app = await open(page);
  await readAt(page, 1000);
  await page.evaluate(() => (window as any).__resetTranscriptScrollWrites());
  for (let index = 0; index < 20; index += 1) await app.stream();
  expect(await page.evaluate(() => (window as any).__transcriptScrollWrites())).toBe(0);
  await expect(page.getByRole('button', { name: 'New output', exact: true })).toBeVisible();
});

test('E52A-c9 unpinned visible usage updates announce new output', async ({ page }) => {
  const app = await open(page);
  await app.emit({ type: 'message.updated', info: { id: 'm29', role: 'assistant', time: { created: Date.parse('2026-09-01T00:00:00Z') } } });
  await readAt(page, 1000);
  await app.emit({ type: 'message.updated', info: {
    id: 'm29', role: 'assistant', time: { created: Date.parse('2026-09-01T00:00:00Z') }, cost: 0.25,
    tokens: { input: 100, output: 25, cache: { read: 10, write: 5 } },
  } });
  await expect(page.getByTestId('message-m29')).toContainText('Cost $0.25');
  await expect(page.getByTestId('message-m29')).toContainText('Input 100 · Output 25 · Cache read 10 · Cache write 5');
  await expect(page.getByRole('button', { name: 'New output', exact: true })).toBeVisible();
});

test('E52A-c10 unpinned same-ID visible tool detail updates announce new output', async ({ page }) => {
  const app = await open(page);
  const message = page.getByTestId('message-m12');
  await app.emit({ type: 'message.part.updated', part: {
    id: 'child-tool', messageID: 'm12', type: 'tool', tool: 'task',
    state: { status: 'completed', input: { description: 'Child work' }, output: 'task_id: child-sdk' },
  } });
  await message.locator('.tool-block summary').click();
  await readAt(page, 1000);
  await app.emit({ type: 'message.part.updated', part: {
    id: 'child-tool', messageID: 'm12', type: 'tool', tool: 'task',
    state: { status: 'completed', input: { description: 'Updated child input' }, output: 'task_id: child-sdk\nUpdated child output', metadata: { phase: 'updated metadata' }, error: 'Updated child error' },
  } });
  await expect(message.locator('.tool-block')).toContainText('Updated child input');
  await expect(message.locator('.tool-block')).toContainText('Updated child output');
  await expect(message.locator('.tool-block')).toContainText('updated metadata');
  await expect(message.locator('.tool-block')).toContainText('Updated child error');
  await expect(page.getByRole('button', { name: 'New output', exact: true })).toBeVisible();
});

test('E52A-c11 concurrent prepend and append preserve anchor/focus and announce append', async ({ page }) => {
  const app = await open(page);
  await readAt(page, 0);
  await page.getByTestId('load-older').click();
  await expect.poll(app.requests).toBe(1);
  await readAt(page, 1000);
  await page.getByTestId('message-m4').evaluate((el) => el.focus({ preventScroll: true }));
  const before = await anchor(page);
  app.releaseWithAppend('new-during-prepend');
  await expect(page.getByTestId('message-older0')).toBeAttached();
  await expect(page.getByTestId('message-new-during-prepend')).toContainText('STREAM OUTPUT');
  const after = await anchor(page);
  expect(after.id).toBe(before.id);
  expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('message-m4')).toBeFocused();
  await expect(page.getByRole('button', { name: 'New output', exact: true })).toBeVisible();
});
