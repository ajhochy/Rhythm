import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const parentTitle = 'A long parent conversation about release readiness and nested subagent investigations';
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, status: 'idle', category: 'chat', projectId: 'project', profileId: 'profile', cwd: '/fixture', createdAt: '2026-09-18T00:00:00Z', ...extra });
const roots = [row('parent-one', { name: parentTitle, hasChildren: true, childCount: 3 }), row('parent-two', { name: parentTitle, hasChildren: true, childCount: 1 })];
const nested = row('nested', { name: 'Nested parent', parentSessionId: 'parent-one', hasChildren: true, childCount: 1 });
const children = [nested, row('child', { parentSessionId: 'parent-one' })];
const pageOf = (sessions: unknown[], nextCursor: string | null = null) => ({ sessions, ancestors: [], pageInfo: { nextCursor, hasMore: !!nextCursor } });

async function open(page: Page, options: { hold?: boolean; failFirst?: boolean; expirePage?: boolean } = {}) {
  const childRequests: URL[] = []; const writes: string[] = [];
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let failures = options.failFirst ? 1 : 0;
  let expirePage = options.expirePage;
  await page.routeWebSocket(/\/ws\/agents$/, () => {});
  await page.route(url => ['http://127.0.0.1:65534', 'http://127.0.0.1:65533', 'https://rail-fixture.invalid'].includes(url.origin), async route => {
    const request = route.request(); const url = new URL(request.url());
    const send = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (request.method() !== 'GET') { writes.push(`${request.method()} ${url.pathname}`); return route.abort(); }
    if (url.pathname === '/agent-sessions') {
      if (url.searchParams.get('archivedOnly')) return send(pageOf([]));
      const parent = url.searchParams.get('parentId');
      if (!parent) return send(pageOf(roots));
      childRequests.push(url);
      if (options.hold && childRequests.length === 1) await held;
      if (failures-- > 0) return send({ error: 'Temporary failure' }, 503);
      if (expirePage && url.searchParams.has('cursor')) { expirePage = false; return send({ error: 'Expired cursor' }, 400); }
      if (parent === 'nested') return send(pageOf([row('grandchild', { parentSessionId: 'nested' })]));
      if (parent === 'parent-two') return send(pageOf([row('second-child', { parentSessionId: parent })]));
      return send(url.searchParams.has('cursor') ? pageOf([row('last-child', { parentSessionId: parent }), ...children]) : pageOf(children, 'child-page-2'));
    }
    if (url.pathname === '/projects') return send([{ id: 'project', name: 'Project', cwd: '/fixture' }]);
    if (url.pathname === '/agent-configs') return send([{ id: 'profile', label: 'Agent', enabled: true, sessionSelectable: true, isDefault: true }]);
    if (url.pathname === '/opencode/auth/accounts') return send({ accounts: [] });
    if (url.pathname.includes('health')) return send({ healthy: true, status: 'ready' });
    const detail = [...roots, ...children].find(item => url.pathname === `/agent-sessions/${item.id}`);
    if (detail) return send({ session: detail, messages: [] });
    return send([]);
  });
  await page.route('**/tests/rail-children-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Rail fixture</title></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    const {default: React} = await import('/node_modules/.vite/deps/react.js');
    const {default: {createRoot}} = await import('/node_modules/.vite/deps/react-dom_client.js');
    const {FixtureProvider, useFixtures} = await import('/src/store.tsx');
    const {composeGateway} = await import('/src/gateway/index.ts');
    const {GatewayProvider} = await import('/src/gateway/context.tsx');
    const {SessionRail} = await import('/src/components/SessionRail.tsx');
    await import('/src/styles.css');
    const h = React.createElement;
    const gateway = composeGateway({mode:'live',apiBase:'http://127.0.0.1:65534',expectedApiBase:'http://127.0.0.1:65534',engineBase:'http://127.0.0.1:65533',expectedEngineBase:'http://127.0.0.1:65533',productionApiBase:'https://rail-fixture.invalid',taskToken:'public-fixture-only'});
    function Probe() { const state = useFixtures(); return h('main', {style:{width:'280px',height:'100vh',display:'grid',gridTemplateRows:'auto minmax(0,1fr)'}}, h('output', {'data-testid':'selection'}, state.selectedId), h(SessionRail,{collapsed:false,onToggle:()=>{},selectedProject:null,onSelectProject:()=>{}})); }
    createRoot(document.getElementById('root')).render(h(GatewayProvider,{gateway},h(FixtureProvider,null,h(Probe))));
  </script></body></html>` }));
  await page.goto('/tests/rail-children-fixture.html');
  await expect(page.getByTestId('session-parent-one')).toBeVisible();
  return { childRequests, writes, release };
}

test('initial load, paging, nested parents and repeated activation preserve selection and scroll', async ({ page }) => {
  const fixture = await open(page, { hold: true });
  await page.getByTestId('session-parent-one').click();
  const initial = page.locator('[data-load-parent="parent-one"]');
  await expect(initial).toHaveAccessibleName(`Load subagents for ${parentTitle} (parent-o)`);
  // Long parent context is accessible, while only the short continuation label is visible.
  expect(await initial.evaluate(element => { const copy = element.cloneNode(true) as HTMLElement; copy.querySelector('.sr-only')?.remove(); return copy.textContent?.trim(); })).toBe('Load subagents');
  const list = page.getByRole('region', { name: 'chats sessions' });
  await list.evaluate(element => { element.style.flex = '0 0 120px'; element.style.height = '120px'; element.scrollTop = element.scrollHeight; });
  const top = await list.evaluate(element => element.scrollTop);
  expect(top).toBeGreaterThan(0);
  await initial.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); element.click(); });
  await expect(initial).toHaveAttribute('aria-busy', 'true');
  await expect(initial.locator('.spin')).toBeVisible();
  await expect.poll(() => fixture.childRequests.length).toBe(1);
  fixture.release();
  await expect(page.getByTestId('session-nested')).toBeVisible();
  expect(await list.evaluate(element => element.scrollTop)).toBe(top);
  await expect(page.getByTestId('selection')).toHaveText('parent-one');
  await expect(initial).toHaveAccessibleName(`Load more subagents for ${parentTitle} (parent-o)`);
  await page.getByTestId('subagents-parent-one').click();
  await expect(page.getByTestId('session-nested')).toBeHidden();
  await expect(initial).toBeHidden();
  await expect(page.getByTestId('subagents-parent-one')).toHaveAttribute('aria-expanded', 'false');
  await page.getByTestId('subagents-parent-one').click();
  await expect(page.getByTestId('session-nested')).toBeVisible();
  await expect(initial).toBeVisible();
  expect(fixture.childRequests).toHaveLength(1);
  await page.locator('[data-load-parent="nested"]').click();
  await expect(page.getByTestId('session-grandchild')).toBeVisible();
  await expect(page.locator('[data-load-parent="nested"]')).toHaveCount(0);
  await initial.focus();
  await initial.press('Enter');
  await expect(page.getByTestId('session-last-child')).toBeVisible();
  await expect(page.getByTestId('session-child')).toHaveCount(1);
  await expect(page.getByTestId('session-nested')).toHaveCount(1);
  await expect(initial).toHaveCount(0);
  await expect(page.getByTestId('subagents-parent-one')).toBeFocused();
  await expect(page.getByTestId('session-parent-one')).toHaveAttribute('aria-current', 'true');
  await page.locator('[data-load-parent="parent-two"]').click();
  await expect(page.getByTestId('session-second-child')).toBeVisible();
  expect(fixture.childRequests.map(url => [url.searchParams.get('parentId'), url.searchParams.get('cursor')])).toEqual([['parent-one', null], ['nested', null], ['parent-one', 'child-page-2'], ['parent-two', null]]);
  expect(fixture.writes).toEqual([]);
});

test('failure has inline Retry and does not block other parents; expired cursors restart that branch', async ({ page }) => {
  const fixture = await open(page, { failFirst: true, expirePage: true });
  const loader = page.locator('[data-load-parent="parent-one"]');
  await loader.click();
  await expect(loader).toHaveText(/Could not load subagents. Retry/);
  await page.locator('[data-load-parent="parent-two"]').click();
  await expect(page.getByTestId('session-second-child')).toBeVisible();
  await loader.press('Enter');
  await expect(page.getByTestId('session-child')).toBeVisible();
  await loader.click();
  await expect(loader).toHaveText(/Subagent history expired. Retry/);
  await loader.click();
  await expect(loader).toHaveText(/Load more subagents/);
  expect(fixture.childRequests.at(-1)?.searchParams.has('cursor')).toBe(false);
  await expect(page.getByTestId('session-child')).toHaveCount(1);
});

for (const theme of ['light', 'dark']) test(`continuations are accessible at 200 percent in a narrow ${theme} RTL rail`, async ({ page }, testInfo) => {
  await open(page);
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.dir = 'rtl'; document.documentElement.style.zoom = '2'; document.querySelector('main')!.style.width = '228px'; }, theme);
  const loader = page.locator('[data-load-parent="parent-one"]');
  expect(await loader.evaluate(element => parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThanOrEqual(44);
  expect(await loader.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await loader.focus();
  await loader.press('Tab');
  await page.keyboard.press('Shift+Tab');
  expect(await loader.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle === 'solid')).toBe(true);
  const result = await new AxeBuilder({ page }).include('.session-rail').analyze();
  expect(result.violations).toEqual([]);
  await page.getByRole('complementary', { name: 'Agents', exact: true }).screenshot({ path: testInfo.outputPath(`child-loading-${theme}.png`) });
});
