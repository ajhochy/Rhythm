import { mkdir } from 'node:fs/promises';
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

// Real renderer/gateway/xterm; only HTTP and WebSocket boundaries are intercepted.
const sessions = ['a', 'b'].map((id) => ({ id, name: `Terminal ${id}`, status: 'idle', category: 'chat', cwd: `/synthetic/${id}`, createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z', profileId: 'profile' }));
async function open(page: Page, failCreate = false) {
  const creates: string[] = [], deletes: string[] = [], inputs: string[] = [], sizes: { cols: number; rows: number }[] = [];
  const sockets = new Map<string, WebSocketRoute>(); const closed: string[] = [];
  await page.routeWebSocket(/\/ws\/agents$/, () => {});
  await page.routeWebSocket(/\/ws\/pty\//, (ws) => {
    const id = new URL(ws.url()).pathname.split('/').at(-1)!;
    sockets.set(id, ws); ws.onClose(() => closed.push(id));
    ws.onMessage((data) => inputs.push(`${id}:${data}`));
    ws.send(`\x1b[32mOUTPUT_${id}\x1b[0m\r\n`);
  });
  await page.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === 'http://127.0.0.1:4184') return route.continue();
    if (!['http://127.0.0.1:4199', 'http://127.0.0.1:4197', 'https://e27.invalid'].includes(url.origin)) return route.abort();
    const send = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (/\/agent-sessions\/[^/]+\/pty$/.test(url.pathname)) {
      expect(req.method()).toBe('POST'); expect(req.headers().authorization).toBeUndefined();
      creates.push(url.pathname); if (failCreate) { failCreate = false; return send({ error: 'Synthetic create failure' }, 503); }
      return send({ ptyId: `${url.pathname.split('/')[2]}-${creates.length}` });
    }
    if (url.pathname.startsWith('/pty/')) {
      if (req.method() === 'DELETE') { deletes.push(url.pathname); return route.fulfill({ status: 204 }); }
      expect(req.method()).toBe('PATCH'); sizes.push(req.postDataJSON()); return send({ ok: true });
    }
    if (url.pathname === '/agent-sessions') return send({ sessions, resumable: [], pageInfo: { hasMore: false, nextCursor: null } });
    if (/^\/agent-sessions\/[ab]$/.test(url.pathname)) return send({ session: sessions.find((s) => url.pathname.endsWith(s.id)), messages: [] });
    if (url.pathname === '/agent-configs') return send([{ id: 'profile', label: 'Synthetic agent', enabled: true, sessionSelectable: true }]);
    if (url.pathname.startsWith('/agent-run-outcomes')) return send({ error: 'No outcome' }, 404);
    if (url.pathname.includes('health')) return send({ status: 'ready' });
    return send([]);
  });
  await page.goto('/agents'); await page.getByTestId('session-a').click();
  await page.getByTestId('inspector-terminal').click();
  return { creates, deletes, inputs, sizes, sockets, closed };
}
const output = (page: Page) => page.locator('[data-testid="terminal-panel"] .xterm-rows');

test('E27-c1 selected local session creates a real gateway PTY, not fixture output', async ({ page }) => {
  const state = await open(page);
  await expect(output(page)).toContainText('OUTPUT_a-1');
  expect(state.creates).toEqual(['/agent-sessions/a/pty']);
  await expect(page.getByTestId('terminal-panel')).not.toContainText('Fixture');
  await mkdir('../../docs/ai/runs/artifacts/e27', { recursive: true });
  await page.getByTestId('terminal-panel').screenshot({ path: '../../docs/ai/runs/artifacts/e27/live-terminal.png' });
});
test('E27-c2 xterm consumes ANSI, sends input/Ctrl-C and resizes the PTY', async ({ page }) => {
  const state = await open(page); await expect(output(page)).toContainText('OUTPUT_a-1');
  await expect(output(page)).not.toContainText('[32m');
  await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.type('pwd'); await page.keyboard.press('Enter'); await page.keyboard.press('Control+c');
  await expect.poll(() => state.inputs.join('')).toContain('a-1:\r');
  expect(state.inputs).toContain('a-1:\u0003');
  expect(state.inputs.filter((s) => /a-1:[pwd]$/.test(s))).toEqual(['a-1:p', 'a-1:w', 'a-1:d']);
  await expect.poll(() => state.sizes.length).toBeGreaterThan(0);
  const before = state.sizes.at(-1)!; expect(before.cols).toBeGreaterThan(1); expect(before.rows).toBeGreaterThan(1);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect.poll(() => state.sizes.at(-1)?.rows).not.toBe(before.rows);
});
test('E27-c3 tab/collapse/session changes preserve the terminal and isolate output', async ({ page }) => {
  const state = await open(page); await expect(output(page)).toContainText('OUTPUT_a-1');
  await page.getByTestId('inspector-context').click(); state.sockets.get('a-1')!.send('A_BACKGROUND\r\n');
  await page.getByTestId('inspector-terminal').click(); await expect(output(page)).toContainText('A_BACKGROUND');
  await page.getByTestId('inspector-collapse').click(); state.sockets.get('a-1')!.send('A_COLLAPSED\r\n');
  await page.getByTestId('inspector-expand').click(); await expect(output(page)).toContainText('A_COLLAPSED');
  expect(sessions[0].cwd).not.toBe(sessions[1].cwd);
  await page.getByTestId('session-b').click(); await expect(output(page)).toContainText('OUTPUT_b-2');
  state.sockets.get('a-1')!.send('A_ONLY\r\n'); await expect(output(page)).not.toContainText('A_ONLY');
  await page.getByTestId('session-a').click(); await expect(output(page)).toContainText('A_ONLY'); await expect(output(page)).not.toContainText('OUTPUT_b');
  expect(state.creates).toEqual(['/agent-sessions/a/pty', '/agent-sessions/b/pty']); expect(state.deletes).toEqual([]); expect(state.closed).toEqual([]);
});
test('E27-c4 failure/retry and exit/New produce usable terminals', async ({ page }) => {
  const state = await open(page, true); await expect(page.getByTestId('terminal-panel')).toContainText('503');
  await page.getByTestId('terminal-retry').click(); await expect(output(page)).toContainText('OUTPUT_a-2');
  state.sockets.get('a-2')!.close({ code: 1000 }); await expect(page.getByTestId('terminal-panel')).toContainText('exited');
  await page.getByTestId('terminal-new').click(); await expect(output(page)).toContainText('OUTPUT_a-3');
  expect(state.deletes).toContain('/pty/a-2');
});
test('E27-c5 Close deletes PTY and disposes socket, New starts clean', async ({ page }) => {
  const state = await open(page); await expect(output(page)).toContainText('OUTPUT_a-1');
  await page.getByTestId('terminal-close').click();
  await expect.poll(() => state.deletes).toEqual(['/pty/a-1']); await expect.poll(() => state.closed).toEqual(['a-1']);
  await expect(page.locator('.xterm')).toHaveCount(0);
  await page.getByTestId('terminal-new').click(); await expect(output(page)).toContainText('OUTPUT_a-2'); await expect(output(page)).not.toContainText('OUTPUT_a-1');
});
