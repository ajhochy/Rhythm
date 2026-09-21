import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, status: 'idle', category: 'chat', projectId: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', archivedAt: null, lastActivityAt: null, lastPreview: null, ...extra });
const state = async (page: Page) => JSON.parse((await page.getByTestId('state').textContent())!);
async function open(page: Page) {
  let rows = [row('selected'), row('other')];
  let hasMore = false;
  const sockets: WebSocketRoute[] = []; const sent: any[] = []; const lists: URL[] = []; const details: string[] = [];
  await page.routeWebSocket(/\/ws\/agents$/, (ws) => { sockets.push(ws); ws.onMessage((data) => sent.push(JSON.parse(String(data)))); });
  await page.route(/https:\/\/e21.invalid|http:\/\/127.0.0.1:(4199|4197)/, (route) => {
    const url = new URL(route.request().url());
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (url.pathname === '/agent-sessions') {
      lists.push(url);
      const matching = rows.filter((r) => (url.searchParams.get('scope') === 'scheduled' ? r.category === 'scheduled' : r.category !== 'scheduled') && (url.searchParams.get('includeArchived') === 'true' || (r.archivedAt !== null) === (url.searchParams.get('archivedOnly') === 'true')));
       return send({ sessions: matching, resumable: [], ancestors: [], pageInfo: { nextCursor: hasMore ? 'bounded-next' : null, hasMore } });
    }
    if (/^\/agent-sessions\/[^/]+$/.test(url.pathname)) {
      const id = url.pathname.split('/').pop()!; details.push(id);
      return rows.some((r) => r.id === id) ? send({ session: rows.find((r) => r.id === id), messages: [{ id: 'persisted', role: 'output', parts: [{ id: 'part', type: 'text', text: 'persisted transcript' }] }] }) : send({ error: 'Session not found' }, 404);
    }
    if (url.pathname.endsWith('/health')) return send({ status: 'ready' });
    return send([]);
  });
  await page.addInitScript(() => localStorage.setItem('rhythm-agents-live-selected-session', 'selected'));
  await page.goto('/tests/electron-e21-harness.html');
  await expect.poll(async () => (await state(page)).selected.messages.length).toBe(1);
   return { sockets, sent, lists, details, rows: () => rows, replace: (next: typeof rows) => { rows = next; }, setHasMore: (next: boolean) => { hasMore = next; }, emit: (event: unknown) => sockets.at(-1)!.send(JSON.stringify(event)) };
}

test('E21-c1 canonical create/update upserts every metadata field without losing transcript or transient draft state', async ({ page }) => {
  const h = await open(page);
  await page.getByRole('button', { name: 'Prepare draft', exact: true }).click();
  h.emit({ type: 'session.status', id: 'selected', status: 'retrying', attempt: 2, reason: 'wait' });
  h.emit({ type: 'permission.asked', sessionId: 'selected', permissionID: 'perm', title: 'approve' });
  const update = row('selected', { name: 'Renamed', status: 'error', statusMessage: 'canonical error', category: 'scheduled', archivedAt: '2026-09-11T00:00:00Z', lastActivityAt: '2026-09-11T01:00:00Z', lastPreview: 'new preview', projectId: 'project-new', projectName: 'New project' });
  h.replace([update, row('other')]); h.emit({ type: 'session.updated', session: update });
  await expect.poll(async () => (await state(page)).selected).toMatchObject({ name: 'Renamed', status: 'error', statusMessage: 'canonical error', scope: 'scheduled', category: 'scheduled', group: 'archived', archivedAt: update.archivedAt, lastActivityAt: update.lastActivityAt, lastPreview: 'new preview', projectId: 'project-new', projectName: 'New project', queuedDraft: 'draft', pendingAttachments: [{ id: 'pending' }], retry: { attempt: 2, reason: 'wait' }, livePermission: { permissionID: 'perm' }, messages: [{ blocks: [{ content: 'persisted transcript' }] }] });
  for (const type of ['session.created', 'session.updated']) {
    const fresh = row(type, { name: `New ${type}` }); h.replace([...h.rows(), fresh]); h.emit({ type, session: fresh });
    await expect.poll(async () => (await state(page)).sessions.some((s: any) => s.id === type)).toBe(true);
  }
});

