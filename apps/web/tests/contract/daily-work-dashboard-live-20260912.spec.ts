import { expect, test } from '@playwright/test';
import { liveEnvironment } from '../live-environment';

for (const width of [1440, 390]) test(`dashboard-live: persisted task and step status, drafts and artifact state at ${width}`, async ({ page, request }, info) => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires an assigned owned Dashboard sandbox');
  // Regression: renderer sends a source-instance ID or draft fields with completion,
  // or tab return displays stale data despite a successful real server write.
  const { apiBase: base, engineBase } = liveEnvironment();
  const gatewayBase = new URL(process.env.RHYTHM_LIVE_GATEWAY_URL ?? '').origin;
  expect(process.env.RHYTHM_LIVE_API_URL).toBe(base);
  expect(process.env.RHYTHM_LIVE_ENGINE_URL).toBe(engineBase);
  expect(process.env.RHYTHM_LIVE_GATEWAY_URL).toBe(gatewayBase);
  const headers = { Authorization: 'Bearer e02-synthetic-session-not-a-secret' };
  expect((await (await request.get(`${base}/opencode/health`)).json()).status).toBe('ready');
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const stored = { title: `Dashboard live ${width}`, notes: 'Stored notes', scheduledDate: today, dueDate: today };
  const taskResponse = await request.post(`${base}/tasks`, { headers, data: stored });
  expect(taskResponse.ok()).toBe(true);
  const task = await taskResponse.json();
  let templateId: string | undefined;
  let instanceId: string | undefined;
  let artifactId: string | undefined;
  const writes: Array<{ path: string; body: unknown }> = [];
  const denied: string[] = [];
  try {
    const templateResponse = await request.post(`${base}/project-templates`, { headers, data: { name: `Dashboard steps ${width}` } });
    expect(templateResponse.ok()).toBe(true);
    templateId = (await templateResponse.json()).id;
    expect((await request.post(`${base}/project-templates/${templateId}/steps`, { headers, data: { title: `Dashboard step ${width}`, offsetDays: 0 } })).ok()).toBe(true);
    const instanceResponse = await request.post(`${base}/project-instances`, { headers, data: { templateId, anchorDate: today, name: `Dashboard project ${width}` } });
    expect(instanceResponse.ok()).toBe(true);
    const instance = await instanceResponse.json();
    instanceId = instance.id;
    const step = instance.steps[0];
    expect(step.id).not.toBe(instanceId);
    const workspace = await (await request.get(`${base}/workspaces/me`, { headers })).json();
    const artifactResponse = await request.post(`${base}/live-artifacts`, { headers, data: {
      type: 'html', title: `Dashboard artifact ${width}`, workspaceId: workspace.id, visibility: 'private',
      bundle: { html: '<!doctype html><input aria-label="Live artifact draft" value="Original">', css: '', js: '' }, state: { marker: 'persisted' },
    } });
    expect(artifactResponse.ok()).toBe(true);
    artifactId = (await artifactResponse.json()).id;
    expect((await request.patch(`${base}/users/me/preferences`, { headers, data: { artifactTabIds: [artifactId] } })).ok()).toBe(true);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.addInitScript(({ artifactId, apiBase, engineBase }) => {
      Object.defineProperty(window, 'rhythmShell', { value: {
        version: 8,
        gateway: { apiBase, engineBase, productionApiBase: 'https://design-fixture.invalid' },
        auth: { currentSession: async () => ({ sessionToken: 'e02-synthetic-session-not-a-secret', user: { id: 1, name: 'Synthetic Admin', email: 'admin@example.invalid', role: 'admin', artifactTabIds: [artifactId] } }) },
      } });
    }, { artifactId, apiBase: base, engineBase });
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', async route => {
      const req = route.request(); const url = new URL(req.url());
      if (url.origin === 'http://127.0.0.1:4286') return route.continue();
      if (![base, engineBase, 'https://design-fixture.invalid'].includes(url.origin)) { denied.push(url.origin); return route.abort(); }
      const cors = { 'access-control-allow-origin': 'http://127.0.0.1:4286', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (req.method() === 'PATCH') writes.push({ path: url.pathname, body: req.postDataJSON() });
      // Transport routing only: every application read/write goes to the real owned backend.
      // The launcher allowlists its renderer origin4175; this proxy runs on owned4286.
      // Preserve the real bearer and payload; adapt only the transport origin, not authorization.
      const real = await route.fetch({ url: `${url.origin === engineBase ? engineBase : base}${url.pathname}${url.search}`, headers: { ...req.headers(), origin: 'http://127.0.0.1:4175' }, maxRedirects: 0 });
      await route.fulfill({ status: real.status(), headers: { ...real.headers(), ...cors }, body: await real.body() });
    });
    await page.goto('/#/dashboard');
    await expect(page.locator('.live-artifact-shell')).toBeVisible();
    await expect(page.getByTestId(`task-row-${task.id}`)).toHaveCount(1);
    await page.screenshot({ path: info.outputPath(`dashboard-live-${width}.png`) });
    await page.getByTestId(`task-row-${task.id}`).click();
    await page.getByTestId('task-inspector-notes').fill('Unsaved live draft');
    const complete = page.getByTestId('task-detail-complete');
    await expect(complete).toBeInViewport({ ratio: 1 });
    await complete.click();
    await expect(complete).toHaveText('Reopen task');
    const readTask = async () => (await (await request.get(`${base}/tasks/${task.id}`, { headers })).json());
    expect(await readTask()).toMatchObject({ ...stored, status: 'done' });
    await expect(page.getByTestId('task-inspector-notes')).toHaveValue('Unsaved live draft');
    await page.screenshot({ path: info.outputPath(`dashboard-inspector-${width}.png`) });
    await complete.click();
    await expect(complete).toHaveText('Complete task');
    expect(await readTask()).toMatchObject({ ...stored, status: 'open' });
    await page.keyboard.press('Escape');
    // The real Dashboard summary publishes generated steps in projects.onDeckSteps,
    // not tasks.today. Exercise that real composing view rather than inventing a task row.
    await page.getByTestId(`project-step-row-${step.id}`).click();
    const stepComplete = page.getByTestId('project-step-detail-complete');
    const stepNotes = page.getByTestId('dashboard-project-step-dialog').getByLabel('Notes');
    await expect(stepComplete).toHaveText('Complete step');
    await stepNotes.fill('Unsaved step draft');
    await stepComplete.click();
    await expect(stepComplete).toHaveText('Reopen step');
    const readStep = async () => (await (await request.get(`${base}/project-instances?templateId=${templateId}`, { headers })).json())[0].steps.find((row: { id: string }) => row.id === step.id);
    expect(await readStep()).toMatchObject({ id: step.id, status: 'done', notes: step.notes, dueDate: step.dueDate });
    await stepComplete.click();
    await expect(stepComplete).toHaveText('Complete step');
    expect(await readStep()).toMatchObject({ id: step.id, status: 'open', notes: step.notes, dueDate: step.dueDate });
    await expect(stepNotes).toHaveValue('Unsaved step draft');
    await page.keyboard.press('Escape');
    // The original opener was removed by completion; let the real dialog restore
    // its main-content fallback before starting a separate keyboard interaction.
    await expect(page.locator('#main-content')).toBeFocused();
    expect(writes).toEqual([
      { path: `/tasks/${task.id}`, body: { status: 'done' } }, { path: `/tasks/${task.id}`, body: { status: 'open' } },
      { path: `/project-instances/steps/${step.id}`, body: { status: 'done' } }, { path: `/project-instances/steps/${step.id}`, body: { status: 'open' } },
    ]);
    // P1 regression: the final real context row must not strand Space focus on body.
    const context = page.getByTestId('planning-project-steps');
    await expect(context.locator('.task-entry')).toHaveCount(1);
    await expect(context.locator('.task-toggle')).toBeEnabled();
    await context.locator('.task-toggle').focus();
    await expect(context.locator('.task-toggle')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(context.locator('.task-entry')).toHaveCount(0);
    await expect(context.getByRole('heading')).toBeFocused();
    expect(await readStep()).toMatchObject({ id: step.id, status: 'done', notes: step.notes, dueDate: step.dueDate });
    expect(writes.at(-1)).toEqual({ path: `/project-instances/steps/${step.id}`, body: { status: 'done' } });
    const artifact = page.getByRole('tab', { name: `Dashboard artifact ${width}`, exact: true });
    await artifact.click();
    const frame = page.getByTestId('live-artifact-frame').contentFrame();
    await frame.getByLabel('Live artifact draft').fill('Keep live frame');
    expect((await request.patch(`${base}/tasks/${task.id}`, { headers, data: { status: 'done' } })).ok()).toBe(true);
    await page.getByRole('tab', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByTestId(`task-row-${task.id}`)).toHaveCount(0);
    await artifact.click();
    await expect(frame.getByLabel('Live artifact draft')).toHaveValue('Keep live frame');
    await page.screenshot({ path: info.outputPath(`dashboard-artifact-${width}.png`) });
    await artifact.press('Delete');
    await expect(page.getByRole('tab', { name: 'Dashboard', exact: true })).toBeFocused();
    await expect.poll(async () => (await (await request.get(`${base}/users/1`, { headers })).json()).artifactTabIds).toEqual([]);
    expect((await (await request.get(`${base}/live-artifacts/${artifactId}`, { headers })).json()).state).toEqual({ marker: 'persisted' });
    await page.reload();
    await expect(page.getByTestId(`task-row-${task.id}`)).toHaveCount(0);
    expect(await readTask()).toMatchObject({ ...stored, status: 'done' });
    expect(denied).toEqual([]);
  } finally {
    // Independent of Playwright's disposed request context when a test times out.
    await fetch(`${base}/users/me/preferences`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactTabIds: [] }), signal: AbortSignal.timeout(5000) });
    for (const path of [artifactId && `/live-artifacts/${artifactId}`, instanceId && `/project-instances/${instanceId}`, templateId && `/project-templates/${templateId}`, `/tasks/${task.id}`].filter(Boolean)) {
      expect((await fetch(`${base}${path}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) })).ok).toBe(true);
    }
  }
});
