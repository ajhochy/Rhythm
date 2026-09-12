import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

test('E24-c5 persisted local child accepts input addressed only to its local identity', async ({ page }) => {
  // Regression: Composer treats every persisted parentSessionId as read-only,
  // even after the real rail/store selects the child's local session successfully.
  // Fake only HTTP/WS; exercise the actual workspace, store, gateway and Composer.
  const parent = { id: 'e24-parent', sdkSessionId: 'ses_parent', name: 'E24 parent', profileId: 'e24-profile', cwd: '/tmp/e24', status: 'idle', createdAt: '2026-09-11T00:00:00Z' };
  const child = { ...parent, id: 'e24-child', sdkSessionId: 'ses_child', name: 'E24 persisted child', parentSessionId: parent.id };
  const frames: Record<string, unknown>[] = [];
  await page.routeWebSocket(/\/ws\/agents$/, socket => socket.onMessage(data => frames.push(JSON.parse(String(data)))));
  await page.route(/https:\/\/e24.invalid|http:\/\/127.0.0.1:(4199|4197)/, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/agent-configs') return route.fulfill({ json: [{ id: 'e24-profile', label: 'E24', enabled: true, sessionSelectable: true }] });
    if (path === '/agent-sessions') return route.fulfill({ json: { sessions: [parent, child], pageInfo: { hasMore: false, nextCursor: null } } });
    if (path === `/agent-sessions/${parent.id}` || path === `/agent-sessions/${child.id}`) return route.fulfill({ json: { session: path.endsWith(child.id) ? child : parent, messages: [] } });
    return route.fulfill({ json: path.endsWith('/health') ? { status: 'ready' } : [] });
  });
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId(`session-${child.id}`).click();
  await expect(page.getByTestId('state')).toContainText(`"id":"${child.id}"`);
  await expect(page.getByTestId('state')).toContainText(`"parentSessionId":"${parent.id}"`);
  await expect(page.getByTestId('state')).toContainText('"sdkSessionId":"ses_child"');
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  await page.getByTestId('composer-input').fill('Child-only input');
  await page.getByTestId('composer-send').click();
  await expect.poll(() => frames.filter(frame => frame.type === 'session.input')).toEqual([
    { v: 1, type: 'session.input', id: child.id, data: 'Child-only input' },
  ]);
});

const parent = { id: 'e24-parent', sdkSessionId: 'ses_parent', name: 'E24 parent', profileId: 'e24-profile', cwd: '/tmp/e24', status: 'idle', createdAt: '2026-09-11T00:00:00Z' };
const child = { ...parent, id: 'e24-child', sdkSessionId: 'ses_child', name: 'E24 persisted child', parentSessionId: parent.id };
const permission = (id: string) => ({ sessionId: parent.id, permissionID: id, directory: parent.cwd, tool: 'bash', patterns: [`command ${id}`], title: `Permission ${id}`, createdAt: parent.createdAt });
const question = (id: string) => ({ requestId: id, callId: `call-${id}`, questions: [{ header: id, question: `Question ${id}`, options: [{ label: 'Yes', description: 'Proceed' }], multiple: false, custom: true }] });
const message = (id: string, children: string[] = []) => ({ sdkMessageId: id, role: 'output', parts: [{ type: 'text', text: `Transcript ${id}` }, ...children.map(childId => ({ type: 'tool', tool: 'task', state: { status: 'completed', input: { description: childId }, output: `task_id: ${childId}` } }))] });