test('E21-c2 selected removal clears identity; input cannot fall through to first surviving row', async ({ page }) => {
  const h = await open(page);
  h.replace([row('other')]); h.emit({ type: 'session.removed', id: 'selected' });
  await expect.poll(async () => (await state(page)).selectedId).toBe('');
  expect((await state(page)).sessions.some((session: any) => session.id === 'selected')).toBe(false);
  expect((await state(page)).selected.id).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('rhythm-agents-live-selected-session'))).toBeNull();
  await page.getByRole('button', { name: 'Send probe', exact: true }).click();
  expect(h.sent.filter((event) => event.type === 'session.input')).toEqual([]);
  h.replace([]); h.emit({ type: 'session.removed', id: 'other' });
  await expect(page.getByTestId('session-other')).toHaveCount(0);
});

test('E21-c3 outage reconciles unselected membership and selected detail independently, including current scope', async ({ page }) => {
  const h = await open(page);
  await page.getByTestId('scope-scheduled').click();
  h.replace([row('selected', { name: 'Selected after outage' }), row('scheduled-new', { category: 'scheduled', name: 'External scheduled', status: 'error' })]);
  h.sockets.at(-1)!.close();
  await expect.poll(() => h.sockets.length).toBe(2);
  await expect(page.getByTestId('session-scheduled-new')).toContainText('External scheduled');
  await expect.poll(async () => (await state(page)).selected.name).toBe('Selected after outage');
  expect((await state(page)).selectedId).toBe('selected');
  h.replace([row('scheduled-new', { category: 'scheduled', name: 'Renamed while offline', archivedAt: '2026-09-11' })]);
  h.sockets.at(-1)!.close();
  await expect.poll(() => h.sockets.length).toBe(3);
  await expect.poll(async () => (await state(page)).selectedId).toBe('');
  expect((await state(page)).sessions.some((session: any) => session.id === 'selected')).toBe(false);
  await expect(page.getByTestId('session-scheduled-new')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Archived sessions' }).check();
  await expect(page.getByTestId('session-scheduled-new')).toContainText('Renamed while offline');
});

test('E21-c4 unselected metadata changes update visible preview/activity order; refresh is coalesced, never token driven', async ({ page }) => {
  const h = await open(page);
  await page.getByTestId('session-sort').selectOption('activity');
  const update = row('other', { name: 'External rename', lastPreview: 'external preview', lastActivityAt: '2026-09-11T00:00:00Z', status: 'error' });
  h.replace([row('selected'), update]);
  for (let i = 0; i < 20; i++) h.emit({ type: 'session.updated', session: update });
  await expect(page.getByTestId('session-other')).toContainText('external preview');
  await expect(page.locator('button.session-row').first()).toHaveAttribute('data-testid', 'session-other');
  await page.waitForTimeout(800);
  const before = h.lists.length;
  for (let i = 0; i < 100; i++) h.emit({ type: 'message.part.delta', id: 'selected', messageId: 'stream', partId: 'p', field: 'text', delta: 'x' });
  await expect.poll(async () => (await state(page)).selected.messages.at(-1).blocks[0].content.length).toBe(100);
  await page.waitForTimeout(800);
  expect(h.lists.length).toBe(before);
  expect(before).toBeLessThanOrEqual(5);
  expect(h.details.filter((id) => id === 'other')).toEqual([]);
});

test('subagent-tree-c3 bounded reconciliation preserves one event-created child until explicit removal', async ({ page }) => {
  const h = await open(page);
  h.setHasMore(true);
  const child = row('event-child', { name: 'Event child', parentSessionId: 'selected', status: 'working' });
  h.emit({ type: 'session.created', session: child });
  const disclosure = page.getByTestId('subagents-selected');
  await expect(disclosure).toHaveAccessibleName('selected: 1 subagent · 1 running');
  await expect(page.getByTestId('session-event-child')).toHaveCount(1);
  await expect(page.locator('button.session-row[data-testid="session-event-child"]')).toHaveCount(0);

  await page.waitForTimeout(4_300);
  await expect(page.getByTestId('session-event-child')).toHaveCount(1);
  h.emit({ type: 'session.status', id: 'event-child', working: false });
  await expect(disclosure).toHaveAccessibleName('selected: 1 subagent');
  h.emit({ type: 'session.status', id: 'event-child', working: true });
  await expect(disclosure).toHaveAccessibleName('selected: 1 subagent · 1 running');
  await expect(page.getByTestId('session-event-child')).toHaveCount(1);

  await disclosure.press('Space');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  h.emit({ type: 'session.updated', session: { ...child, name: 'Updated child', status: 'idle' } });
  await expect(disclosure).toHaveAccessibleName('selected: 1 subagent');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('session-event-child')).toHaveCount(0);
  expect((await state(page)).selectedId).toBe('selected');

  h.emit({ type: 'session.removed', id: 'event-child' });
  await expect(disclosure).toHaveCount(0);
  expect((await state(page)).sessions.filter((session: any) => session.id === 'event-child')).toHaveLength(0);
});

