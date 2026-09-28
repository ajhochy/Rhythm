import { createHash } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';

// The research magazine is a production live artifact opened in the sandboxed artifact viewer.
// Regression: Magazine did window.open(blob:), which the desktop shell drops, so nothing appeared.

const ORIGIN = 'http://127.0.0.1:4178';
const ARTIFACT = '0b6f7d1e-6a1c-4c7e-9a55-3f2d1c0b9a8e';
const project = {
  id: 'research-project-1', ownerUserId: 81, name: 'Fantasy Football Week 4', question: 'Who should I add?', goals: [], domain: null,
  profileId: 'research', passConfig: [], modelPolicy: {}, criticConfig: {}, synthesisConfig: {}, scheduleRef: null,
  budget: { maxPasses: 1, maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 }, magazineArtifactId: null as string | null,
  archivedAt: null, createdAt: '2026-09-28T19:47:00.000Z', updatedAt: '2026-09-28T19:47:00.000Z',
};
const run = (id: string) => ({
  id, projectId: project.id, ownerUserId: 81, triggerType: 'manual', configSnapshot: project, status: 'complete',
  progress: { stages: [{ id: `${id}-e`, role: 'evidence', status: 'done' }, { id: `${id}-s`, role: 'synthesis', status: 'done', report: '# Final' }] },
  diagnostics: {}, startedAt: '2026-09-28T21:50:00.000Z', completedAt: '2026-09-28T21:58:00.000Z', createdAt: '2026-09-28T21:50:00.000Z',
  canonicalArtifact: null, artifacts: [], sources: [{ id: 'source-1', canonical_url: 'https://www.nfl.com/stats/player-stats/' }], usage: { tokens: 10, costUsd: 0 },
});
const magazineHtml = (runId: string, section: string) => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'"><title>Week 4</title></head><body><article><h2 id="${section.toLowerCase().replace(/\W+/g, '-')}">${section}</h2><p>Magazine for ${runId}: add Juwan Johnson.</p></article></body></html>`;
const artifactRow = (state: unknown, bundleHash = 'a'.repeat(64)) => ({
  id: ARTIFACT, type: 'html', title: `${project.name} — research magazine`, ownerUserId: 81, workspaceId: 8, visibility: 'private',
  currentBundleRevision: 1, currentBundleHash: bundleHash, currentStateRevision: 1, currentStateHash: 'b'.repeat(64), declaredCapabilities: [],
  createdAt: '2026-09-28T22:00:00.000Z', updatedAt: '2026-09-28T22:00:00.000Z', updatedByDisplayName: 'Avery Owner', deletedAt: null, state,
});
const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type' };
const json = (route: Route, status: number, value: unknown) => route.fulfill({ status, headers: cors, json: value });
const html = (route: Route, body: string) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/html' }, body });
type Seen = { method: string; path: string; body: unknown };
type Handler = (route: Route, url: URL, method: string) => Promise<boolean> | boolean;

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.route('**/*', (route) => new URL(route.request().url()).origin === ORIGIN ? route.continue() : route.abort());
});