async function workspace(page: Page, status = 'idle') {
  const state = { sockets: [] as WebSocketRoute[], permissions: [] as ReturnType<typeof permission>[], questions: [] as ReturnType<typeof question>[], posts: [] as { path: string; body: unknown }[], frames: [] as Record<string, unknown>[], fail: false, childGate: undefined as Promise<void> | undefined, childReads: 0, pendingGate: undefined as Promise<void> | undefined, pendingReads: 0 };
  await page.routeWebSocket(/\/ws\/agents$/, socket => { state.sockets.push(socket); socket.onMessage(data => state.frames.push(JSON.parse(String(data)))); });
  await page.route(/https:\/\/e24.invalid|http:\/\/127.0.0.1:(4199|4197)/, async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (request.method() === 'POST') {
      state.posts.push({ path, body: request.postData() ? request.postDataJSON() : null });
      if (state.fail) return route.fulfill({ status: 503, json: { error: 'Try again' } });
      const permissionId = path.match(/permissions\/([^/]+)\/reply/)?.[1];
      const callId = path.match(/question\/([^/]+)\//)?.[1];
      if (permissionId) state.permissions = state.permissions.filter(item => item.permissionID !== permissionId);
      if (callId) state.questions = state.questions.filter(item => item.callId !== callId);
      return route.fulfill({ status: 204 });
    }
    if (path === '/agent-configs') return route.fulfill({ json: [{ id: 'e24-profile', label: 'E24', enabled: true, sessionSelectable: true }] });
    if (path === '/agent-sessions') return route.fulfill({ json: { sessions: [{ ...parent, status }, child], pageInfo: { hasMore: false, nextCursor: null } } });
    if (path === `/agent-sessions/${parent.id}` || path === `/agent-sessions/${child.id}`) return route.fulfill({ json: { session: path.endsWith(child.id) ? child : { ...parent, status }, messages: [message(path.endsWith(child.id) ? 'persisted' : 'root', ['ses_child', 'ses_ephemeral'])] } });
    if (path.endsWith('/pending-permissions')) { const rows = path.includes(parent.id) ? [...state.permissions] : []; state.pendingReads++; await state.pendingGate; return route.fulfill({ json: rows }); }
    if (path === '/question') return route.fulfill({ json: state.questions.map(item => ({ id: item.requestId, sessionID: parent.sdkSessionId, tool: { callID: item.callId, messageID: 'root' }, questions: item.questions })) });
    if (path.includes('/children/')) {
      state.childReads++;
      await state.childGate;
      const id = path.split('/').at(-2)!;
      return route.fulfill({ json: { messages: [message(id, id === 'ses_ephemeral' ? ['ses_nested'] : [])] } });
    }
    return route.fulfill({ json: path.endsWith('/health') ? { status: 'ready' } : [] });
  });
  await page.goto('/tests/electron-e22-harness.html');
  await expect(page.getByTestId('message-root')).toBeVisible();
  return state;
}

test('E24-c1 concurrent canonical requests survive duplicate and unrelated resolved events', async ({ page }) => {
  // Regression: a singular Session field silently overwrites a sibling request.
  const state = await workspace(page);
  for (const id of ['p1', 'p2', 'p1']) state.sockets[0].send(JSON.stringify({ type: 'permission.asked', ...permission(id) }));
  for (const id of ['q1', 'q2', 'q1']) state.sockets[0].send(JSON.stringify({ type: 'question.asked', sessionId: parent.id, ...question(id) }));
  await expect(page.getByTestId('permission-card')).toHaveCount(2);
  await expect(page.getByTestId('question-card')).toHaveCount(2);
  state.sockets[0].send(JSON.stringify({ type: 'permission.replied', sessionId: parent.id, permissionID: 'p1' }));
  state.sockets[0].send(JSON.stringify({ type: 'question.resolved', sessionId: parent.id, requestId: 'q1' }));
  await expect(page.getByTestId('permission-card')).toHaveCount(1);
  await expect(page.getByTestId('permission-card')).toContainText('Permission p2');
  await expect(page.getByTestId('question-card')).toHaveCount(1);
  await expect(page.getByTestId('question-card')).toContainText('Question q2');
});

