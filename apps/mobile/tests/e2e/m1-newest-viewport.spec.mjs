import { expect, test } from '@playwright/test';
import path from 'node:path';

const fakeServer = `http://127.0.0.1:${process.env.RHYTHM_MOBILE_E2E_FAKE_PORT || '44096'}`;

test('m1 viewport: first painted persisted page, prepend anchor, upward stream/jump and composer resize', async ({ page, request }) => {
  // Regression: scrollToEnd after paint flashes the oldest row; pagination or streaming then yanks readers.
  await page.setViewportSize({ width: 390, height: 844 });
  await request.post(`${fakeServer}/__control/reset`, { data: { scenario: 'happy-path' } });
  const response = await request.post(`${fakeServer}/session`, { data: { title: 'Synthetic viewport proof' } });
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  const records = Array.from({ length: 40 }, (_, index) => {
    const id = `viewport-${String(index).padStart(3, '0')}`;
    return {
      info: { id, sessionID: session.id, role: 'assistant', time: { created: 1600000000000 + index } },
      parts: [{ id: `text-${id}`, messageID: id, sessionID: session.id, type: 'text', text: `Persisted turn ${index}\n${'Synthetic safe transcript line.\n'.repeat(8)}Tail ${index}` }],
    };
  });
  const queries = [];
  await page.route(`**/session/${session.id}/message?*`, async (route) => {
    const url = new URL(route.request().url());
    queries.push(Object.fromEntries(url.searchParams));
    const before = url.searchParams.get('before');
    const end = before ? records.findIndex((record) => record.info.id === before) : records.length;
    await route.fulfill({ json: records.slice(Math.max(0, end - 20), end) });
  });
  await page.addInitScript(() => {
    window.viewportFrames = [];
    const sample = () => {
      const list = document.querySelector('[data-testid="chat-transcript"]');
      if (list && list.textContent.includes('Persisted turn')) {
        let visible = true;
        for (let node = list; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.opacity === '0' || style.display === 'none' || style.visibility === 'hidden') visible = false;
        }
        if (visible && list.clientHeight > 0 && window.viewportFrames.length < 120) {
          window.viewportFrames.push({ gap: list.scrollHeight - list.clientHeight - list.scrollTop });
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto(`/agents/chats/${session.id}?projectId=${encodeURIComponent(session.directory)}`);
  const list = page.getByTestId('chat-transcript').locator('visible=true');
  await expect.poll(() => page.evaluate(() => window.viewportFrames.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.viewportFrames[0].gap)).toBeLessThanOrEqual(2);
  expect(queries[0].limit).toBe('20');
  expect(queries[0].before).toBeUndefined();
  const gap = () => list.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  await expect.poll(gap).toBeLessThanOrEqual(2);
  if (process.env.RHYTHM_CAPTURE_EVIDENCE === '1') {
    await page.screenshot({ path: path.resolve('../../docs/ai/runs/evidence/2026-10-01-m1-first-visible-newest.png') });
  }

  await list.evaluate((node) => { node.scrollTop = 0; });
  await expect(page.getByText('Load earlier messages', { exact: true })).toBeVisible();
  const anchor = page.getByText('Persisted turn 20', { exact: false }).first();
  const top = await anchor.evaluate((node) => node.getBoundingClientRect().top);
  await page.getByText('Load earlier messages', { exact: true }).click();
  await expect.poll(() => queries.some((query) => query.before === 'viewport-020')).toBe(true);
  await expect(page.getByText(/^Persisted turn 0 /).first()).toBeAttached();
  await expect.configure({ soft: true }).poll(async () => Math.abs(await anchor.evaluate((node) => node.getBoundingClientRect().top) - top)).toBeLessThanOrEqual(2);

  const beforeStream = await list.evaluate((node) => node.scrollTop);
  await request.post(`${fakeServer}/__control/delta-burst`, { data: { sessionId: session.id, chunks: ['New viewport output'], intervalMs: 100 } });
  const jump = page.getByRole('button', { name: '1 new message. Jump to newest' });
  await expect(jump).toBeVisible();
  expect(Math.abs(await list.evaluate((node) => node.scrollTop) - beforeStream)).toBeLessThanOrEqual(2);
  await jump.click();
  await expect.poll(gap).toBeLessThanOrEqual(2);
  await expect(jump).toHaveCount(0);
  const input = page.getByPlaceholder('Ask anything...');
  await input.fill('Safe multiline draft\n'.repeat(12));
  await input.focus();
  await page.setViewportSize({ width: 390, height: 600 });
  await expect.poll(gap).toBeLessThanOrEqual(2);
  await expect(page.getByTestId('chat-primary-button')).toBeVisible();
  if (process.env.RHYTHM_CAPTURE_EVIDENCE === '1') {
    await page.screenshot({ path: path.resolve('../../docs/ai/runs/evidence/2026-10-01-m1-viewport.png') });
  }
});
