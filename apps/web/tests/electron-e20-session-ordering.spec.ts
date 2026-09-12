import { expect, test, type Page } from '@playwright/test';
import { compareSessions, toSessionViewModel, createLiveSessionsGateway } from '../src/gateway/sessions';

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, status: 'idle', category: 'chat', projectId: 'p1',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
  lastActivityAt: null, lastPreview: null, archivedAt: null, parentSessionId: null,
  profileId: 'profile', cwd: '/test', ...extra,
});
const roots = [
  row('z', { name: 'alpha', createdAt: '2026-09-01T01:00:00+02:00', status: 'working', hasChildren: true }),
  row('a', { name: 'Alpha', createdAt: '2026-09-01T00:30:00Z', status: 'closed', lastActivityAt: '2026-09-09T00:00:00Z', projectId: 'p2' }),
  row('b', { name: 'Beta', createdAt: '2026-09-01T00:30:00Z', status: 'starting', lastPreview: 'needle preview' }),
  row('r', { status: 'resumable' }),
];
const children = [row('c2', { name: 'zulu', parentSessionId: 'z', createdAt: '2026-09-02T00:00:00Z', status: 'idle' }), row('c1', { name: 'Able', parentSessionId: 'z', status: 'working', lastActivityAt: '2026-09-10T00:00:00Z' })];
const pageOf = (sessions: unknown[], nextCursor: string | null = null, ancestors: unknown[] = []) => ({ sessions, ancestors, resumable: [], pageInfo: { limit: 100, nextCursor, hasMore: !!nextCursor, expiresAt: '2099-01-01T00:00:00Z' } });

test('E20-c1 canonical DTO fields are not replaced by presentation defaults', () => {
  const input = row('dto', { category: 'self_improvement', lastActivityAt: '2026-09-08T12:00:00Z', lastPreview: 'canonical preview', archivedAt: '2026-09-09T00:00:00Z' });
  expect(toSessionViewModel(input)).toMatchObject({ lastActivityAt: input.lastActivityAt, lastPreview: input.lastPreview, category: 'self_improvement', archivedAt: input.archivedAt, projectId: 'p1', projectName: '', scope: 'background', group: 'archived' });
});

test('E20-c6 closed stays active, archived and resumable remain distinct', () => {
  expect(toSessionViewModel(row('closed', { status: 'closed' })).group).toBe('active');
  expect(toSessionViewModel(row('resume', { status: 'resumable' })).group).toBe('resumable');
  expect(toSessionViewModel(row('archive', { status: 'resumable', archivedAt: '2026-09-09' })).group).toBe('archived');
});

test('E20-c2-status full rank and equal-status activity/ID ties never depend on input order', () => {
  const rows = ['resumable', 'closed', 'error', 'idle', 'starting', 'working'].map((status) => toSessionViewModel(row(status, { status })));
  rows.push(toSessionViewModel(row('idle-recent', { status: 'idle', lastActivityAt: '2026-09-09' })), toSessionViewModel(row('idle-equal', { status: 'idle' })));
  const expected = ['working', 'starting', 'idle-recent', 'idle', 'idle-equal', 'error', 'closed', 'resumable'];
  expect(rows.sort((a, b) => compareSessions(a, b, 'status')).map((s) => s.id)).toEqual(expected);
  expect(rows.reverse().sort((a, b) => compareSessions(a, b, 'status')).map((s) => s.id)).toEqual(expected);
});

test('E20-c10 legacy trees and separate resumable response survive paging adapter', async () => {
  const gateway = createLiveSessionsGateway('http://e20.invalid', 'test', async () => new Response(JSON.stringify({ sessions: [{ ...row('root'), children }], resumable: [row('resume', { status: 'resumable' })] })), class {} as typeof WebSocket);
  expect(typeof (gateway as any).listPage).toBe('function');
  if (!(gateway as any).listPage) return;
  const result = await (gateway as any).listPage({ scope: 'chats' });
  expect(result.sessions.map((s: any) => s.id)).toEqual(['root', 'c2', 'c1', 'resume']);
  expect(result.pageInfo).toEqual({ nextCursor: null, hasMore: false });
});

