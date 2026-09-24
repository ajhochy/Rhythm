import { expect, test } from '@playwright/test';

const sessionId = '18aa886d-0f9e-4530-ac35-767bf3d1ce91';
const session = { id: sessionId, sdkSessionId: 'ses_synthetic', name: 'Synthetic', profileId: 'profile', cwd: '/tmp/fixture', status: 'idle', createdAt: '2026-09-24T00:00:00Z' };

for (const harness of ['electron-e22-harness.html', 'issue-1579-strict-harness.html']) test(`issue-1579-c1/c2: ${harness} completion matrix, pending decisions and exact event schema`, async ({ page }) => {
  // Regression: the native host never sees a turn or ask despite a live transcript being rendered.
  await page.addInitScript(() => {
    (window as unknown as { rhythmShell: unknown }).rhythmShell = { version: 6, gateway: { apiBase: 'http://127.0.0.1:6388' } };
    (window as unknown as { notificationEvents: unknown[] }).notificationEvents = [];
    window.addEventListener('rhythm:agent-notifications', event => (window as unknown as { notificationEvents: unknown[] }).notificationEvents.push((event as CustomEvent).detail));
  });
  const sockets: import('@playwright/test').WebSocketRoute[] = [];
  await page.routeWebSocket(/\/ws\/agents$/, socket => sockets.push(socket));
  await page.route(/https:\/\/issue1579.invalid|http:\/\/127\.0\.0\.1:638[78]/, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/agent-configs') return route.fulfill({ json: [{ id: 'profile', label: 'Test', enabled: true, sessionSelectable: true }] });
    if (path === '/agent-sessions') return route.fulfill({ json: { sessions: [session], pageInfo: { hasMore: false, nextCursor: null } } });
    if (path === `/agent-sessions/${sessionId}`) return route.fulfill({ json: { session, messages: [{ sdkMessageId: 'msg_1', role: 'output', parts: [{ type: 'text', text: 'Result' }] }], transcriptPage: { hasMore: false, nextCursor: null } } });
    return route.fulfill({ json: path.endsWith('/health') ? { status: 'ready' } : [] });
  });
  await page.goto(`/tests/${harness}#/agents`);
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents)).toContainEqual({ v: 1, type: 'ready' });
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents)).toContainEqual({ v: 1, type: 'viewing', sessionId, displayed: true });
  const bell = page.getByRole('button', { name: 'Notify when session finishes' });
  await expect(bell).toBeVisible();
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  const socket = sockets.at(-1)!; // StrictMode remount may create a retired socket; drive the current connection.
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, working: true }));
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, working: false }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: {type: string}[] }).notificationEvents.filter(item => item.type === 'completion'))).toEqual([]);
  socket.send(JSON.stringify({ type: 'permission.asked', sessionId, permissionID: 'perm_1', tool: 'bash', directory: '/tmp/fixture', patterns: [], title: 'Dangerous agent text' }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents)).toContainEqual({ v: 1, type: 'ask', family: 'permission', sessionId, requestId: 'perm_1' });
  socket.send(JSON.stringify({ type: 'permission.replied', sessionId, permissionID: 'perm_1' }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents)).toContainEqual({ v: 1, type: 'resolve', family: 'permission', sessionId, requestId: 'perm_1' });
  socket.send(JSON.stringify({ type: 'question.asked', sessionId, requestId: 'question_1', callId: 'call_1', questions: [] }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents)).toContainEqual({ v: 1, type: 'ask', family: 'question', sessionId, requestId: 'question_1' });
  socket.send(JSON.stringify({ type: 'question.resolved', sessionId, requestId: 'question_1' }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents)).toContainEqual({ v: 1, type: 'resolve', family: 'question', sessionId, requestId: 'question_1' });
  await bell.focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('notify-msg_1')).toHaveAttribute('aria-pressed', 'true');
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, working: true }));
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, working: true }));
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, status: 'retrying' }));
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, working: 'unknown' }));
  socket.send(JSON.stringify({ type: 'session.status', id: 'unrelated', working: false }));
  expect(await page.evaluate(() => (window as unknown as { notificationEvents: {type: string}[] }).notificationEvents.filter(item => item.type === 'completion'))).toEqual([]);
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, working: false }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents.filter((item: unknown) => (item as {type: string}).type === 'completion'))).toEqual([{ v: 1, type: 'completion', sessionId }]);
  await expect(bell).toHaveAttribute('aria-pressed', 'false');
  await bell.click();
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, working: true }));
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, working: false }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: {type: string}[] }).notificationEvents.filter(item => item.type === 'completion').length)).toBe(2);
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, working: false }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: {type: string}[] }).notificationEvents.filter(item => item.type === 'completion').length)).toBe(2);
  const keys = await page.evaluate(() => (window as unknown as { notificationEvents: Record<string, unknown>[] }).notificationEvents.map(item => Object.keys(item).sort().join(',')));
  expect(keys.every(key => ['type,v', 'displayed,sessionId,type,v', 'family,requestId,sessionId,type,v', 'sessionId,type,v'].includes(key))).toBe(true);
});

