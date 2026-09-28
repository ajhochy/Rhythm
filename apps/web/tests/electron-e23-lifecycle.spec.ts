import { test, expect, request as http, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('E23-c5 Prepare project cannot report success without an init request', async ({ page }) => {
  // Regression: the live confirmation only emits a fixture success toast.
  // Intercept HTTP/WS boundaries, not the real workspace, store, or gateway.
  const operations: unknown[] = [];
  const session = { id: 'e23-owned', name: 'E23 lifecycle', profileId: 'e23-profile', cwd: '/tmp/e23', status: 'idle', createdAt: '2026-09-11T00:00:00Z' };
  await page.routeWebSocket(/\/ws\/agents$/, socket => socket.onMessage(data => {
    const frame = JSON.parse(String(data));
    if (frame.type === 'session.command' && frame.command === 'init') operations.push(frame);
  }));
  await page.route(/https:\/\/e23.invalid|http:\/\/127.0.0.1:(4199|4197)/, route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/agent-configs') return route.fulfill({ json: [{ id: 'e23-profile', label: 'E23', enabled: true, sessionSelectable: true }] });
    if (path === '/agent-sessions') return route.fulfill({ json: { sessions: [session], pageInfo: { hasMore: false, nextCursor: null } } });
    if (path === '/agent-sessions/e23-owned') return route.fulfill({ json: { session, messages: [] } });
    if (path === '/agent-sessions/e23-owned/init' && request.method() === 'POST') operations.push({ path, method: 'POST', body: request.postDataJSON() });
    return route.fulfill({ json: path.endsWith('/health') ? { status: 'ready' } : [] });
  });
  await page.goto('/tests/electron-e22-harness.html');
  await expect(page.getByTestId('state')).toContainText('E23 lifecycle');
  const prepare = page.getByTestId('prepare-project');
  if (await prepare.isDisabled()) {
    await expect(prepare).toHaveAttribute('title', /unavailable|unsupported|no .*endpoint/i);
    expect(operations).toEqual([]);
    return;
  }
  await prepare.click();
  await page.getByTestId('confirm-prepare-project').click();
  await expect.poll(() => operations.length, { message: 'Live Prepare must invoke init rather than only report success' }).toBe(1);
  // Scope-blocker probe only; full request/readback contracts precede implementation.
});

