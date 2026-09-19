import { expect, test, type Page } from '@playwright/test';
import { compareSessions, toSessionViewModel, createLiveSessionsGateway } from '../src/gateway/sessions';

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, status: 'idle', category: 'chat', projectId: 'p1',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
  lastActivityAt: null, lastPreview: null, archivedAt: null, parentSessionId: null,
  profileId: 'profile', cwd: '/test', ...extra,
});
const roots = [
  row('z', { name: 'alpha', createdAt: '2026-09-01T01:00:00+02:00', status: 'working', hasChildren: true, childCount: 164, runningChildCount: 38 }),
  row('a', { name: 'Alpha', createdAt: '2026-09-01T00:30:00Z', status: 'closed', lastActivityAt: '2026-09-09T00:00:00Z', projectId: 'p2' }),
  row('b', { name: 'Beta', createdAt: '2026-09-01T00:30:00Z', status: 'starting', lastPreview: 'needle preview' }),
  row('r', { status: 'resumable' }),
];
const children = [row('c2', { name: 'zulu', parentSessionId: 'z', createdAt: '2026-09-02T00:00:00Z', status: 'idle' }), row('c1', { name: 'Able', parentSessionId: 'z', status: 'working', lastActivityAt: '2026-09-10T00:00:00Z', hasChildren: true, childCount: 60, runningChildCount: 0 })];
const nestedChildren = [row('gc1', { name: 'Nested helper', parentSessionId: 'c1', status: 'idle' }), row('gc2', { name: 'Nested runner', parentSessionId: 'c1', status: 'working' })];
const pageOf = (sessions: unknown[], nextCursor: string | null = null, ancestors: unknown[] = []) => ({ sessions, ancestors, resumable: [], pageInfo: { limit: 100, nextCursor, hasMore: !!nextCursor, expiresAt: '2099-01-01T00:00:00Z' } });

test('E20-c1 canonical DTO fields are not replaced by presentation defaults', () => {
  const input = row('dto', { category: 'self_improvement', lastActivityAt: '2026-09-08T12:00:00Z', lastPreview: 'canonical preview', archivedAt: '2026-09-09T00:00:00Z', childCount: 60, runningChildCount: 38 });
  expect(toSessionViewModel(input)).toMatchObject({ lastActivityAt: input.lastActivityAt, lastPreview: input.lastPreview, category: 'self_improvement', archivedAt: input.archivedAt, projectId: 'p1', projectName: '', scope: 'background', group: 'archived', childCount: 60, runningChildCount: 38 });
  for (const malformed of [-1, 1.5, NaN, Infinity, '164', null]) {
    const mapped = toSessionViewModel(row('malformed', { childCount: malformed, runningChildCount: malformed }));
    expect(mapped.childCount).toBeUndefined();
    expect(mapped.runningChildCount).toBeUndefined();
  }
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
  const gateway = createLiveSessionsGateway('http://e20.invalid', 'test', async () => new Response(JSON.stringify({ sessions: [{ ...row('root'), children }], resumable: [row('resume', { status: 'resumable' })] })), class {} as unknown as typeof WebSocket);
  expect(typeof (gateway as any).listPage).toBe('function');
  if (!(gateway as any).listPage) return;
  const result = await (gateway as any).listPage({ scope: 'chats' });
  expect(result.sessions.map((s: any) => s.id)).toEqual(['root', 'c2', 'c1', 'resume']);
  expect(result.pageInfo).toEqual({ nextCursor: null, hasMore: false });
});