test('subagent-counts-c3 exact totals update during reconciliation without resetting collapse', async ({ page }) => {
  const h = await open(page);
  const parent = row('counted-parent', { childCount: 164, runningChildCount: 38, hasChildren: true });
  h.replace([...h.rows(), parent]);
  h.emit({ type: 'session.created', session: parent });
  const disclosure = page.getByTestId('subagents-counted-parent');
  await expect(disclosure).toHaveAccessibleName('counted-parent: 164 subagents · 38 running');
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  const updated = { ...parent, childCount: 165, runningChildCount: 39 };
  h.replace([...h.rows().filter((row) => row.id !== parent.id), updated]);
  h.emit({ type: 'session.updated', session: updated });
  await expect(disclosure).toHaveAccessibleName('counted-parent: 165 subagents · 39 running');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
});

test('subagent-tree-c4 complete active and archived snapshots remove an absent event-created child', async ({ page }) => {
  const h = await open(page);
  const child = row('stale-child', { parentSessionId: 'selected', status: 'working' });
  h.emit({ type: 'session.created', session: child });
  await expect(page.getByTestId('subagents-selected')).toHaveAccessibleName('selected: 1 subagent · 1 running');

  await expect.poll(async () => (await state(page)).sessions.some((session: any) => session.id === 'stale-child'), { timeout: 5_000 }).toBe(false);
  await expect(page.getByTestId('subagents-selected')).toHaveCount(0);
});

// Workstream C — the #930 cross-provider fallback cascade is server-side, but
// it announces every hop with `session.spillover`
// (apps/api_server/src/services/turn_redispatch.ts advanceFallbackCascade →
// notifyDecision). The Electron renderer previously ignored that frame
// entirely, so a cascade that DID run was invisible and read as "fallback
// doesn't work on Electron". These assert the user-visible outcome.
test('fallback-c1 a rate-limit cascade hop is announced to the user with its destination tier', async ({ page }) => {
  const h = await open(page);
  h.emit({
    v: 1, type: 'session.spillover', sessionId: 'selected',
    fromAccountId: 'team', toAccountId: null, reason: 'rate_limit_cross_provider',
    toProvider: 'openai', toModel: 'gpt-5.6-sol', toTier: 'Codex',
  });
  await expect.poll(async () => (await state(page)).toast?.message).toContain('Codex');
  expect((await state(page)).toast.message).toContain('limit');
});

test('fallback-c2 an auth cascade hop says re-authentication, not rate limit', async ({ page }) => {
  const h = await open(page);
  h.emit({
    v: 1, type: 'session.spillover', sessionId: 'selected',
    fromAccountId: 'personal', toAccountId: null, reason: 'auth_cross_provider',
    toProvider: 'openai', toModel: 'gpt-5.6-sol', toTier: 'Codex',
  });
  await expect.poll(async () => (await state(page)).toast?.message).toContain('re-authentication');
  expect((await state(page)).toast.message).not.toContain('limit');
});

test('fallback-c3 a same-provider Anthropic account failover names the destination account', async ({ page }) => {
  const h = await open(page);
  h.emit({
    v: 1, type: 'session.spillover', sessionId: 'selected',
    fromAccountId: 'personal', toAccountId: 'team', reason: 'rate_limited',
  });
  await expect.poll(async () => (await state(page)).toast?.message).toContain('team');
});