// Real workspace/store/gateway; only the remote HTTP/WS boundary is controlled.
async function lifecycle(page: Page, options: { empty?: boolean; gone?: boolean } = {}) {
  const session = { id: 'e23-owned', name: 'E23 lifecycle', profileId: 'e23-profile', cwd: '/tmp/e23', status: options.gone ? 'resumable' : 'idle', archivedAt: null as string | null, sdkSessionId: 'sdk-e23', providerId: 'openai', modelId: 'test-model', createdAt: '2026-09-11T00:00:00Z' };
  const original = [
    { sdkMessageId: 'user-1', role: 'input', parts: [{ type: 'text', text: 'Question' }] },
    { sdkMessageId: 'answer-1', role: 'output', parts: [{ type: 'text', text: 'First answer' }] },
    { sdkMessageId: 'answer-2', role: 'output', parts: [{ type: 'text', text: 'Second answer' }], tokens: { input: 9000, output: 150, cache: { read: 300, write: 0 } } },
  ];
  const state = { messages: options.empty ? [] : original, operations: [] as { path: string; body: any }[], frames: [] as any[], failure: '', detailFailure: false, detailGate: undefined as Promise<void> | undefined };
  await page.routeWebSocket(/\/ws\/agents$/, socket => socket.onMessage(data => state.frames.push(JSON.parse(String(data)))));
  await page.route(/https:\/\/e23.invalid|http:\/\/127.0.0.1:(4199|4197)/, async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const write = ['POST', 'PATCH'].includes(request.method());
    if (write) {
      state.operations.push({ path, body: request.postData() ? request.postDataJSON() : null });
      if (state.failure) return route.fulfill({ status: 503, json: { error: state.failure } });
    }
    if (path === '/agent-configs') return route.fulfill({ json: [{ id: 'e23-profile', label: 'E23', enabled: true, sessionSelectable: true }] });
    if (path === '/agent-sessions' && write) return route.fulfill({ status: 201, json: { ...session, id: 'e23-fresh', name: 'E23 fresh', sdkSessionId: 'sdk-fresh' } });
    if (path === '/agent-sessions') return route.fulfill({ json: { sessions: url.searchParams.get('archivedOnly') === 'true' ? session.archivedAt ? [session] : [] : session.archivedAt ? [] : [session], pageInfo: { hasMore: false, nextCursor: null } } });
    if (path === '/agent-sessions/e23-owned' && write) { session.archivedAt = request.postDataJSON().archived ? '2026-09-11T01:00:00Z' : null; return route.fulfill({ json: session }); }
    if (path === '/agent-sessions/e23-owned') { await state.detailGate; return route.fulfill(state.detailFailure ? { status: 503, json: { error: 'Readback unavailable' } } : { json: { session, messages: state.messages, transcriptPage: { hasMore: false, nextCursor: null } } }); }
    if (path === '/agent-sessions/e23-owned/resume') return route.fulfill({ status: 410, json: { error: 'SDK session is gone; use start-fresh.' } });
    if (path === '/agent-sessions/e23-owned/revert') return route.fulfill({ json: { id: 'sdk-e23', revert: { messageID: request.postDataJSON().messageId } } });
    if (path === '/agent-sessions/e23-owned/unrevert') { state.messages = original; return route.fulfill({ json: { id: 'sdk-e23' } }); }
    if (path === '/agent-sessions/e23-owned/fork') return route.fulfill({ status: 201, json: { ...session, id: 'e23-fork', name: 'E23 fork', sdkSessionId: 'sdk-fork' } });
    if (path === '/agent-sessions/e23-fork' || path === '/agent-sessions/e23-fresh') return route.fulfill({ json: { session: { ...session, id: path.split('/').at(-1), name: path.endsWith('fork') ? 'E23 fork' : 'E23 fresh', sdkSessionId: path.endsWith('fork') ? 'sdk-fork' : 'sdk-fresh' }, messages: path.endsWith('fork') ? original.slice(0, 2) : [] } });
    if (path.endsWith('/summarize')) { state.messages = [...original, { sdkMessageId: 'summary', role: 'output', parts: [{ type: 'text', text: 'Persisted summary' }], tokens: { input: 4567, output: 89, cache: { read: 123, write: 0 } } }]; return route.fulfill({ status: 204 }); }
    if (path.endsWith('/init')) { state.messages = [...original, { sdkMessageId: 'init-result', role: 'output', parts: [{ type: 'text', text: 'Project instructions written' }] }]; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: path.endsWith('/health') ? { status: 'ready' } : [] });
  });
  await page.goto('/tests/electron-e22-harness.html');
  await expect(page.getByTestId('state')).toContainText('E23 lifecycle');
  await expect(page.getByTestId(options.empty ? 'empty-state' : 'message-answer-1')).toBeVisible();
  return state;
}

test('E23-c1 archive and restore consume persisted group, not closed/resumable guesses', async ({ page }) => {
  const state = await lifecycle(page);
  await page.getByTestId('session-actions').click();
  await page.getByRole('menuitem', { name: 'Archive session', exact: true }).click();
  await expect.poll(() => state.operations).toContainEqual({ path: '/agent-sessions/e23-owned', body: { archived: true } });
  await expect(page.getByTestId('state')).toContainText('"group":"archived"');
  await expect(page.getByTestId('state')).toContainText('"status":"idle"');
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'View archived sessions' }).click();
  await page.getByTestId('session-menu-e23-owned').click();
  await page.getByTestId('unarchive-e23-owned').click();
  await expect.poll(() => state.operations).toContainEqual({ path: '/agent-sessions/e23-owned', body: { archived: false } });
  await expect(page.getByTestId('state')).toContainText('"group":"active"');
});

test('E23-c2/c10 transcript and inspector adopt server revert/restore outcome', async ({ page }) => {
  const state = await lifecycle(page);
  await page.getByTestId('revert-answer-1').click();
  await expect.poll(() => state.operations).toContainEqual({ path: '/agent-sessions/e23-owned/revert', body: { messageId: 'answer-1' } });
  await expect(page.getByTestId('reverted-banner')).toContainText('answer-1');
  await page.getByTestId('unrevert').click();
  await expect(page.getByTestId('message-answer-2')).toBeVisible();
  await page.getByRole('tab', { name: 'Changes', exact: true }).click();
  await page.getByTestId('changes-revert').click(); await page.getByTestId('worktree-confirm').click();
  await expect.poll(() => state.operations).toContainEqual({ path: '/agent-sessions/e23-owned/revert', body: { messageId: 'user-1' } });
  await expect(page.getByTestId('reverted-banner')).toBeVisible();
  await page.getByTestId('changes-restore').click(); await page.getByTestId('worktree-confirm').click();
  await expect(page.getByTestId('reverted-banner')).toHaveCount(0);
  await expect(page.getByTestId('message-answer-2')).toBeVisible();
});