async function open(page: Page, options: { expired?: boolean; hundred?: boolean; unassigned?: boolean; equalCounts?: boolean; equalParentNames?: boolean; oldServer?: boolean } = {}) {
  const requests: URL[] = []; const unexpected: string[] = [];
  const rootRows = options.oldServer ? roots.map((root) => { const copy = { ...root }; delete (copy as any).childCount; delete (copy as any).runningChildCount; return copy; }) : roots;
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
      if (!url.searchParams.has('limit')) return send({ sessions: rootRows, resumable: [] });
      const p = url.searchParams;
      if (p.get('cursor') && options.expired) return send({ error: 'Invalid or expired session cursor' }, 400);
      if (p.get('scope') !== 'chats') return send(pageOf([row('scope-result', { name: p.get('scope'), category: p.get('scope') })]));
      if (p.get('archivedOnly') === 'true') return send(pageOf([row('archived', { archivedAt: '2026-09-09' })]));
      if (p.get('search')) return send(pageOf([row('match-child', { name: 'Hidden child', lastPreview: 'needle preview', parentSessionId: 'context' })], null, [row('context', { name: 'Nonmatching parent', hasChildren: true })]));
      if (p.get('projectId')) return send(pageOf(roots.filter((r) => r.projectId === p.get('projectId'))));
       if (options.equalParentNames && p.get('parentId')) return send(pageOf([row(`child-${p.get('parentId')}`, { parentSessionId: p.get('parentId') })]));
       if (p.get('parentId') === 'c1') return send(pageOf(nestedChildren));
       if (p.get('parentId')) return send(pageOf(p.get('cursor') ? [row('c3', { parentSessionId: 'z' })] : children, p.get('cursor') ? null : 'children-next'));
       if (options.equalParentNames) return send(pageOf([
          row('parent-shared-alpha', { name: 'Same name', hasChildren: true, createdAt: '2026-09-02T00:00:00Z' }),
          row('parent-shared-beta', { name: 'Same name', hasChildren: true, createdAt: '2026-09-01T00:00:00Z' }),
         row('unique-parent', { name: 'Unique name', hasChildren: true }),
       ]));
       if (options.equalCounts) return send(pageOf([roots[0], roots[1], row('unique', { projectId: 'p3' })]));
      return send(pageOf(p.get('cursor') ? [row('older-root')] : options.hundred ? [...rootRows, ...Array.from({ length: 96 }, (_, i) => row(`first-page-${i}`))] : options.unassigned ? [...rootRows, row('unassigned', { projectId: null, parentSessionId: 'z' })] : rootRows, p.get('cursor') ? null : 'roots-next'));
    }
    if (url.pathname === '/projects') return send([{ id: 'p1', name: 'Same label' }, { id: 'p2', name: 'Same label' }, { id: 'p3', name: 'Unique project' }]);
    if (url.pathname === '/agents/models/catalog') return send([]);
    if (url.pathname === '/opencode/auth/accounts') return send({ accounts: [], defaultId: null });
    if (url.pathname === '/agent-configs') return send([{ id: 'profile', label: 'Agent', enabled: true, sessionSelectable: true }]);
    if (url.pathname === '/shares') return send([]);
    // Empty IDs remain unexpected: that is a renderer defect, not fixture data.
    if (/^\/agent-sessions\/[^/]+\/todo$/.test(url.pathname)) return send([]);
    if (/^\/agent-sessions\/[^/]+\/memory-provenance$/.test(url.pathname)) return send({ recorded: false, memoryIds: [], notePaths: [], items: [] });
    if (/^\/agent-sessions\/(z|a|b|r|c1|c2|c3|gc1|gc2)\/?$/.test(url.pathname)) {
      const id = url.pathname.split('/').filter(Boolean).at(-1);
      return send({ session: [...rootRows, ...children, ...nestedChildren, row('c3', { parentSessionId: 'z' })].find((item) => item.id === id), messages: [] });
    }
    if (['/notifications', '/agent-approvals', '/message-threads', '/opencode/commands', '/providers', '/provider', '/agent-sessions/z/todos', '/agent-sessions/z/pending-permissions'].includes(url.pathname)) return send([]);
    if (['/agent-run-outcomes/', '/agent-run-outcomes/z'].includes(url.pathname)) return send({ error: 'No run outcome' }, 404);
    if (['/health', '/opencode/health', '/global/health'].includes(url.pathname)) return send({ status: 'ready' });
    unexpected.push(`${req.method()} ${url.pathname}`); return route.abort();
  });
  await page.goto('/agents');
  try { await expect(page.getByTestId('session-z')).toBeVisible(); }
  catch (error) { console.log({ unexpected, requests: requests.map(String) }); throw error; }
  return { requests, unexpected };
}
const mainIds = (page: Page) => page.locator('.session-group').filter({ has: page.getByTestId('group-project-p1') }).locator('button.session-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('session-', '')));

for (const [sort, ids] of [['newest', ['b', 'r', 'z']], ['oldest', ['z', 'r', 'b']], ['name', ['z', 'b', 'r']], ['activity', ['b', 'r', 'z']], ['status', ['z', 'b', 'r']]] as const) {
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
  await page.getByRole('button', { name: 'Load subagents for alpha', exact: true }).click();
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
  await page.getByRole('button', { name: 'Load more subagents for alpha', exact: true }).click();
  await expect(page.getByTestId('session-c3')).toBeVisible();
  await page.getByRole('button', { name: 'Load older roots', exact: true }).click();
  await expect(page.getByTestId('session-older-root')).toBeVisible();
  expect(requests.filter((u) => u.searchParams.has('cursor')).map((u) => [u.searchParams.get('parentId'), u.searchParams.get('cursor')])).toEqual([['z', 'children-next'], [null, 'roots-next']]);
  expect(unexpected).toEqual([]);
});

