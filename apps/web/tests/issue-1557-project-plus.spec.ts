import { expect, test, type Page } from '@playwright/test';

const projects = [
  { id: 'project-alpha', name: 'Alpha', cwd: '/fixture/alpha', vcsBranch: 'alpha-main', archivedAt: null },
  { id: 'project-beta', name: 'Beta', cwd: '/fixture/beta', vcsBranch: 'beta-main', archivedAt: null },
];

const row = (id: string, projectId: string, cwd: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  status: 'idle',
  category: 'chat',
  profileId: 'profile',
  cwd,
  projectId,
  createdAt: '2026-09-24T12:00:00Z',
  ...extra,
});

async function open(page: Page) {
  const sessions = [
    row('alpha-session', 'project-alpha', '/fixture/alpha'),
    row('beta-session', 'project-beta', '/fixture/beta'),
    row('unassigned-session', '', '/fixture/loose'),
  ];
  const writes: Record<string, unknown>[] = [];
  let created = 0;
  await page.routeWebSocket(/\/ws\/agents$/, () => {});
  await page.route(url => ['http://127.0.0.1:65534', 'http://127.0.0.1:65533', 'https://project-plus.invalid'].includes(url.origin), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const send = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (url.pathname === '/agent-sessions' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push(body);
      const session = row(`created-${++created}`, String(body.projectId ?? ''), String(body.cwd), { ...body, name: body.name });
      sessions.push(session);
      return send(session, 201);
    }
    if (url.pathname === '/agent-sessions') return send({ sessions, ancestors: [], pageInfo: { nextCursor: null, hasMore: false } });
    if (url.pathname === '/projects') return send(projects);
    if (url.pathname === '/agent-configs') return send([{ id: 'profile', label: 'Agent', enabled: true, sessionSelectable: true, isDefault: true }]);
    if (url.pathname === '/opencode/auth/accounts') return send({ accounts: [] });
    if (url.pathname === '/tasks') return send([]);
    if (url.pathname.endsWith('/branches')) {
      const project = projects.find(item => url.pathname === `/projects/${item.id}/branches`);
      return send({ current: project?.vcsBranch ?? null, local: project?.vcsBranch ? [project.vcsBranch] : [], recent: [] });
    }
    if (url.pathname.includes('health')) return send({ healthy: true, status: 'ready' });
    const session = sessions.find(item => url.pathname === `/agent-sessions/${item.id}`);
    if (session) return send({ session, messages: [] });
    return send([]);
  });
  await page.route('**/tests/project-plus-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Project plus fixture</title></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    const {default: React} = await import('/node_modules/.vite/deps/react.js');
    const {default: {createRoot}} = await import('/node_modules/.vite/deps/react-dom_client.js');
    const {FixtureProvider} = await import('/src/store.tsx');
    const {composeGateway} = await import('/src/gateway/index.ts');
    const {GatewayProvider} = await import('/src/gateway/context.tsx');
    const {AgentsWorkspace} = await import('/src/components/AgentsWorkspace.tsx');
    const {Shell} = await import('/src/components/Shell.tsx');
    await import('/src/styles.css');
    const h = React.createElement;
    const gateway = composeGateway({mode:'live',apiBase:'http://127.0.0.1:65534',expectedApiBase:'http://127.0.0.1:65534',engineBase:'http://127.0.0.1:65533',expectedEngineBase:'http://127.0.0.1:65533',productionApiBase:'https://project-plus.invalid',taskToken:'public-fixture-only'});
    createRoot(document.getElementById('root')).render(h(GatewayProvider,{gateway},h(FixtureProvider,null,h(Shell,{route:'/agents'},h(AgentsWorkspace)))));
  </script></body></html>` }));
  await page.goto('/tests/project-plus-fixture.html');
  await expect(page.getByTestId('group-project-project-alpha')).toBeAttached();
  await expect(page.getByTestId('group-project-project-beta')).toBeAttached();
  return { writes };
}

test('1557:project-heading-plus:1 project headings expose named plus controls but No project does not', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: 'New session in Alpha' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New session in Beta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New session in No project' })).toHaveCount(0);
});

test('1557:project-heading-plus:2 plus preserves collapsed and expanded state and prefills without selecting the project', async ({ page }) => {
  await open(page);
  const group = page.getByTestId('group-project-project-beta');
  const plus = page.getByRole('button', { name: 'New session in Beta' });
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await plus.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('advanced-cwd')).toHaveValue('/fixture/beta');
  await expect(page.getByTestId('advanced-branch')).toHaveValue('beta-main');
  await expect(page.getByTestId('selected-agent-project')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await plus.click();
  await expect(group).toHaveAttribute('aria-expanded', 'true');
});

test('1557:project-heading-plus:3 submit binds the project with and without worktree isolation and omits it outside the project', async ({ page }) => {
  const fixture = await open(page);
  const plus = page.getByRole('button', { name: 'New session in Beta' });
  for (const isolate of [false, true]) {
    await plus.click();
    await page.getByTestId('advanced-name').fill(isolate ? 'Isolated beta' : 'Beta session');
    if (isolate) await page.getByTestId('advanced-isolate-worktree').check();
    await page.getByTestId('advanced-create').click();
    await expect.poll(() => fixture.writes.length).toBe(isolate ? 2 : 1);
    expect(fixture.writes.at(-1)).toMatchObject({ projectId: 'project-beta', cwd: '/fixture/beta', isolateWorktree: isolate });
  }
  await plus.click();
  await page.getByTestId('advanced-name').fill('Outside beta');
  await page.getByTestId('advanced-cwd').fill('/fixture/elsewhere');
  await page.getByTestId('advanced-create').click();
  await expect.poll(() => fixture.writes.length).toBe(3);
  expect(fixture.writes[2]).not.toHaveProperty('projectId');
});

test('1557:project-heading-plus:4 creation inserts, selects and reveals the new project row without refresh', async ({ page }) => {
  await open(page);
  const group = page.getByTestId('group-project-project-beta');
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'New session in Beta' }).click();
  await page.getByTestId('advanced-name').fill('Created beta');
  await page.getByTestId('advanced-create').click();
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('session-created-1')).toBeVisible();
  await expect(page.getByTestId('session-created-1')).toHaveAttribute('aria-current', 'true');
});

test('1557:project-heading-plus:5 keyboard reaches plus and Escape restores focus', async ({ page }) => {
  await open(page);
  const group = page.getByTestId('group-project-project-beta');
  const plus = page.getByRole('button', { name: 'New session in Beta' });
  await group.focus();
  await page.keyboard.press('Tab');
  await expect(plus).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('advanced-session-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(plus).toBeFocused();
});
