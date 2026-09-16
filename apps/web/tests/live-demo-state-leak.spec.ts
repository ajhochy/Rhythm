import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const api = process.env.RHYTHM_API_BASE ?? (process.env.RHYTHM_SANDBOX_API_PORT ? `http://127.0.0.1:${process.env.RHYTHM_SANDBOX_API_PORT}` : live ? '' : 'http://127.0.0.1:65534');
const engine = process.env.RHYTHM_ENGINE_BASE ?? (process.env.RHYTHM_SANDBOX_ENGINE_PORT ? `http://127.0.0.1:${process.env.RHYTHM_SANDBOX_ENGINE_PORT}` : live ? '' : 'http://127.0.0.1:65533');
// Fail closed before browser traffic: no implicit live-service defaults.
if (live) for (const base of [api, engine]) {
  const url = new URL(base);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || ['4001', '4096'].includes(url.port)) throw new Error('Assign isolated RHYTHM_API_BASE/RHYTHM_ENGINE_BASE or RHYTHM_SANDBOX_*_PORT');
}
test.use({ trace: 'on', screenshot: 'on' });
const rows = ['real-one', 'real-two'].map(id => ({ id, name: id, status: 'idle', profileId: 'profile', createdAt: '2026-09-12T00:00:00Z' }));