async function signedIn(page: Page, hash: string, handler: Handler, artifactTabIds: string[] = []): Promise<Seen[]> {
  const seen: Seen[] = [];
  await page.addInitScript((tabs) => {
    (window as unknown as { __saved: unknown[] }).__saved = [];
    Object.defineProperty(window, 'rhythmShell', { configurable: true, value: Object.freeze({
      version: 8,
      gateway: Object.freeze({ apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097', productionApiBase: 'https://api.vcrcapps.com' }),
      auth: Object.freeze({ signInWithGoogle: async () => ({ sessionToken: 'magazine-token', user: { id: 81, name: 'Avery Owner', email: 'avery@example.test', role: 'admin', artifactTabIds: tabs } }) }),
      saveFile: async (name: string, contents: string) => { (window as unknown as { __saved: unknown[] }).__saved.push([name, contents]); return `/saved/${name}`; },
    }) });
  }, artifactTabIds);
  await page.route('http://127.0.0.1:4097/**', (route) => json(route, 200, { healthy: true }));
  const api = async (route: Route) => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let body: unknown; try { body = request.postDataJSON(); } catch { body = undefined; }
    seen.push({ method, path: url.pathname, body });
    if (await handler(route, url, method)) return;
    if (url.pathname === '/health') return json(route, 200, { healthy: true });
    if (url.pathname === '/workspaces/me') return json(route, 200, { id: 8, name: 'Workspace' });
    if (url.pathname === '/users/me/preferences') return json(route, 200, { id: 81, artifactTabIds: (body as { artifactTabIds?: string[] } | undefined)?.artifactTabIds ?? [] });
    if (url.pathname === '/agent-configs') return json(route, 200, [{ id: 'research', label: 'Research', icon: 'RS', enabled: true, isAgent: true, isManager: false, sessionSelectable: true }]);
    if (url.pathname === '/agent-sessions') return json(route, 200, { sessions: [], ancestors: [], pageInfo: { hasMore: false, nextCursor: null } });
    if (url.pathname === '/agent-approvals' || url.pathname === '/notifications' || url.pathname.endsWith('/pending-permissions')) return json(route, 200, []);
    return json(route, 404, { error: { code: 'NOT_FOUND' } });
  };
  await page.route('http://127.0.0.1:4098/**', api);
  await page.route('https://api.vcrcapps.com/**', api);
  await page.goto(`/${hash}`);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  return seen;
}

const researchRoutes = (runs: ReturnType<typeof run>[]): Handler => (route, url) => {
  if (url.pathname === '/agent-research/projects') return json(route, 200, [project]).then(() => true);
  if (url.pathname === `/agent-research/projects/${project.id}/runs`) return json(route, 200, runs).then(() => true);
  const detail = runs.find((candidate) => url.pathname === `/agent-research/projects/${project.id}/runs/${candidate.id}`);
  if (detail) return json(route, 200, detail).then(() => true);
  const magazine = runs.find((candidate) => url.pathname === `/agent-research/projects/${project.id}/runs/${candidate.id}/magazine`);
  if (magazine) return html(route, magazineHtml(magazine.id, magazine.id === 'run-1' ? 'Waiver targets' : 'Trade targets')).then(() => true);
  return false;
};

test('Magazine publishes the run into one live artifact and opens it in the sandboxed viewer; republishing is a no-op', async ({ page }) => {
  let created: { bundle: { html: string; css: string; js: string }; state: Record<string, unknown> } | null = null;
  let linked: string | null = null;
  const seen = await signedIn(page, '#/tools/deep-research', async (route, url, method) => {
    if (url.pathname === '/agent-research/projects') { await json(route, 200, [{ ...project, magazineArtifactId: linked }]); return true; }
    if (await researchRoutes([run('run-1')])(route, url, method)) return true;
    if (url.pathname === '/live-artifacts' && method === 'POST') {
      created = route.request().postDataJSON();
      await json(route, 201, artifactRow(created!.state, createHash('sha256').update(JSON.stringify(created!.bundle)).digest('hex')));
      return true;
    }
    if (url.pathname === `/agent-research/projects/${project.id}/magazine-artifact`) { linked = ARTIFACT; await json(route, 200, { ...project, magazineArtifactId: ARTIFACT }); return true; }
    if (url.pathname === `/live-artifacts/${ARTIFACT}` && method === 'GET' && created) {
      await json(route, 200, artifactRow(created.state, createHash('sha256').update(JSON.stringify(created.bundle)).digest('hex'))); return true;
    }
    if (url.pathname === `/live-artifacts/${ARTIFACT}/render` && created) { await html(route, `<!doctype html><html><head></head><body>${created.bundle.html}</body></html>`); return true; }
    return false;
  });
  await expect(page.getByRole('heading', { name: 'Run run-1' })).toBeVisible();
  let popups = 0; page.on('popup', () => { popups++; });
  await page.getByTestId('research-magazine').click();
  await expect(page).toHaveURL(new RegExp(`#/dashboard\\?artifactId=${ARTIFACT}`));
  await expect(page.getByRole('tab', { name: `${project.name} — research magazine` })).toHaveAttribute('aria-selected', 'true');
  const frame = page.locator('[data-testid="live-artifact-surface"]:visible').getByTestId('live-artifact-frame');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frame.contentFrame().getByText('Magazine for run-1: add Juwan Johnson.')).toBeVisible();
  await expect(page.getByTestId('research-magazine-versions')).toContainText('v1 (current)');
  expect(popups).toBe(0);

  // Published bundle: the magazine's own script-src 'none' CSP is dropped (the render supplies the policy),
  // and the in-frame script only talks to the host through rhythm.request.
  expect(created!.bundle.html).not.toMatch(/Content-Security-Policy/);
  expect(created!.bundle.js).toContain("'research.ask'");
  expect(created!.state).toMatchObject({ kind: 'research-magazine', projectId: project.id, runId: 'run-1', versions: [{ version: 1, runId: 'run-1', headings: ['Waiver targets'] }], comments: [] });
  expect(seen.filter((entry) => entry.method === 'PUT' && entry.path.endsWith('/magazine-artifact'))[0]?.body).toEqual({ artifactId: ARTIFACT });

  // Export from the viewer goes through the native save bridge.
  await page.route(`http://127.0.0.1:4098/agent-research/projects/${project.id}/runs/run-1/export*`, (route) => html(route, '<h1>Exported</h1>'));
  await page.getByTestId('research-magazine-export-html').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saved: unknown[] }).__saved)).toEqual([['fantasy-football-week-4-run-1.html', '<h1>Exported</h1>']]);

  // Same run, same bytes: opening the magazine again writes nothing.
  await page.evaluate(() => { location.hash = '#/tools/deep-research'; });
  await page.getByTestId('research-magazine').click();
  await expect(page).toHaveURL(new RegExp(`artifactId=${ARTIFACT}`));
  const writes = seen.filter((entry) => entry.path.startsWith('/live-artifacts') && entry.method !== 'GET');
  expect(writes.map((entry) => `${entry.method} ${entry.path}`)).toEqual(['POST /live-artifacts']);
});