test('subagent-tree-c1 loaded nested children have independent keyboard disclosures without hiding paging or project headings', async ({ page }) => {
  await open(page);
  const projectHeading = page.getByTestId('group-project-p1');
  const rootDisclosure = page.getByTestId('subagents-z');
  await expect(rootDisclosure).toHaveAccessibleName('alpha: 164 subagents · 38 running');
  await page.getByRole('button', { name: 'Load subagents for alpha', exact: true }).click();
  await expect(rootDisclosure).toHaveAccessibleName('alpha: 164 subagents · 38 running');
  await expect(rootDisclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('session-c1')).toBeVisible();
  await page.getByTestId('session-c1').click();
  await expect(page.getByTestId('session-c1')).toHaveAttribute('aria-current', 'true');
  await rootDisclosure.focus();
  await rootDisclosure.press('Space');
  await expect(rootDisclosure).toBeFocused();
  await expect(rootDisclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('session-c1')).toHaveCount(0);
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByRole('button', { name: 'Load more subagents for alpha', exact: true })).toHaveCount(0);
  await expect(projectHeading).toHaveAttribute('aria-expanded', 'true');

  await rootDisclosure.press('Enter');
  await expect(page.getByRole('button', { name: 'Load more subagents for alpha', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load subagents for Able', exact: true }).click();
  const nestedDisclosure = page.getByTestId('subagents-c1');
  await expect(nestedDisclosure).toHaveAccessibleName('Able: 60 subagents');
  await nestedDisclosure.press('Enter');
  await expect(nestedDisclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('session-gc1')).toHaveCount(0);
  await expect(rootDisclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('session-c1')).toBeVisible();
});

test('subagent-disclosure-repair distinguishes equal-count controls and indents nested controls without narrow overflow', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Load subagents for alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Load subagents for Able', exact: true }).click();

  // Regression: generic count-only names collapse equal-count parents into indistinguishable screen-reader controls.
  const disclosures = page.locator('button.subagent-disclosure');
  await expect(disclosures).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'alpha: 164 subagents · 38 running', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Able: 60 subagents', exact: true })).toHaveCount(1);

  const rootWrap = page.getByTestId('session-z').locator('..');
  await expect(rootWrap.locator(':scope > button.session-row')).toHaveCount(1);
  await expect(rootWrap.locator(':scope > button.subagent-disclosure')).toHaveCount(1);
  await expect(rootWrap.locator('button button')).toHaveCount(0);
  const inline = await rootWrap.evaluate((element) => {
    const row = element.querySelector<HTMLElement>(':scope > .session-row')!;
    const disclosure = element.querySelector<HTMLElement>(':scope > .subagent-disclosure')!;
    const wrap = element.getBoundingClientRect(); const rowBox = row.getBoundingClientRect(); const style = getComputedStyle(disclosure);
    return { wrapHeight: wrap.height, rowHeight: rowBox.height, border: style.borderTopWidth, background: style.backgroundColor };
  });
  expect(inline.wrapHeight).toBeLessThanOrEqual(inline.rowHeight + 1);
  expect(inline.border).toBe('0px');
  expect(inline.background).toMatch(/rgba\([^)]*,\s*0\)|transparent/);
  await expect(page.getByTestId('subagents-z')).toHaveAttribute('aria-controls', 'subagent-children-z');

  const positions = await disclosures.evaluateAll((controls) => controls.map((control) => {
    const rect = control.getBoundingClientRect();
    return { name: control.getAttribute('aria-label'), x: rect.x, right: rect.right, width: rect.width };
  }));
  // Regression: `.subagent-disclosure { min-width: 0 }` outranks the coarse-pointer `button { min-width: 44px }`
  // safety net, so a short label ("1", "60") shrank the hit target to ~29-37px wide.
  for (const position of positions) expect(position.width, `${position.name} disclosure width`).toBeGreaterThanOrEqual(44);
  const headingX = await page.getByTestId('group-project-p1').evaluate((heading) => heading.getBoundingClientRect().x);
  expect(positions[0].x).toBeGreaterThan(headingX);
  expect(positions[1].x).toBeGreaterThan(positions[0].x);
  await page.screenshot({ path: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e20-subagent-disclosure-desktop.png' });

  const narrowPositions: { name: string | null; x: number; right: number; height: number }[] = [];
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    if (width === 390) await page.getByTestId('rail-expand').click();
    await expect(disclosures).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const disclosure of await disclosures.all()) {
      const box = await disclosure.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width, `${await disclosure.getAttribute('aria-label')} disclosure width at ${width}`).toBeGreaterThanOrEqual(44);
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      narrowPositions.push({ name: await disclosure.getAttribute('aria-label'), x: box!.x, right: box!.x + box!.width, height: box!.height });
    }
  }
  console.log('subagent disclosure evidence', { headingX, desktop: positions, narrow: narrowPositions });
  await page.screenshot({ path: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e20-subagent-disclosure-narrow.png' });
});

test('subagent-overflow-hit-area overflow actions keep 44px targets beside disclosures and on plain rows', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Load subagents for alpha', exact: true }).click();
  // Regression: the overflow control measured 34x34 in both the has-subagents grid and the absolute plain-row layout.
  const measure = async (width: number) => {
    for (const id of ['z', 'b']) {
      const box = (await page.getByTestId(`session-menu-${id}`).boundingBox())!;
      const wrap = (await page.getByTestId(`session-${id}`).locator('..').boundingBox())!;
      expect(box.width, `${id} overflow width at ${width}`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${id} overflow height at ${width}`).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(wrap.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(Math.min(wrap.x + wrap.width, width) + 0.5);
      expect(box.y).toBeGreaterThanOrEqual(wrap.y - 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(wrap.y + wrap.height + 0.5);
      const disclosure = page.getByTestId(`subagents-${id}`);
      if (await disclosure.count()) {
        const other = (await disclosure.boundingBox())!;
        const intersects = box.x < other.x + other.width && other.x < box.x + box.width && box.y < other.y + other.height && other.y < box.y + box.height;
        expect(intersects, `${id} overflow overlaps disclosure at ${width}`).toBe(false);
      }
    }
  };
  await measure(1280);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    if (width === 390) await page.getByTestId('rail-expand').click();
    await expect(page.getByTestId('subagents-z')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await measure(width);
  }
});

test('subagent-overflow-focus-stability keyboard focus keeps the actions button inside its own row', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Load subagents for alpha', exact: true }).click();
  // Regression: the shared :focus-visible rule set position:relative, so Tab pulled the absolutely
  // positioned plain-row actions button out of its row, grew the wrap and pushed the list down.
  const geometry = (id: string) => page.getByTestId(`session-menu-${id}`).evaluate((button) => {
    const wrap = button.closest('.session-row-wrap') as HTMLElement;
    const box = button.getBoundingClientRect(); const wrapBox = wrap.getBoundingClientRect();
    return {
      position: getComputedStyle(button).position,
      offsetX: Math.round(box.x - wrapBox.x), offsetY: Math.round(box.y - wrapBox.y),
      width: Math.round(box.width), height: Math.round(box.height), wrapHeight: Math.round(wrapBox.height),
      listHeight: document.querySelector('.session-list')!.scrollHeight,
    };
  });
  for (const [id, tabs] of [['b', 1], ['z', 2]] as const) {
    const before = await geometry(id);
    await page.getByTestId(`session-${id}`).focus();
    for (let step = 0; step < tabs; step += 1) await page.keyboard.press('Tab');
    await expect(page.getByTestId(`session-menu-${id}`)).toBeFocused();
    const after = await geometry(id);
    expect(after, `${id} actions button moved when keyboard focus reached it`).toEqual(before);
    expect(after.width).toBeGreaterThanOrEqual(44);
    expect(after.height).toBeGreaterThanOrEqual(44);
  }
});

test('subagent-disclosure-density inline counts stay unclipped without starving session names', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Load subagents for alpha', exact: true }).click();
  // Regression: a fixed 132px count chip clipped its own label at every width and left the
  // session name a third of the row, while hover/selection painted only that fragment.
  const measure = (id: string) => page.getByTestId(`subagents-${id}`).evaluate((control) => {
    const wrap = control.closest('.session-row-wrap') as HTMLElement;
    const row = wrap.querySelector(':scope > .session-row, :scope > .child-session') as HTMLElement;
    const label = control.querySelector('span')!;
    return {
      wrapWidth: wrap.getBoundingClientRect().width, rowWidth: row.getBoundingClientRect().width,
      clipped: label.scrollWidth > label.clientWidth + 1, text: (control.textContent ?? '').trim(),
      wrapBackground: getComputedStyle(wrap).backgroundColor, wrapShadow: getComputedStyle(wrap).boxShadow,
      rowBackground: getComputedStyle(row).backgroundColor,
    };
  });
  await page.getByTestId('session-z').click();
  await expect(page.getByTestId('session-z')).toHaveAttribute('aria-current', 'true');
  const selected = await measure('z');
  expect(selected.wrapBackground, 'selection surface must paint the whole row').not.toBe('rgba(0, 0, 0, 0)');
  expect(selected.wrapShadow, 'selection border must wrap the whole row').toContain('inset');
  expect(selected.rowBackground, 'inner row must not paint a second selection surface').toBe('rgba(0, 0, 0, 0)');

  const evidence: Record<string, unknown>[] = [];
  for (const width of [1280, 390, 320]) {
    if (width !== 1280) {
      await page.setViewportSize({ width, height: 720 });
      if (width === 390) await page.getByTestId('rail-expand').click();
    }
    await expect(page.getByTestId('subagents-z')).toBeVisible();
    const parent = await measure('z');
    evidence.push({ width, ...parent });
    expect(parent.clipped, `count label clipped at ${width}`).toBe(false);
    expect(parent.rowWidth / parent.wrapWidth, `session name share at ${width}`).toBeGreaterThan(0.55);
  }
  console.log('subagent disclosure density', evidence);
});

test('subagent-counts-c3 old servers never present a bounded preview as an exact total', async ({ page }) => {
  await open(page, { oldServer: true });
  const disclosure = page.getByTestId('subagents-z');
  await expect(disclosure).toHaveAccessibleName('alpha: More subagents');
  await page.getByRole('button', { name: 'Load subagents for alpha', exact: true }).click();
  await expect(disclosure).toHaveAccessibleName('alpha: 2+ subagents · 1 running');
  await page.getByRole('button', { name: 'Load more subagents for alpha', exact: true }).click();
  await expect(disclosure).toHaveAccessibleName('alpha: 3 subagents · 1 running');
});

test('subagent-disclosure-collision shared first-eight IDs use shortest stable unique prefixes while visible labels stay concise', async ({ page }) => {
  await open(page, { equalParentNames: true });
  const sameNameLoaders = page.getByRole('button', { name: /^Load subagents for Same name \(parent-shared-/ });
  await sameNameLoaders.first().click();
  await sameNameLoaders.first().click();
  await page.getByRole('button', { name: 'Load subagents for Unique name', exact: true }).click();

  const first = page.getByTestId('subagents-parent-shared-alpha');
  const second = page.getByTestId('subagents-parent-shared-beta');
  const unique = page.getByTestId('subagents-unique-parent');
  // Regression: fixed first-eight discriminators remain identical for these distinct parents.
  await expect(first).toHaveAccessibleName('Same name (parent-shared-a): 1 subagent');
  await expect(second).toHaveAccessibleName('Same name (parent-shared-b): 1 subagent');
  await expect(unique).toHaveAccessibleName('Unique name: 1 subagent');
  await expect(first).toHaveText('1');
  await expect(second).toHaveText('1');
  await expect(unique).toHaveText('1');

  // Regression: overflow buttons reused the bare session name, so two rows exposed one
  // accessible name for two different menus, each holding its own Delete permanently.
  await expect(page.getByRole('button', { name: 'Same name (parent-shared-a) actions', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Same name (parent-shared-b) actions', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Unique name actions', exact: true })).toHaveCount(1);
  const overflowNames = await page.locator('button.session-overflow-button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
  expect(new Set(overflowNames).size, `duplicate actions names: ${overflowNames.join(' | ')}`).toBe(overflowNames.length);
  await page.getByTestId('session-menu-parent-shared-alpha').click();
  await expect(page.getByRole('menu', { name: 'Same name (parent-shared-a) actions', exact: true })).toBeVisible();
  await page.getByTestId('session-menu-parent-shared-alpha').click();

  await page.getByTestId('session-sort').selectOption('oldest');
  await expect(first).toHaveAccessibleName('Same name (parent-shared-a): 1 subagent');
  await expect(second).toHaveAccessibleName('Same name (parent-shared-b): 1 subagent');
  await page.getByTestId('sessions-refresh').click();
  await sameNameLoaders.first().click();
  await sameNameLoaders.first().click();
  await page.getByRole('button', { name: 'Load subagents for Unique name', exact: true }).click();
  await expect(first).toHaveAccessibleName('Same name (parent-shared-a): 1 subagent');
  await expect(second).toHaveAccessibleName('Same name (parent-shared-b): 1 subagent');
  await expect(unique).toHaveAccessibleName('Unique name: 1 subagent');
  await expect(first).toHaveText('1');
  await expect(second).toHaveText('1');
  await expect(unique).toHaveText('1');
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await expect(unique).toHaveAttribute('aria-expanded', 'true');
});

test('E20-c4 scope and archived controls query canonical E26 filters', async ({ page }) => {
  const { requests, unexpected } = await open(page);
  for (const [scope, wire] of [['scheduled', 'scheduled'], ['background', 'self_improvement'], ['chats', 'chats']]) {
    await page.getByTestId(`scope-${scope}`).click();
    await expect.poll(() => requests.at(-1)?.searchParams.get('scope')).toBe(wire);
    if (scope !== 'chats') {
      await expect(page.getByTestId('group-project-p1')).toHaveAccessibleName('Same label (p1) 1');
      await expect(page.locator('.session-list > .session-group')).toHaveCount(1);
      await expect(page.locator('.session-list .group-toggle')).toHaveCount(1);
    }
  }
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'View archived sessions' }).click();
  await expect(page.getByTestId('session-archived')).toBeVisible();
  await expect(page.getByTestId('session-archived')).toContainText('Archived');
  await expect(page.getByTestId('group-project-p1')).toHaveAccessibleName('Same label (p1) 1');
  expect(requests.at(-1)?.searchParams.get('archivedOnly')).toBe('true');
  await expect(page.getByTestId('session-z')).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('project-headings-c1 removes the duplicate project dropdown', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('project-filter')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Project filter' })).toHaveCount(0);
});

test('project-headings-c2 canonical project identities and No project counts', async ({ page }) => {
  await open(page, { unassigned: true });
  await expect(page.getByTestId('group-project-p1')).toHaveAccessibleName('Same label (p1) 3');
  await expect(page.getByTestId('group-project-p2')).toHaveAccessibleName('Same label (p2) 1');
  await expect(page.getByTestId('group-project-')).toHaveAccessibleName('No project 1');
  await expect(page.locator('.session-group')).toHaveCount(3);
  await expect(page.locator('.session-group').filter({ has: page.getByTestId('group-project-') }).getByTestId('session-unassigned')).toBeVisible();
});

test('project-headings-c3 project trees replace Agents and status disclosures', async ({ page }) => {
  await open(page);
  await expect(page.locator('.session-list > .session-group')).toHaveCount(2);
  await expect(page.locator('.agent-disclosure')).toHaveCount(0);
  await expect(page.locator('.session-list .group-toggle')).toHaveCount(2);
  await expect(page.locator('.session-list').getByRole('button', { name: /^(Agents|Active|Resumable|Archived)\s*\d*$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load subagents for alpha', exact: true }).click();
  const project = page.locator('.session-group').filter({ has: page.getByTestId('group-project-p1') });
  await expect(project.getByTestId('session-c1')).toBeVisible();
  await expect(project.getByTestId('session-r')).toBeVisible();
  await expect(project.getByTestId('session-r')).toContainText('Ready to resume');
  await expect(project.getByTestId('session-z')).toContainText('Working');
  await expect(page.getByTestId('group-project-p1')).toHaveAccessibleName('Same label (p1) 5');
});

test('project-headings-c4 delayed live list preserves loading status and clears busy on resolution', async ({ page }) => {
  const { requests, unexpected } = await open(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  // Delay only the HTTP boundary: removing the rendered status or busy state must fail.
  await page.route('**/agent-sessions?*', async (route) => {
    if (new URL(route.request().url()).searchParams.has('limit')) await pending;
    await route.fallback();
  });
  const list = page.locator('.session-list');
  const loading = list.getByRole('status');
  const before = requests.length;
  try {
    await page.getByTestId('sessions-refresh').click();
    await expect(list).toHaveAttribute('aria-busy', 'true');
    await expect(loading).toHaveText('Loading session history…');
    await expect(loading).toBeVisible();
    await expect(list.getByText('No sessions match.', { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  await expect.poll(() => requests.length).toBeGreaterThan(before);
  await expect(list).toHaveAttribute('aria-busy', 'false');
  await expect(loading).toHaveCount(0);
  await expect(page.getByTestId('group-project-p1')).toHaveAccessibleName('Same label (p1) 3');
  await expect(page.getByTestId('session-z')).toBeVisible();
  await expect(list.getByRole('alert')).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('project-headings-c5 Tab reaches each heading with a visible keyboard focus outline', async ({ page }) => {
  const { unexpected } = await open(page);
  const preceding = page.getByRole('button', { name: 'View options', exact: true });
  await expect(page.locator('.session-group > .group-toggle')).toHaveText(['Same label (p2)1', 'Same label (p1)3']);
  await preceding.click();
  await page.keyboard.press('Escape');
  await expect(preceding).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'chats sessions' })).toBeFocused();
  // A tabindex=-1 heading or removed/transparent focus outline must fail, unlike .focus().
  for (const id of ['p2', 'p1']) {
    await page.keyboard.press('Tab');
    const heading = page.getByTestId(`group-project-${id}`);
    await expect(heading).toBeFocused();
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    const focus = await heading.evaluate((element) => {
      const style = getComputedStyle(element);
      return { visible: element.matches(':focus-visible'), style: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor };
    });
    expect(focus.visible).toBe(true);
    expect(focus.style).toBe('solid');
    expect(focus.width).toBeGreaterThanOrEqual(2);
    expect(focus.color).not.toMatch(/^(transparent|rgba\([^)]*,\s*0\))$/);
    await page.keyboard.press('Enter');
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
  }
  expect(unexpected).toEqual([]);
});

test('project-headings-c5 independent keyboard collapse retains accessible selection', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await open(page);
  const first = page.getByTestId('group-project-p1');
  const second = page.getByTestId('group-project-p2');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await first.focus(); await first.press('Enter');
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('session-z')).toHaveCount(0);
  await expect(page.getByTestId('session-a')).toBeVisible();
  await page.getByTestId('session-a').click();
  await expect(page.getByTestId('session-a')).toHaveAttribute('aria-current', 'true');
  await second.focus(); await second.press('Space');
  await expect(second).toHaveAttribute('aria-expanded', 'false');
  await first.focus(); await first.press('Space');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(second).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('session-z')).toBeVisible();
  await second.press('Enter');
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Compact', exact: true }).click();
  await page.getByRole('complementary', { name: 'Agents', exact: true }).screenshot({ path: testInfo.outputPath('project-headings.png') });
});

test('project-headings-repair-c2 equal-name equal-count projects have stable visible names and independent collapse', async ({ page }) => {
  const { unexpected } = await open(page, { equalCounts: true });
  const first = page.getByRole('button', { name: 'Same label (p1) 1', exact: true });
  const second = page.getByRole('button', { name: 'Same label (p2) 1', exact: true });
  // Counts cannot distinguish these groups; the visible canonical ID must do it.
  await expect(page.locator('.session-group > .group-toggle small')).toHaveText(['1', '1', '1']);
  await expect(first.locator('span')).toHaveText('Same label (p1)');
  await expect(second.locator('span')).toHaveText('Same label (p2)');
  await expect(page.getByTestId('group-project-p3')).toHaveAccessibleName('Unique project 1');
  await first.click();
  await expect(page.getByTestId('session-z')).toHaveCount(0);
  await expect(page.getByTestId('session-a')).toBeVisible();
  await page.getByTestId('session-sort').selectOption('oldest');
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await second.click();
  await first.click();
  await expect(page.getByTestId('session-z')).toBeVisible();
  await expect(page.getByTestId('session-a')).toHaveCount(0);
  await expect(second).toHaveAttribute('aria-expanded', 'false');
  expect(unexpected).toEqual([]);
});

test('E20-c5 project identity and canonical labels, not synthetic workspace', async ({ page }) => {
  const { requests, unexpected } = await open(page);
  await expect(page.getByTestId('session-z')).toContainText('Same label');
  await page.getByTestId('group-project-p1').click();
  await expect(page.getByTestId('session-a')).toBeVisible();
  await expect(page.getByTestId('session-z')).toHaveCount(0);
  expect(requests.every((url) => !url.searchParams.has('projectId'))).toBe(true);
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
  await expect(page.getByTestId('group-project-p1')).toHaveAccessibleName('Same label (p1) 2');
  await expect(page.getByTestId('group-project-p2')).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('E20-c9 density is usable without inventing persisted cross-account preferences', async ({ page }) => {
  const { unexpected } = await open(page);
  await page.getByRole('button', { name: 'Load subagents for alpha', exact: true }).click();
  await expect(page.getByTestId('session-c1')).toBeVisible();
  await expect(page.getByTestId('session-b')).toContainText('needle preview');
  const keys = () => page.evaluate(() => Object.keys(localStorage).filter((key) => /compact|density|session-sort|project-filter/.test(key)).sort());
  const before = await keys();
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Compact', exact: true }).click();
  await expect(page.getByTestId('session-b')).not.toContainText('needle preview');
  // Compact must not leave only an aria-hidden colored dot (roots and children).
  for (const [id, status] of [['z', 'Working'], ['r', 'Ready to resume'], ['c1', 'Working']]) {
    const session = page.getByTestId(`session-${id}`);
    await expect(session.getByText(status, { exact: true })).toBeVisible();
    await expect(session).toHaveAccessibleName(new RegExp(status));
    await expect(session).not.toContainText('Same label');
  }
  await expect(page.getByTestId('session-c1')).not.toContainText('alpha');
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Comfortable', exact: true }).click();
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

test('E54: fixed session and transcript transformations stay inside the interaction budget', () => {
  const manySessions = Array.from({ length: 10_000 }, (_, index) => toSessionViewModel(row(`perf-${index}`, { name: `Session ${10_000 - index}`, lastActivityAt: `2026-09-${String(index % 28 + 1).padStart(2, '0')}T00:00:00Z` })));
  const sessionStart = performance.now();
  const visible = manySessions.filter((session) => session.name.includes('1')).sort((a, b) => compareSessions(a, b, 'activity'));
  const sessionMs = performance.now() - sessionStart;
  expect(visible.length).toBeGreaterThan(0); expect(sessionMs).toBeLessThan(200);
  const messages = Array.from({ length: 1_000 }, (_, index) => ({ id: `m-${index}`, role: index % 2 ? 'assistant' : 'user', createdAt: new Date(index * 1_000).toISOString(), parts: [{ id: `p-${index}`, type: 'text', text: `Message ${index}` }] }));
  const transcriptStart = performance.now();
  const mapped = toSessionViewModel(row('perf-transcript'), messages);
  const transcriptMs = performance.now() - transcriptStart;
  expect(mapped.messages).toHaveLength(1_000); expect(transcriptMs).toBeLessThan(200);
  console.log(`E54 fixed transform baseline: sessions=${sessionMs.toFixed(2)}ms transcript=${transcriptMs.toFixed(2)}ms`);
});