test('E23-c3 fork carries clicked boundary and consumes returned child detail', async ({ page }) => {
  const state = await lifecycle(page);
  await page.getByTestId('fork-answer-1').click();
  await expect.poll(() => state.operations).toContainEqual({ path: '/agent-sessions/e23-owned/fork', body: { messageId: 'answer-1' } });
  await expect(page.getByTestId('state')).toContainText('"id":"e23-fork"');
  await expect(page.getByTestId('message-answer-2')).toHaveCount(0);
  await expect(page.getByTestId('message-answer-1')).toBeVisible();
});

for (const entry of ['session-compact', 'session-actions-compact', 'summarize-answer-1']) test(`E23-c4/c10 ${entry} consumes summarize readback`, async ({ page }) => {
  const state = await lifecycle(page);
  if (entry === 'session-actions-compact') await page.getByTestId('session-actions').click();
  await page.getByTestId(entry).click();
  await expect.poll(() => state.operations.filter(op => op.path.endsWith('/summarize')).length).toBe(1);
  await expect(page.getByTestId('message-summary')).toContainText('Persisted summary');
  await expect(page.getByTestId('state')).toContainText('"inputTokens":4567');
  await expect(page.getByTestId('state')).toContainText('"outputTokens":89');
  await expect(page.getByTestId('state')).toContainText('"cachedTokens":123');
});

for (const entry of ['prepare-project', 'session-actions-prepare']) test(`E23-c5/c10 ${entry} consumes init readback`, async ({ page }) => {
  const state = await lifecycle(page);
  if (entry === 'session-actions-prepare') await page.getByTestId('session-actions').click();
  await page.getByTestId(entry).click(); await page.getByTestId('confirm-prepare-project').click();
  await expect.poll(() => state.operations.filter(op => op.path.endsWith('/init')).length).toBe(1);
  await expect(page.getByTestId('message-init-result')).toContainText('Project instructions written');
});

for (const [label, input] of [['Review project context', 'Review the project context and propose the next safe step.'], ['Summarize changes', 'Summarize current changes and unresolved decisions.']]) test(`E23-c6 empty starter ${label} sends actual live input`, async ({ page }) => {
  const state = await lifecycle(page, { empty: true });
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect.poll(() => state.frames).toContainEqual({ v: 1, type: 'session.input', id: 'e23-owned', data: input, modelOverride: { providerId: 'openai', modelId: 'test-model' } });
});

test('E23-c7 copy writes actual message text and rejection never reports success', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await lifecycle(page);
  await page.getByTestId('copy-answer-1').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('First answer');
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { value: () => Promise.reject(new Error('denied')) }); });
  await page.getByTestId('copy-answer-2').click();
  await expect(page.getByTestId('notice')).toContainText('copy failed');
});

test('E23-c8 410 start-fresh creates intended profile/cwd and selects new identity', async ({ page }) => {
  const state = await lifecycle(page, { gone: true });
  await page.getByTestId('session-menu-e23-owned').click(); await page.getByTestId('resume-e23-owned').click();
  await expect(page.getByTestId('resume-gone-alert')).toContainText('SDK session is gone');
  await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
  await expect.poll(() => state.operations.find(op => op.path === '/agent-sessions')?.body).toMatchObject({ profileId: 'e23-profile', cwd: '/tmp/e23' });
  await expect(page.getByTestId('state')).toContainText('"id":"e23-fresh"');
  await expect(page.getByTestId('state')).toContainText('"sdkSessionId":"sdk-fresh"');
});