const twoVersionState = {
  kind: 'research-magazine', projectId: project.id, runId: 'run-2',
  versions: [
    { version: 1, runId: 'run-1', createdAt: '2026-09-21T22:00:00.000Z', headings: ['Waiver targets'] },
    { version: 2, runId: 'run-2', createdAt: '2026-09-28T22:00:00.000Z', headings: ['Trade targets'] },
  ],
  comments: [] as unknown[],
};
// Stubbed frame: stands in for the magazine script, sending one bridge request on load.
const frameSending = (method: string, params: unknown) => `<!doctype html><html><head></head><body><article><h2 id="trade-targets">Trade targets</h2><p>Juwan Johnson</p></article><script>window.rhythm.request(${JSON.stringify(method)}, ${JSON.stringify(params)});</script></body></html>`;

test('Ask about this opens the run discussion with the quoted passage, its source and a link back to the section', async ({ page }) => {
  let state: Record<string, unknown> = { ...twoVersionState };
  const seen = await signedIn(page, `#/dashboard?artifactId=${ARTIFACT}`, async (route, url, method) => {
    if (url.pathname === `/live-artifacts/${ARTIFACT}` && method === 'GET') { await json(route, 200, artifactRow(state)); return true; }
    if (url.pathname === `/live-artifacts/${ARTIFACT}/render`) { await html(route, frameSending('research.ask', { quote: 'Juwan Johnson', anchor: 'trade-targets', sourceUrl: 'https://www.nfl.com/stats/player-stats/' })); return true; }
    if (url.pathname === `/live-artifacts/${ARTIFACT}/state` && method === 'PUT') { state = route.request().postDataJSON().state; await json(route, 200, { ...artifactRow(state), currentStateRevision: 2 }); return true; }
    if (url.pathname === `/agent-research/projects/${project.id}/runs/run-2/discussions`) { await json(route, 201, { sessionId: 'discuss-1', contextHash: 'h' }); return true; }
    if (url.pathname === '/agent-sessions/discuss-1') {
      await json(route, 200, { session: { id: 'discuss-1', name: 'Discuss: Week 4', scope: 'chats', status: 'idle', cwd: '/workspace', branch: 'main', profileId: 'research', sdkSessionId: 'sdk-d', createdAt: '2026-09-28T22:00:00Z', updatedAt: '2026-09-28T22:00:00Z', archivedAt: null }, messages: [], transcriptPage: { hasMore: false, nextCursor: null } });
      return true;
    }
    return false;
  });
  await expect(page).toHaveURL(/#\/agents\?sessionId=discuss-1/);
  const composer = page.getByTestId('composer-input');
  await expect(composer).toHaveValue(/^> Juwan Johnson\n\nSource: https:\/\/www\.nfl\.com\/stats\/player-stats\/\n\nMagazine section: \[#trade-targets\]\(#\/dashboard\?artifactId=0b6f7d1e-6a1c-4c7e-9a55-3f2d1c0b9a8e&anchor=trade-targets\)/);
  // The discussion is remembered on the artifact so the next question continues it.
  expect(state).toMatchObject({ discussionSessionId: 'discuss-1' });
  expect(seen.filter((entry) => entry.path.endsWith('/discussions'))).toHaveLength(1);
});

test('versions list with a section diff, read-only older versions, and section comments that guide the next run', async ({ page }) => {
  let state: Record<string, unknown> = { ...twoVersionState };
  const seen = await signedIn(page, `#/dashboard?artifactId=${ARTIFACT}`, async (route, url, method) => {
    if (await researchRoutes([run('run-2'), run('run-1')])(route, url, method)) return true;
    if (url.pathname === `/live-artifacts/${ARTIFACT}` && method === 'GET') { await json(route, 200, artifactRow(state)); return true; }
    if (url.pathname === `/live-artifacts/${ARTIFACT}/render`) { await html(route, frameSending('research.comment', { quote: 'Juwan Johnson', anchor: 'trade-targets', sourceUrl: null })); return true; }
    if (url.pathname === `/live-artifacts/${ARTIFACT}/state` && method === 'PUT') { state = route.request().postDataJSON().state; await json(route, 200, { ...artifactRow(state), currentStateRevision: 2 }); return true; }
    if (url.pathname === `/agent-research/projects/${project.id}/runs` && method === 'POST') { await json(route, 201, run('run-3')); return true; }
    return false;
  });
  const versions = page.getByTestId('research-magazine-versions');
  await expect(versions.locator('option')).toHaveText(['v2 (current) · run run-2', 'v1 · run run-1']);
  await expect(page.getByTestId('research-magazine-diff')).toContainText('Added: Trade targets · Removed: Waiver targets');

  const dialog = page.getByTestId('research-magazine-comment-dialog');
  await expect(dialog).toContainText('Juwan Johnson');
  await dialog.getByRole('textbox', { name: 'Comment' }).fill('Check his snap share first');
  await page.getByTestId('research-magazine-comment-save').click();
  await expect(page.getByTestId('research-magazine-comments')).toContainText('Check his snap share first');
  expect(state.comments).toMatchObject([{ version: 2, anchor: 'trade-targets', quote: 'Juwan Johnson', text: 'Check his snap share first' }]);

  await versions.selectOption('1');
  const old = page.getByTestId('research-magazine-version-frame');
  await expect(old).toHaveAttribute('sandbox', '');
  await expect(old.contentFrame().getByText('Magazine for run-1: add Juwan Johnson.')).toBeVisible();
  await expect(page.locator('[data-testid="live-artifact-surface"]:visible').getByTestId('live-artifact-frame')).toBeHidden();

  // The next run's plan gets the comments on the current version.
  project.magazineArtifactId = ARTIFACT;
  try {
    await page.evaluate(() => { location.hash = '#/tools/deep-research'; });
    await page.getByTestId('research-start-run').click();
    await expect.poll(() => seen.find((entry) => entry.method === 'POST' && entry.path === `/agent-research/projects/${project.id}/runs`)?.body).toEqual({
      triggerType: 'manual', guidance: [{ anchor: 'trade-targets', quote: 'Juwan Johnson', text: 'Check his snap share first' }],
    });
  } finally { project.magazineArtifactId = null; }
});