test('issue-1579-c1: a hydrated working session completes exactly once after arming', async ({ page }) => {
  // Regression: hydration displays a working session but never seeds the transition tracker, so idle leaves the bell armed forever.
  await page.addInitScript(() => {
    (window as unknown as { rhythmShell: unknown }).rhythmShell = { version: 6, gateway: { apiBase: 'http://127.0.0.1:6388' } };
    (window as unknown as { notificationEvents: unknown[] }).notificationEvents = [];
    window.addEventListener('rhythm:agent-notifications', event => (window as unknown as { notificationEvents: unknown[] }).notificationEvents.push((event as CustomEvent).detail));
  });
  const workingSession = { ...session, status: 'working' };
  const sockets: import('@playwright/test').WebSocketRoute[] = [];
  await page.routeWebSocket(/\/ws\/agents$/, socket => sockets.push(socket));
  await page.route(/https:\/\/issue1579\.invalid|http:\/\/127\.0\.0\.1:638[78]/, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/agent-configs') return route.fulfill({ json: [{ id: 'profile', label: 'Test', enabled: true, sessionSelectable: true }] });
    if (path === '/agent-sessions') return route.fulfill({ json: { sessions: [workingSession], pageInfo: { hasMore: false, nextCursor: null } } });
    if (path === `/agent-sessions/${sessionId}`) return route.fulfill({ json: { session: workingSession, messages: [{ sdkMessageId: 'msg_1', role: 'output', parts: [{ type: 'text', text: 'Result' }] }], transcriptPage: { hasMore: false, nextCursor: null } } });
    return route.fulfill({ json: path.endsWith('/health') ? { status: 'ready' } : [] });
  });
  await page.goto('/tests/issue-1579-strict-harness.html#/agents');
  const bell = page.getByRole('button', { name: 'Notify when session finishes' });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  const socket = sockets.at(-1)!;
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, working: false }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: {type: string}[] }).notificationEvents.filter(item => item.type === 'completion'))).toEqual([{ v: 1, type: 'completion', sessionId }]);
  socket.send(JSON.stringify({ type: 'session.status', id: sessionId, working: false }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: {type: string}[] }).notificationEvents.filter(item => item.type === 'completion').length)).toBe(1);
  await expect(bell).toHaveAttribute('aria-pressed', 'false');
});

test('issue-1579-c6: fixture transcript never arms or sends native events even with a forged shell marker', async ({ page }) => {
  // Regression: demo traffic accidentally triggers a real macOS notification.
  await page.addInitScript(() => {
    (window as unknown as { rhythmShell: unknown }).rhythmShell = { gateway: { apiBase: 'http://127.0.0.1:6388' } };
    (window as unknown as { notificationEvents: unknown[] }).notificationEvents = [];
    window.addEventListener('rhythm:agent-notifications', event => (window as unknown as { notificationEvents: unknown[] }).notificationEvents.push((event as CustomEvent).detail));
  });
  await page.goto('/tests/electron-e22-harness.html?gateway=fixture');
  await expect(page.getByTestId('message-msg-user-handoff')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notify when session finishes' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents)).toEqual([]);
});

test('issue-1579-c2: leaving the Agents surface revokes the exact viewing state', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { rhythmShell: unknown }).rhythmShell = { version: 6, gateway: { apiBase: 'http://127.0.0.1:6388' } };
    (window as unknown as { notificationEvents: unknown[] }).notificationEvents = [];
    window.addEventListener('rhythm:agent-notifications', event => (window as unknown as { notificationEvents: unknown[] }).notificationEvents.push((event as CustomEvent).detail));
  });
  await page.route(/https:\/\/issue1579.invalid|http:\/\/127\.0\.0\.1:638[78]/, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/agent-configs') return route.fulfill({ json: [{ id: 'profile', label: 'Test', enabled: true, sessionSelectable: true }] });
    if (path === '/agent-sessions') return route.fulfill({ json: { sessions: [session], pageInfo: { hasMore: false, nextCursor: null } } });
    if (path === `/agent-sessions/${sessionId}`) return route.fulfill({ json: { session, messages: [], transcriptPage: { hasMore: false, nextCursor: null } } });
    return route.fulfill({ json: path.endsWith('/health') ? { status: 'ready' } : [] });
  });
  await page.goto('/tests/electron-e22-harness.html#/agents');
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents)).toContainEqual({ v: 1, type: 'viewing', sessionId, displayed: true });
  await page.getByRole('button', { name: 'Switch surface' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { notificationEvents: unknown[] }).notificationEvents)).toContainEqual({ v: 1, type: 'viewing', sessionId: null, displayed: false });
});