test('E23-c9 reconnect cannot claim success when reconciliation fails', async ({ page }) => {
  const state = await lifecycle(page); state.detailFailure = true;
  await expect(page.getByTestId('connection-status')).toContainText('unavailable');
  await page.getByTestId('session-retry').click();
  await expect(page.getByTestId('connection-status')).toContainText('unavailable');
  await expect(page.getByTestId('notice')).not.toContainText('restored');
  state.detailFailure = false;
  let release!: () => void;
  state.detailGate = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.getByTestId('session-retry').click();
    await page.waitForTimeout(350); // Regression: the old header claimed success after a fixed 240 ms.
    await expect(page.getByTestId('connection-status')).toHaveText('Reconciling session…');
    await expect(page.getByTestId('session-retry')).toBeDisabled();
    release();
    await expect(page.getByTestId('connection-status')).toContainText('reconciled');
  } finally { release(); }
});

for (const entry of ['revert-answer-1', 'session-compact', 'prepare-project']) test(`E23-c10 rejected ${entry} preserves transcript and reports failure`, async ({ page }) => {
  const state = await lifecycle(page); state.failure = 'Lifecycle unavailable';
  await page.getByTestId(entry).click();
  if (entry === 'prepare-project') await page.getByTestId('confirm-prepare-project').click();
  await expect(page.getByTestId('notice')).toContainText('Lifecycle unavailable');
  await expect(page.getByTestId('reverted-banner')).toHaveCount(0);
  await expect(page.getByTestId('message-answer-2')).toBeVisible();
});

test('E23-c11 real sandbox archive/restore through workspace with persisted readback', async ({ page }) => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires manager-owned API4098/engine4097; never starts or stops it');
  test.setTimeout(60000);
  const client = await http.newContext({ baseURL: 'http://127.0.0.1:4098' });
  let id = '';
  try {
    expect((await client.get('/opencode/health')).ok()).toBe(true);
    const profiles = await (await client.get('/agent-configs')).json();
    const profile = profiles.find((item: any) => item.enabled && item.sessionSelectable !== false);
    expect(profile, 'Sandbox needs an existing enabled profile; this test does not change profiles').toBeTruthy();
    const created = await client.post('/agent-sessions', { data: { name: `E23-${randomUUID()}`, profileId: profile.id, cwd: '/private/tmp/rhythm-electron-phase2-integration', isolateWorktree: false } });
    expect(created.status(), await created.text()).toBe(201);
    id = (await created.json()).id;
    expect(id).toBeTruthy();
    await page.routeWebSocket(/\/ws\/agents$/, socket => socket.onMessage(() => {})); // No prompt/command can reach a provider.
    await page.route('https://e23.invalid/**', route => route.fulfill({ json: [] }));
    await page.route(/http:\/\/127.0.0.1:(4098|4097)/, route => {
      const request = route.request(); const url = new URL(request.url());
      // Deny every provider-capable mutation even if an unrelated UI path regresses.
      if (!['GET', 'OPTIONS'].includes(request.method()) && !(request.method() === 'PATCH' && url.pathname === `/agent-sessions/${id}` && Object.keys(request.postDataJSON()).join() === 'archived')) return route.abort();
      return route.continue();
    });
    await page.addInitScript(sessionId => localStorage.setItem('rhythm-agents-live-selected-session', sessionId), id);
    await page.goto('/tests/electron-e22-harness.html');
    await expect(page.getByTestId('state')).toContainText(`"id":"${id}"`);
    await page.getByTestId('session-actions').click(); await page.getByRole('menuitem', { name: 'Archive session', exact: true }).click();
    await expect(page.getByTestId('state')).toContainText('"group":"archived"');
    const archived = (await (await client.get(`/agent-sessions/${id}`)).json()).session;
    expect(archived.archivedAt).toEqual(expect.any(String));
    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'View archived sessions' }).click();
    await page.getByTestId(`session-menu-${id}`).click(); await page.getByTestId(`unarchive-${id}`).click();
    await expect(page.getByTestId('state')).toContainText('"group":"active"');
    const restored = (await (await client.get(`/agent-sessions/${id}`)).json()).session;
    expect(restored.archivedAt).toBeNull(); expect(restored.sdkSessionId).toBe(archived.sdkSessionId);
    await page.reload(); await expect(page.getByTestId('state')).toContainText('"group":"active"');
    console.log('E23 LIVE: real UI archive/restore, persisted archivedAt string -> null, same SDK identity, reload active; zero provider prompts.');
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    await page.goto('about:blank');
    if (id) expect((await client.delete(`/agent-sessions/${id}/hard`, { data: { removeWorktree: false } })).status()).toBe(204);
    await client.dispose();
  }
});