// Only network/bootstrap boundaries are replaced: the real App, Shell, store,
// session gateway and Transcript compose together, including retained demo state.
async function open(page: Page, mode: 'live' | 'fixture', mock = true) {
  page.on('pageerror', error => console.log('renderer:', error.message));
  if (!mock) {
    await page.context().grantPermissions(['local-network-access']);
    page.on('console', message => { if (message.type() === 'error') console.log(message.text()); });
    page.on('requestfailed', request => console.log('request failed:', request.url(), request.failure()?.errorText));
  }
  let socket: WebSocketRoute | undefined;
  const details: string[] = [];
  await page.route('https://demo-contract.invalid/**', route => route.fulfill({ json: [] }));
  if (mock) {
    await page.routeWebSocket(/\/ws\/agents$/, ws => { socket = ws; });
    await page.route(url => [api, engine].includes(url.origin), route => {
      const path = new URL(route.request().url()).pathname;
      const session = rows.find(row => path === `/agent-sessions/${row.id}`);
      if (/^\/agent-sessions\/[^/]+$/.test(path)) details.push(path);
      return route.fulfill({ json: path === '/agent-sessions' ? { sessions: rows } : session ? { session, messages: [{ sdkMessageId: session.id, role: 'output', parts: [{ type: 'text', text: `Actual transcript for ${session.id}` }] }] } : path === '/agent-configs' ? [{ id: 'profile', label: 'Profile', enabled: true }] : path.includes('health') ? { healthy: true } : [] });
    });
  }
  await page.route('**/tests/live-demo-contract.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    const {default: React} = await import('/node_modules/.vite/deps/react.js');
    const {default: {createRoot}} = await import('/node_modules/.vite/deps/react-dom_client.js');
    const {App} = await import('/src/App.tsx');
    const {FixtureProvider, useFixtures} = await import('/src/store.tsx');
    const {composeGateway} = await import('/src/gateway/index.ts');
    const {GatewayProvider} = await import('/src/gateway/context.tsx');
    await import('/src/styles.css');
    const h = React.createElement;
    const gateways = { fixture: composeGateway({mode:'fixture'}), live: composeGateway({mode:'live',apiBase:${JSON.stringify(api)},expectedApiBase:${JSON.stringify(api)},engineBase:${JSON.stringify(engine)},expectedEngineBase:${JSON.stringify(engine)},productionApiBase:'https://demo-contract.invalid',taskToken:'public-demo-contract'}) };
    function Probe() { const state = useFixtures(); return h(React.Fragment, null,
      h('button', {onClick: () => state.setDemo('resumable')}, 'Request demo at store boundary'),
      h('output', {'data-testid':'selection'}, state.selectedId), h(App)); }
    function Root() { const [mode,setMode] = React.useState('${mode}'); return h(React.Fragment,null,
      h('button',{onClick:()=>setMode('live')},'Switch gateway to live'),
      h(GatewayProvider,{gateway:gateways[mode]},h(FixtureProvider,null,h(Probe)))); }
    createRoot(document.getElementById('root')).render(h(Root));
  </script>` }));
  await page.goto('/tests/live-demo-contract.html#/agents?demo=resumable');
  return { details, send: (event: object) => socket!.send(JSON.stringify(event)) };
}

test('c1/c2/c4/c5 live demo URL and actions cannot replace real transcripts or select fixture IDs', async ({ page }) => {
  // Regression: query demo=resumable masks healthy messages, even after changing sessions.
  const { details, send } = await open(page, 'live');
  for (const id of ['real-one', 'real-two']) {
    await page.getByTestId(`session-${id}`).click();
    await expect(page.getByTestId('transcript')).toContainText(`Actual transcript for ${id}`);
    await page.getByRole('button', { name: 'Request demo at store boundary' }).click();
    await expect(page.getByTestId('selection')).toHaveText(id);
    await expect(page.getByTestId('resumable-state')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Resume fixture session' })).toHaveCount(0);
  }
  await page.getByTestId('account-button').click();
  await expect(page.getByTestId('demo-states-button')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('background-activity-button').click();
  await expect(page.getByRole('menuitem', { name: /Integration health sweep|Volunteer coverage audit/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'View agent sessions' }).click();
  await expect(page).toHaveURL(/#\/agents$/);
  await expect(page.getByTestId('selection')).toHaveText('real-two');
  expect(details).toEqual(expect.arrayContaining(['/agent-sessions/real-one', '/agent-sessions/real-two']));
  expect(details.every(path => rows.some(row => path === `/agent-sessions/${row.id}`))).toBe(true);
  send({ id: 'real-two', type: 'error', message: 'Real provider failure' });
  await expect(page.getByRole('alert').filter({ hasText: 'Real provider failure' })).toBeVisible();
  await expect(page.getByTestId('transcript')).toContainText('Actual transcript for real-two');
});

test('c1/c3/c5 fixture resumable remains available but stale demo cannot mask live selection', async ({ page }) => {
  await open(page, 'fixture');
  await expect(page.getByTestId('resumable-state')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume fixture session' })).toBeVisible();
  await page.getByTestId('account-button').click();
  await page.getByTestId('demo-states-button').click();
  await expect(page.getByTestId('demo-resumable')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch gateway to live' }).click();
  await page.getByTestId('session-real-two').click();
  await expect(page.getByTestId('transcript')).toContainText('Actual transcript for real-two');
  await expect(page.getByTestId('resumable-state')).toHaveCount(0);
});

for (const [state, text] of [
  ['resumable', 'Agent runtime unavailable'],
  ['empty', 'No sessions in this view'],
  ['loading', 'Loading the session…'],
  ['no-provider', 'Choose a model to begin'],
] as const) test(`c3 fixture ${state} control renders its distinct state`, async ({ page }) => {
  // Regression: the live-only guard accidentally suppresses fixture controls or panels.
  await open(page, 'fixture');
  await page.getByTestId('account-button').click();
  await page.getByTestId('demo-states-button').click();
  await page.getByTestId(`demo-${state}`).click();
  await expect(page).toHaveURL(new RegExp(`demo=${state}$`));
  const panel = page.getByTestId(`${state}-state`);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(text);
  if (state === 'loading') await expect(panel).toHaveAttribute('aria-busy', 'true');
  if (state === 'resumable') await expect(panel.getByRole('button', { name: 'Resume fixture session' })).toBeVisible();
  if (state === 'no-provider') await expect(panel.getByRole('button', { name: 'Open Profiles' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('c6 isolated live API and engine stay healthy with demo URL', async ({ page, request }) => {
  test.skip(!live, 'Requires explicitly assigned isolated API/engine bases or sandbox ports');
  // Regression: a stale Vite process serves the old demo guard despite current files.
  for (const [path, marker] of [
    ['/src/components/Transcript.tsx', /const demo = sessionGatewayMode === "live" \? void 0 : fixtureDemo/],
    ['/src/components/Shell.tsx', /if \(live\) return;\s+const queryDemo =/],
    ['/src/store.tsx', /const setDemo = \(next\) => \{\s+if \(live\) return;/],
  ] as const) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(marker.test(await response.text()), `served repair marker: ${path}`).toBe(true);
  }
  const apiHealth = await request.get(`${api}/opencode/health`);
  expect(apiHealth.ok()).toBe(true);
  expect(await apiHealth.json()).toMatchObject({ status: 'ready', bridgeLive: true });
  const engineHealth = await request.get(`${engine}/global/health`);
  expect(engineHealth.ok()).toBe(true);
  expect(await engineHealth.json()).toMatchObject({ healthy: true });
  await open(page, 'live', false);
  await expect(page.getByTestId('environment-receipt')).toContainText('Environment: Live');
  await expect(page.getByTestId('resumable-state')).toHaveCount(0);
  await expect(page.getByTestId('selection')).not.toHaveText('session-completed');
});