test('E24-c2 selection and reconnect consume both pending lists and remove only resolved IDs', async ({ page }) => {
  const state = await workspace(page);
  state.permissions = [permission('p1'), permission('p2')]; state.questions = [question('q1'), question('q2')];
  await page.getByTestId(`session-${child.id}`).click();
  await page.getByTestId(`session-${parent.id}`).click();
  await expect(page.getByTestId('permission-card')).toHaveCount(2);
  await expect(page.getByTestId('question-card')).toHaveCount(2);
  state.permissions = [permission('p2')]; state.questions = [question('q2')];
  state.sockets.at(-1)!.close();
  await expect.poll(() => state.sockets.length).toBe(2);
  await expect(page.getByTestId('permission-card')).toHaveCount(1);
  await expect(page.getByTestId('permission-card')).toContainText('Permission p2');
  await expect(page.getByTestId('question-card')).toHaveCount(1);
  await expect(page.getByTestId('question-card')).toContainText('Question q2');
});

for (const kind of ['permission', 'answer', 'reject'] as const) test(`E24-c3 ${kind} failure retains card and answer, reenables retry, success removes only acknowledged ID`, async ({ page }) => {
  const state = await workspace(page);
  state.permissions = [permission('p1')]; state.questions = [question('q1')];
  state.sockets[0].send(JSON.stringify({ type: 'permission.asked', ...permission('p1') }));
  state.sockets[0].send(JSON.stringify({ type: 'question.asked', sessionId: parent.id, ...question('q1') }));
  const card = page.getByTestId(kind === 'permission' ? 'permission-card' : 'question-card');
  const button = card.getByTestId(kind === 'permission' ? 'permission-allow-once' : kind === 'answer' ? 'question-answer' : 'question-reject');
  if (kind === 'answer') await card.getByRole('radio').check();
  state.fail = true; await button.click();
  await expect(card.getByRole('alert')).toContainText(/failed|unavailable/i);
  await expect(button).toBeEnabled();
  if (kind === 'answer') await expect(card.getByRole('radio')).toBeChecked();
  state.fail = false; await button.click();
  await expect(card).toHaveCount(0);
  expect(state.posts).toEqual(Array(2).fill({ path: `/agent-sessions/${parent.id}/${kind === 'permission' ? 'permissions/p1/reply' : `question/call-q1/${kind === 'answer' ? 'reply' : 'reject'}`}`, body: kind === 'permission' ? { reply: 'once' } : kind === 'answer' ? { answers: [['Yes']] } : null }));
  await expect(page.getByTestId(kind === 'permission' ? 'question-card' : 'permission-card')).toHaveCount(1);
});

test('E24-c4 rail and workspace waiting reflect live collections independently of session status', async ({ page }) => {
  const state = await workspace(page);
  state.sockets[0].send(JSON.stringify({ type: 'question.asked', sessionId: parent.id, ...question('q1') }));
  await expect(page.getByTestId(`session-${parent.id}`)).toContainText(/waiting|decision/i);
  await expect(page.getByTestId('agent-go-to-activity')).toHaveText('Go to decision');
  state.sockets[0].send(JSON.stringify({ type: 'question.resolved', sessionId: parent.id, requestId: 'q1' }));
  await expect(page.getByTestId(`session-${parent.id}`)).not.toContainText(/waiting|decision/i);
  await expect(page.getByTestId('agent-go-to-activity')).toHaveText('Go to latest response');
});

test('E24-c5 SDK child link resolves persisted local row without losing parent metadata', async ({ page }) => {
  const state = await workspace(page);
  await page.getByTestId('open-child-ses_child').click();
  await expect(page.getByTestId('state')).toContainText(`"id":"${child.id}"`);
  await expect(page.getByTestId('state')).toContainText(`"parentSessionId":"${parent.id}"`);
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  await page.getByTestId('composer-input').fill('Persisted child input'); await page.getByTestId('composer-send').click();
  await expect.poll(() => state.frames.filter(frame => frame.type === 'session.input')).toEqual([{ v: 1, type: 'session.input', id: child.id, data: 'Persisted child input' }]);
});

