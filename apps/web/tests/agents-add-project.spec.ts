import { expect, test, type Page } from '@playwright/test';
import { createLiveSessionsGateway } from '../src/gateway/sessions';

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, status: 'idle', category: 'chat', profileId: 'profile', cwd: '/fixture/existing', projectId: 'existing-project', createdAt: '2026-09-18T00:00:00Z', ...extra });
const pageOf = (sessions: unknown[]) => ({ sessions, ancestors: [], pageInfo: { nextCursor: null, hasMore: false } });

async function open(page: Page, options: { empty?: boolean; picker?: string | null; failSave?: boolean; holdSave?: boolean } = {}) {
  const projects: Record<string, unknown>[] = [];
  const sessions = options.empty ? [] : [row('existing')];
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let failSave = options.failSave;
  await page.routeWebSocket(/\/ws\/agents$/, () => {});
  await page.route(url => ['http://127.0.0.1:65534', 'http://127.0.0.1:65533', 'https://project-fixture.invalid'].includes(url.origin), async route => {
    const request = route.request(); const url = new URL(request.url());
    const send = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (request.method() !== 'GET') {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ path: url.pathname, body });
      // Agent-local requests must never receive the production bearer.
      expect(request.headers().authorization).toBeUndefined();
      if (url.pathname === '/projects' && request.method() === 'POST') {
        if (options.holdSave && writes.length === 1) await held;
        if (failSave) { failSave = false; return send({ error: 'Unavailable' }, 503); }
        const cwd = String(body.cwd).trim().replace(/\/+$/, '');
        if (cwd === '/duplicate') return send({ error: { code: 'BAD_REQUEST', message: 'A project already exists at this folder ("Existing").' } }, 400);
        if (cwd === '/invalid') return send({ error: { code: 'BAD_REQUEST', message: 'cwd must be an absolute path' } }, 400);
        const project = { id: `project-${projects.length + 1}`, name: body.name, cwd, vcsBranch: null, archivedAt: null };
        projects.push(project); return send(project, 201);
      }
      if (url.pathname === '/agent-sessions' && request.method() === 'POST') {
        const project = projects.find(project => project.id === body.projectId);
        if (!project || body.cwd !== project.cwd) return send({ error: 'Wrong project binding' }, 400);
        const session = row('new-session', { ...body, name: body.name || 'New project session' });
        sessions.push(session); return send(session, 201);
      }
      return send({ error: 'Unexpected mutation' }, 500);
    }
    if (url.pathname === '/projects') return send(projects);
    if (url.pathname === '/agent-sessions') return send(pageOf(url.searchParams.get('archivedOnly') ? [] : sessions));
    if (url.pathname === '/agent-configs') return send([{ id: 'profile', label: 'Agent', enabled: true, sessionSelectable: true, isDefault: true }]);
    if (url.pathname === '/opencode/auth/accounts') return send({ accounts: [] });
    if (url.pathname.endsWith('/branches')) return send({ current: null, local: [], recent: [] });
    if (url.pathname.includes('health')) return send({ healthy: true, status: 'ready' });
    const session = sessions.find(item => url.pathname === `/agent-sessions/${item.id}`);
    if (session) return send({ session, messages: [] });
    return send([]);
  });
  const picker = Object.hasOwn(options, 'picker') ? `window.rhythmShell = {selectDirectory: async () => ${JSON.stringify(options.picker)}};` : '';
  await page.route('**/tests/add-project-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Add project fixture</title></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    ${picker}
    const {default: React} = await import('/node_modules/.vite/deps/react.js');
    const {default: {createRoot}} = await import('/node_modules/.vite/deps/react-dom_client.js');
    const {FixtureProvider, useFixtures} = await import('/src/store.tsx');
    const {composeGateway} = await import('/src/gateway/index.ts');
    const {GatewayProvider} = await import('/src/gateway/context.tsx');
    const {AgentsWorkspace} = await import('/src/components/AgentsWorkspace.tsx');
    await import('/src/styles.css');
    const h = React.createElement;
    const gateway = composeGateway({mode:'live',apiBase:'http://127.0.0.1:65534',expectedApiBase:'http://127.0.0.1:65534',engineBase:'http://127.0.0.1:65533',expectedEngineBase:'http://127.0.0.1:65533',productionApiBase:'https://project-fixture.invalid',taskToken:'public-fixture-only'});
    function Probe() { const state = useFixtures(); return h('main', {style:{height:'100vh',display:'grid',gridTemplateRows:'auto minmax(0,1fr)'}}, h('output', {'data-testid':'selection'}, state.selectedId), h(AgentsWorkspace)); }
    createRoot(document.getElementById('root')).render(h(GatewayProvider,{gateway},h(FixtureProvider,null,h(Probe))));
  </script></body></html>` }));
  await page.goto('/tests/add-project-fixture.html');
  await expect(page.getByTestId('rail-add-project')).toBeVisible();
  if (!options.empty) await expect(page.getByTestId('session-existing')).toBeVisible();
  return { projects, writes, release };
}

async function fillProject(page: Page, name = 'Research', cwd = '/fixture/research/') {
  await page.getByTestId('rail-add-project').click();
  await expect(page.getByTestId('project-name')).toBeFocused();
  await page.getByTestId('project-name').fill(name);
  await page.getByTestId('project-cwd').fill(cwd);
}

test('add an empty project, reload, select it and create a correctly bound session without running an agent', async ({ page }) => {
  const fixture = await open(page, { empty: true, holdSave: true });
  await expect(page.getByRole('region', { name: 'chats sessions' }).getByRole('button', { name: 'Add project', exact: true })).toBeVisible();
  await fillProject(page);
  const create = page.getByRole('button', { name: 'Create', exact: true });
  await create.press('Enter');
  await expect(page.getByRole('button', { name: 'Creating…', exact: true })).toBeDisabled();
  await page.getByTestId('add-project-dialog').locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await expect.poll(() => fixture.writes.length).toBe(1);
  fixture.release();
  await expect(page.getByTestId('selected-agent-project')).toContainText('Research');
  await expect(page.getByTestId('selected-agent-project')).toContainText('/fixture/research');
  await expect(page.getByTestId('group-project-project-1')).toContainText('Research');
  await expect(page.getByRole('button', { name: 'Selected project Research' })).toHaveAttribute('aria-pressed', 'true');
  expect(fixture.writes.map(write => write.path)).toEqual(['/projects']);
  await page.reload();
  await expect(page.getByTestId('group-project-project-1')).toBeVisible();
  await page.getByRole('button', { name: 'Select project Research' }).click();
  await expect(page.getByTestId('selected-agent-project')).toContainText('/fixture/research');
  await page.getByTestId('new-chat-instant').click();
  await expect(page.getByTestId('session-new-session')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('selected-agent-project')).toHaveCount(0);
  expect(fixture.writes).toEqual([
    { path: '/projects', body: { name: 'Research', cwd: '/fixture/research/' } },
    { path: '/agent-sessions', body: { name: '', cwd: '/fixture/research', projectId: 'project-1', profileId: 'profile', isolateWorktree: false } },
  ]);
});

test('manual validation, duplicate directory, backend path error and failed save stay in the form and preserve selection', async ({ page }) => {
  const fixture = await open(page, { failSave: true });
  await page.getByTestId('session-existing').click();
  await fillProject(page, 'Research', 'relative/path');
  const create = page.getByRole('button', { name: 'Create', exact: true });
  await create.click();
  await expect(page.getByRole('alert')).toContainText('Enter an absolute directory path');
  expect(fixture.writes).toHaveLength(0);
  await page.getByTestId('project-cwd').fill('/fixture/research');
  await create.click();
  await expect(page.getByTestId('add-project-dialog').getByRole('alert')).toContainText('Project could not be saved');
  for (const [cwd, message] of [['/duplicate', 'A project already exists at this folder'], ['/invalid', 'Working directory must be an absolute path']]) {
    await page.getByTestId('project-cwd').fill(cwd);
    await create.click();
    await expect(page.getByTestId('add-project-dialog').getByRole('alert')).toContainText(message);
    await expect(create).toBeEnabled();
  }
  await page.getByTestId('add-project-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('session-existing')).toHaveAttribute('aria-current', 'true');
  expect(fixture.projects).toHaveLength(0);
});

test('native picker cancellation and form Escape preserve path, selection and focus without creating anything', async ({ page }) => {
  const fixture = await open(page, { picker: null });
  await page.getByTestId('session-existing').click();
  await fillProject(page);
  await page.getByRole('button', { name: 'Choose folder…', exact: true }).click();
  await expect(page.getByTestId('project-cwd')).toHaveValue('/fixture/research/');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('add-project-dialog')).toHaveCount(0);
  await expect(page.getByTestId('rail-add-project')).toBeFocused();
  await expect(page.getByTestId('session-existing')).toHaveAttribute('aria-current', 'true');
  expect(fixture.writes).toEqual([]);
});

test('picker selection supports long paths and advanced creation inherits only the chosen project context', async ({ page }) => {
  const cwd = '/fixture/' + 'long-working-directory/'.repeat(8) + 'research';
  const fixture = await open(page, { picker: cwd });
  await fillProject(page, 'Long research project name '.repeat(4));
  await page.getByRole('button', { name: 'Choose folder…', exact: true }).click();
  await expect(page.getByTestId('project-cwd')).toHaveValue(cwd);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('selected-agent-project')).toContainText(cwd);
  await page.getByTestId('new-session-advanced').click();
  await expect(page.getByTestId('advanced-cwd')).toHaveValue(cwd);
  await page.getByTestId('advanced-name').fill('Explicit project session');
  await page.getByTestId('advanced-create').click();
  await expect(page.getByTestId('session-new-session')).toBeVisible();
  expect(fixture.writes.at(-1)?.body).toMatchObject({ projectId: 'project-1', cwd, name: 'Explicit project session', createBranch: false, isolateWorktree: false });
  expect(fixture.writes.map(write => write.path)).toEqual(['/projects', '/agent-sessions']);
});

test('gateway preserves project fields, existing request auth and readable backend errors', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const gateway = createLiveSessionsGateway('http://project.invalid', 'fixture', async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify(init?.method === 'POST' ? { id: 'p', name: 'Project', cwd: '/normalized', vcsBranch: 'main' } : [{ id: 'p', name: 'Project', cwd: '/normalized' }]), { status: init?.method === 'POST' ? 201 : 200 });
  }, class {} as unknown as typeof WebSocket);
  expect(await gateway.createProject!({ name: 'Project', cwd: '/normalized/' })).toMatchObject({ id: 'p', cwd: '/normalized', vcsBranch: 'main' });
  expect(JSON.parse(String(requests[0].init?.body))).toEqual({ name: 'Project', cwd: '/normalized/' });
  expect(new Headers(requests[0].init?.headers).get('content-type')).toBe('application/json');
  expect(await gateway.projectLabels!()).toEqual([expect.objectContaining({ id: 'p', cwd: '/normalized' })]);
  const failing = createLiveSessionsGateway('http://project.invalid', 'fixture', async () => new Response(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'A project already exists at this folder.' } }), { status: 400 }), class {} as unknown as typeof WebSocket);
  await expect(failing.createProject!({ name: 'Project', cwd: '/duplicate' })).rejects.toThrow('A project already exists at this folder.');
});

// The orchestrator supplies a disposable existing directory and an enabled profile
// in the canonical sandbox. No prompts, init, branch changes or file writes are sent.
test('live sandbox project persists and a new session retains its exact directory and project identity', async ({ request }) => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires the orchestrator-owned dev sandbox');
  const api = process.env.RHYTHM_API_BASE ?? 'http://127.0.0.1:4098';
  const url = new URL(api);
  expect(url.hostname).toBe('127.0.0.1');
  expect(url.protocol).toBe('http:');
  expect(url.port).toBe(String(process.env.RHYTHM_SANDBOX_API_PORT ?? 4098));
  expect(['4001', '4096']).not.toContain(url.port);
  const cwd = process.env.RHYTHM_AGENT_PROJECT_TEST_CWD;
  const profileId = process.env.RHYTHM_AGENT_PROJECT_TEST_PROFILE_ID;
  expect(cwd, 'Supply a disposable existing absolute directory').toMatch(/^\//);
  expect(profileId, 'Supply an enabled sandbox agent profile').toBeTruthy();
  const created = await request.post(`${api}/projects`, { data: { name: `Rail contract ${Date.now()}`, cwd: `${cwd}/` } });
  expect(created.status()).toBe(201);
  const project = await created.json();
  expect(project.cwd).toBe(cwd!.replace(/\/+$/, ''));
  const readback = await request.get(`${api}/projects?includeArchived=true`);
  expect(await readback.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: project.id, name: project.name, cwd: project.cwd })]));
  const duplicate = await request.post(`${api}/projects`, { data: { name: 'Duplicate rail contract', cwd: project.cwd } });
  expect(duplicate.status()).toBe(400);
  expect((await duplicate.json()).error.message).toContain('already exists');
  const sessionResponse = await request.post(`${api}/agent-sessions`, { data: { name: 'Rail project contract', profileId, cwd: project.cwd, projectId: project.id, isolateWorktree: false } });
  expect(sessionResponse.status()).toBe(201);
  const session = await sessionResponse.json();
  const detail = await request.get(`${api}/agent-sessions/${session.id}?transcriptLimit=50`);
  expect((await detail.json()).session).toMatchObject({ id: session.id, cwd: project.cwd, projectId: project.id });
});