async function open(page: Page, options: { expired?: boolean; hundred?: boolean } = {}) {
  const requests: URL[] = []; const unexpected: string[] = [];
  await page.routeWebSocket(/\/ws\/agents$/, () => {});
  await page.route('**/*', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (url.origin === 'http://127.0.0.1:4186') return route.continue();
    if (!['http://127.0.0.1:4199', 'http://127.0.0.1:4197', 'https://e20.invalid'].includes(url.origin)) { unexpected.push(url.href); return route.abort(); }
    const send = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (req.method() !== 'GET') { unexpected.push(`${req.method()} ${url}`); return route.abort(); }
    if (url.pathname === '/agent-sessions') {
      // createLiveGateway's localFetcher deliberately strips the cloud bearer.
      expect(req.headers().authorization).toBeUndefined();
      expect([...url.searchParams.keys()].every((key) => ['limit', 'scope', 'projectId', 'search', 'archivedOnly', 'parentId', 'cursor'].includes(key))).toBe(true);
      requests.push(url);
      if (!url.searchParams.has('limit')) return send({ sessions: roots, resumable: [] });
      const p = url.searchParams;
      if (p.get('cursor') && options.expired) return send({ error: 'Invalid or expired session cursor' }, 400);
      if (p.get('scope') !== 'chats') return send(pageOf([row('scope-result', { name: p.get('scope'), category: p.get('scope') })]));
      if (p.get('archivedOnly') === 'true') return send(pageOf([row('archived', { archivedAt: '2026-09-09' })]));
      if (p.get('search')) return send(pageOf([row('match-child', { name: 'Hidden child', lastPreview: 'needle preview', parentSessionId: 'context' })], null, [row('context', { name: 'Nonmatching parent', hasChildren: true })]));
      if (p.get('projectId')) return send(pageOf(roots.filter((r) => r.projectId === p.get('projectId'))));
      if (p.get('parentId')) return send(pageOf(p.get('cursor') ? [row('c3', { parentSessionId: 'z' })] : children, p.get('cursor') ? null : 'children-next'));
      return send(pageOf(p.get('cursor') ? [row('older-root')] : options.hundred ? [...roots, ...Array.from({ length: 96 }, (_, i) => row(`first-page-${i}`))] : roots, p.get('cursor') ? null : 'roots-next'));
    }
    if (url.pathname === '/projects') return send([{ id: 'p1', name: 'Same label' }, { id: 'p2', name: 'Same label' }]);
    if (url.pathname === '/agents/models/catalog') return send([]);
    if (url.pathname === '/opencode/auth/accounts') return send({ accounts: [], defaultId: null });
    if (url.pathname === '/agent-configs') return send([{ id: 'profile', label: 'Agent', enabled: true, sessionSelectable: true }]);
    if (url.pathname === '/shares') return send([]);
    // Empty IDs remain unexpected: that is a renderer defect, not fixture data.
    if (/^\/agent-sessions\/[^/]+\/todo$/.test(url.pathname)) return send([]);
    if (/^\/agent-sessions\/[^/]+\/memory-provenance$/.test(url.pathname)) return send({ recorded: false, memoryIds: [], notePaths: [], items: [] });
    if (/^\/agent-sessions\/(z|a|b|r)\/?$/.test(url.pathname)) return send({ session: roots.find((r) => url.pathname.endsWith(r.id)), messages: [] });
    if (['/notifications', '/agent-approvals', '/message-threads', '/opencode/commands', '/providers', '/provider', '/agent-sessions/z/todos', '/agent-sessions/z/pending-permissions'].includes(url.pathname)) return send([]);
    if (['/agent-run-outcomes/', '/agent-run-outcomes/z'].includes(url.pathname)) return send({ error: 'No run outcome' }, 404);
    if (['/health', '/opencode/health'].includes(url.pathname)) return send({ status: 'ready' });
    unexpected.push(`${req.method()} ${url.pathname}`); return route.abort();
  });
  await page.goto('/agents');
  try { await expect(page.getByTestId('session-z')).toBeVisible(); }
  catch (error) { console.log({ unexpected, requests: requests.map(String) }); throw error; }
  return { requests, unexpected };
}
const mainIds = (page: Page) => page.locator('.session-group').first().locator('button.session-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('session-', '')));

for (const [sort, ids] of [['newest', ['a', 'b', 'z']], ['oldest', ['z', 'a', 'b']], ['name', ['a', 'z', 'b']], ['activity', ['a', 'b', 'z']], ['status', ['z', 'b', 'a']]] as const) {
  test(`E20-c2-${sort} parsed deterministic root ordering`, async ({ page }) => {
    const { unexpected } = await open(page);
    await page.getByTestId('session-sort').selectOption(sort);
    await expect.poll(() => mainIds(page)).toEqual(ids);
    expect(unexpected).toEqual([]);
  });
}

test('E20-c3 same comparator orders children, explicit bounded root and child continuation', async ({ page }) => {
  const { requests, unexpected } = await open(page);
  await expect(page.getByRole('button', { name: 'Load older roots', exact: true })).toBeVisible();
  expect(requests.filter((u) => u.searchParams.has('cursor'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Load children of alpha', exact: true }).click();
  await expect(page.getByTestId('session-c2')).toBeVisible();
  const childIds = () => page.locator('button.child-session').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  await expect.poll(childIds).toEqual(['session-c2', 'session-c1']);
  await page.getByTestId('session-sort').selectOption('name');
  await expect.poll(childIds).toEqual(['session-c1', 'session-c2']);
  for (const sort of ['oldest', 'activity', 'status']) {
    await page.getByTestId('session-sort').selectOption(sort);
    await expect.poll(childIds).toEqual(['session-c1', 'session-c2']);
  }
  await page.getByRole('complementary', { name: 'Agents', exact: true }).screenshot({ path: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e20-load-controls.png' });
  await page.getByRole('button', { name: 'Load older children of alpha', exact: true }).click();
  await expect(page.getByTestId('session-c3')).toBeVisible();
  await page.getByRole('button', { name: 'Load older roots', exact: true }).click();
  await expect(page.getByTestId('session-older-root')).toBeVisible();
  expect(requests.filter((u) => u.searchParams.has('cursor')).map((u) => [u.searchParams.get('parentId'), u.searchParams.get('cursor')])).toEqual([['z', 'children-next'], [null, 'roots-next']]);
  expect(unexpected).toEqual([]);
});

test('E20-c4 scope and archived controls query canonical E26 filters', async ({ page }) => {
  const { requests, unexpected } = await open(page);
  for (const [scope, wire] of [['scheduled', 'scheduled'], ['background', 'self_improvement'], ['chats', 'chats']]) {
    await page.getByTestId(`scope-${scope}`).click();
    await expect.poll(() => requests.at(-1)?.searchParams.get('scope')).toBe(wire);
  }
  await page.getByRole('checkbox', { name: 'Archived sessions' }).check();
  await expect(page.getByTestId('session-archived')).toBeVisible();
  expect(requests.at(-1)?.searchParams.get('archivedOnly')).toBe('true');
  await expect(page.getByTestId('session-z')).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('E20-c5 project identity and canonical labels, not synthetic workspace', async ({ page }) => {
  const { requests, unexpected } = await open(page);
  await expect(page.getByTestId('session-z')).toContainText('Same label');
  await page.getByTestId('project-filter').selectOption('p2');
  await expect(page.getByTestId('session-a')).toBeVisible();
  await expect(page.getByTestId('session-z')).toHaveCount(0);
  expect(requests.at(-1)?.searchParams.get('projectId')).toBe('p2');
  await expect(page.getByRole('complementary', { name: 'Agents', exact: true })).not.toContainText('Live workspace');
  await page.getByTestId('scope-scheduled').click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('scope')).toBe('scheduled');
  expect(requests.at(-1)?.searchParams.get('projectId')).toBeNull();
  expect(unexpected).toEqual([]);
});

test('E20-c7 trimmed server search discovers child beyond first100 with context and preview', async ({ page }) => {
  const { requests, unexpected } = await open(page, { hundred: true });
  await expect(page.locator('button.session-row')).toHaveCount(100);
  await page.getByTestId('session-search-toggle').click();
  await page.getByTestId('session-search').fill('  needle  ');
  await expect(page.getByTestId('session-match-child')).toBeVisible();
  await expect(page.getByTestId('session-match-child')).toContainText('needle preview');
  expect(requests.at(-1)?.searchParams.get('search')).toBe('needle');
  await expect(page.getByTestId('session-context')).toBeVisible();
  expect(unexpected).toEqual([]);
});

test('E20-c9 density is usable without inventing persisted cross-account preferences', async ({ page }) => {
  const { unexpected } = await open(page);
  await expect(page.getByTestId('session-b')).toContainText('needle preview');
  const keys = () => page.evaluate(() => Object.keys(localStorage).filter((key) => /compact|density|session-sort|project-filter/.test(key)).sort());
  const before = await keys();
  await page.getByRole('checkbox', { name: 'Compact rows' }).check();
  await expect(page.getByTestId('session-b')).not.toContainText('needle preview');
  await page.getByRole('checkbox', { name: 'Compact rows' }).uncheck();
  await expect(page.getByTestId('session-b')).toContainText('needle preview');
  expect(await keys()).toEqual(before);
  expect(unexpected).toEqual([]);
});

test('E20-c8 expired continuation offers explicit reset, never loops fetching', async ({ page }) => {
  const { requests, unexpected } = await open(page, { expired: true });
  await page.getByRole('button', { name: 'Load older roots', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'expired' })).toBeVisible();
  expect(requests.filter((u) => u.searchParams.has('cursor'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Reset session history' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'expired' })).toHaveCount(0);
  expect(requests.at(-1)?.searchParams.has('cursor')).toBe(false);
  expect(unexpected).toEqual([]);
});