test('E24-c6 ephemeral child exposes read-only transcript and no composer', async ({ page }) => {
  const state = await workspace(page);
  await page.getByTestId('open-child-ses_ephemeral').click();
  await expect(page.getByTestId('message-ses_ephemeral')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toHaveCount(0);
  await expect(page.getByText('Read only', { exact: true })).toBeVisible();
  expect(state.frames.filter(frame => frame.type === 'session.input')).toEqual([]);
});

test('E24-c7 nested child hop and back pop one level at a time', async ({ page }) => {
  await workspace(page);
  await page.getByTestId('open-child-ses_ephemeral').click();
  await page.getByTestId('open-child-ses_nested').click();
  await expect(page.getByTestId('message-ses_nested')).toBeVisible();
  await page.getByTestId('child-back').click();
  await expect(page.getByTestId('message-ses_ephemeral')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toHaveCount(0);
  await page.getByTestId('child-back').click();
  await expect(page.getByTestId('message-root')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toBeEnabled();
});

test('E24-c8 rail selection and back invalidate pending child loads', async ({ page }) => {
  const state = await workspace(page);
  await page.getByTestId('open-child-ses_ephemeral').click();
  await expect(page.getByTestId('message-ses_ephemeral')).toBeVisible();
  let release!: () => void; state.childGate = new Promise<void>(resolve => { release = resolve; });
  await page.getByTestId('open-child-ses_nested').click();
  await page.getByTestId(`session-${child.id}`).click(); release();
  await expect(page.getByTestId('message-persisted')).toBeVisible();
  await expect(page.getByTestId('child-back')).toHaveCount(0);
  await page.getByTestId(`session-${parent.id}`).click();
  await expect(page.getByTestId('message-root')).toBeVisible();
  await expect(page.getByTestId('child-back')).toHaveCount(0);
  expect(state.frames.filter(frame => frame.type === 'session.input')).toEqual([]);
});

for (const status of ['closed', 'error']) test(`E24-c9 ${status} with valid SDK permits recovery input without claiming permanent loss`, async ({ page }) => {
  const state = await workspace(page, status);
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  await expect(page.getByText("This run has ended and can't be resumed.")).toHaveCount(0);
  await page.getByTestId('composer-input').fill('Recover session'); await page.getByTestId('composer-send').click();
  await expect.poll(() => state.frames.filter(frame => frame.type === 'session.input')).toEqual([{ v: 1, type: 'session.input', id: parent.id, data: 'Recover session' }]);
});

test('E24-c2 an older reconnect snapshot cannot replace a newer selection read', async ({ page }) => {
  const state = await workspace(page);
  state.permissions = [permission('old')];
  let release!: () => void;
  state.pendingGate = new Promise<void>(resolve => { release = resolve; });
  const reads = state.pendingReads;
  try {
    state.sockets[0].close();
    await expect.poll(() => state.pendingReads).toBeGreaterThanOrEqual(reads + 2);
    state.pendingGate = undefined; state.permissions = [permission('new')];
    await page.getByTestId(`session-${child.id}`).click();
    await page.getByTestId(`session-${parent.id}`).click();
    await expect(page.getByTestId('permission-card')).toContainText('Permission new');
    release();
    await page.waitForTimeout(150); // Allow the deliberately older HTTP response to settle.
    await expect(page.getByTestId('permission-card')).toContainText('Permission new');
  } finally { release(); }
});

test('E24-c8 loading a child immediately removes parent-target input and back cancels the load', async ({ page }) => {
  const state = await workspace(page);
  let release!: () => void;
  state.childGate = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.getByTestId('open-child-ses_ephemeral').click();
    await expect.poll(() => state.childReads).toBe(1);
    await expect(page.getByTestId('composer-input')).toHaveCount(0);
    await page.getByTestId('child-back').click(); release();
    await expect(page.getByTestId('message-root')).toBeVisible();
    await page.waitForTimeout(150);
    await expect(page.getByTestId('message-ses_ephemeral')).toHaveCount(0);
    expect(state.frames.filter(frame => frame.type === 'session.input')).toEqual([]);
  } finally { release(); }
});
