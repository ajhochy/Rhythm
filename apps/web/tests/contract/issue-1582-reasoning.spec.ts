import { readFileSync } from 'node:fs';
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

type Frame = Record<string, unknown> & { type: string };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/transcript/${name}.jsonl`, import.meta.url), 'utf8').trim().split('\n')[0]) as { frames: Frame[] };
const row = (id: string) => ({ id, name: id, status: 'idle', category: 'chats', profileId: 'profile', cwd: '/test', createdAt: '2026-09-24T10:00:00Z' });
const capturedEvents = new Set(['message.updated', 'message.part.updated', 'message.part.delta', 'message.removed', 'message.part.removed', 'session.status', 'error']);

async function open(page: Page, child = false) {
  let socket: WebSocketRoute | undefined;
  const parentMessages = child ? [{
    sdkMessageId: 'msg_parent', role: 'output', createdAt: '2026-09-24T10:00:00Z',
    parts: [{ id: 'prt_child', type: 'tool', tool: 'task', state: { status: 'completed', input: { description: 'Child reasoning' }, output: 'task_id: child-sdk' } }],
  }] : [];
  await page.routeWebSocket(/\/ws\/agents$/, ws => { socket = ws; });
  await page.route(/^(?:http:\/\/127\.0\.0\.1:(?:4098|4198|6832)|https:\/\/api\.vcrcapps\.com)\//, async route => {
    const url = new URL(route.request().url());
    const send = (json: unknown) => route.fulfill({ json });
    if (url.pathname === '/agent-sessions') return send({ sessions: [row('parent'), row('other')], pageInfo: { hasMore: false, nextCursor: null } });
    if (url.pathname === '/agent-sessions/parent') return send({ session: row('parent'), messages: parentMessages, transcriptPage: { hasMore: false, nextCursor: null } });
    if (url.pathname === '/agent-sessions/other') return send({ session: row('other'), messages: [], transcriptPage: { hasMore: false, nextCursor: null } });
    if (url.pathname.endsWith('/children/child-sdk/messages')) return send({ messages: [
      { sdkMessageId: 'child-valid', role: 'output', createdAt: '2026-09-24T13:01:00Z', parts: [{ id: 'child-valid-text', type: 'text', text: 'Valid child time' }] },
      { sdkMessageId: 'child-invalid', role: 'output', createdAt: 'not-a-time', parts: [{ id: 'child-invalid-text', type: 'text', text: 'Invalid child time' }] },
    ] });
    if (url.pathname === '/agent-configs') return send([{ id: 'profile', label: 'Agent', enabled: true, sessionSelectable: true }]);
    if (url.pathname.includes('health')) return send({ healthy: true, status: 'ready' });
    return send([]);
  });
  await page.route('http://127.0.0.1:6833/**', route => route.fulfill({ json: { healthy: true } }));
  await page.goto('/agents');
  await expect(page.getByTestId('session-parent')).toBeVisible();
  await expect.poll(() => Boolean(socket)).toBe(true);
  const send = async (frame: Frame) => {
    socket!.send(JSON.stringify({ ...frame, id: 'parent' }));
    await page.waitForTimeout(50);
  };
  const replay = async (name: string, through = Number.POSITIVE_INFINITY) => {
    const frames = fixture(name).frames.filter(frame => capturedEvents.has(frame.type));
    for (let index = 0; index < frames.length && index <= through; index += 1) await send(frames[index]);
    return frames;
  };
  return { send, replay };
}

test('1582:live-thinking-presentation:1 captured reasoning grows before completion', async ({ page }) => {
  const app = await open(page);
  const frames = fixture('reasoning').frames.filter(frame => capturedEvents.has(frame.type));
  const firstDelta = frames.findIndex(frame => frame.type === 'message.part.delta');
  for (let index = 0; index <= firstDelta; index += 1) await app.send(frames[index]);
  const reasoning = page.locator('.reasoning-block');
  await expect(reasoning).toContainText('Plan');
  const first = await reasoning.innerText();
  await app.send(frames[firstDelta + 1]);
  const second = await reasoning.innerText();
  expect(second.length).toBeGreaterThan(first.length);
  expect(frames.slice(0, firstDelta + 2).some(frame => frame.type === 'session.status' && frame.working === false)).toBe(false);
});

test('1582:live-thinking-presentation:2 streaming defaults open and manual collapse survives deltas and session switches', async ({ page }) => {
  const app = await open(page);
  const frames = fixture('reasoning').frames.filter(frame => capturedEvents.has(frame.type));
  const deltas = frames.reduce<number[]>((indexes, frame, index) => frame.type === 'message.part.delta' ? [...indexes, index] : indexes, []);
  for (let index = 0; index <= deltas[0]; index += 1) await app.send(frames[index]);
  const reasoning = page.locator('.reasoning-block');
  await expect(reasoning).toHaveAttribute('open', '');
  await reasoning.locator('summary').click();
  await expect(reasoning).not.toHaveAttribute('open', '');
  await app.send(frames[deltas[1]]);
  await expect(reasoning).not.toHaveAttribute('open', '');
  await page.getByTestId('session-other').click();
  await page.getByTestId('session-parent').click();
  await expect(reasoning).not.toHaveAttribute('open', '');
});

test('1582:live-thinking-presentation:3 long reasoning is keyboard-expandable and visually subordinate', async ({ page }) => {
  const app = await open(page);
  await app.send({ type: 'message.updated', info: { id: 'msg_long', role: 'assistant', time: { created: 1790254332901 } } });
  await app.send({ type: 'message.part.updated', part: { id: 'prt_reasoning', messageID: 'msg_long', type: 'reasoning', text: '' } });
  await app.send({ type: 'message.part.delta', messageId: 'msg_long', partId: 'prt_reasoning', field: 'text', delta: 'Long thought '.repeat(100) });
  await app.send({ type: 'message.part.updated', part: { id: 'prt_answer', messageID: 'msg_long', type: 'text', text: 'Readable answer' } });
  const showMore = page.locator('.reasoning-show-more');
  await expect(showMore).toHaveText('Show more');
  await showMore.focus();
  await showMore.press('Enter');
  await expect(showMore).toHaveAttribute('aria-expanded', 'true');
  await expect(showMore).toHaveText('Show less');
  const styles = await page.evaluate(() => {
    const reasoning = getComputedStyle(document.querySelector<HTMLElement>('.reasoning-content .markdown-copy')!);
    const answer = getComputedStyle(document.querySelector<HTMLElement>('.message-blocks > .markdown-copy')!);
    return { reasoningSize: Number.parseFloat(reasoning.fontSize), answerSize: Number.parseFloat(answer.fontSize), reasoningColor: reasoning.color, answerColor: answer.color };
  });
  expect(styles.reasoningSize).toBeLessThan(styles.answerSize);
  expect(styles.reasoningColor).not.toBe(styles.answerColor);
});

test('1582:live-thinking-presentation:4 plain and error captures never fabricate reasoning', async ({ page }) => {
  const app = await open(page);
  await app.replay('plain');
  await expect(page.locator('.reasoning-block')).toHaveCount(0);
  await app.replay('error');
  await expect(page.locator('.reasoning-block')).toHaveCount(0);
});

test('1582:live-thinking-presentation:5 child transcript timestamps preserve valid ISO and degrade invalid values', async ({ page }) => {
  await open(page, true);
  await page.getByTestId('open-child-child-sdk').click();
  await expect(page.getByTestId('message-child-valid').locator('time')).toHaveAttribute('datetime', '2026-09-24T13:01:00.000Z');
  await expect(page.getByTestId('message-child-invalid').locator('[data-timestamp-fallback]')).toContainText('Time unavailable');
});
