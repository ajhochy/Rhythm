import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

const API = 'http://127.0.0.1:4098';
const ENGINE = 'http://127.0.0.1:4097';
const LOCAL_ID = 'phase4-local-session';
const SDK_ID = 'ses_phase4sdk';
const CHILD_SDK_ID = 'ses_phase4child';
const NOW = '2026-08-15T18:00:00.000Z';

type CanonicalPart = Record<string, unknown> & { id: string; type: string };
type CanonicalMessage = {
  id: number;
  sessionId: string;
  role: 'input' | 'output' | 'system';
  rawText: string;
  strippedText: string;
  createdAt: string;
  sdkMessageId: string;
  parts: CanonicalPart[];
  tokens: Record<string, unknown> | null;
  cost: number | null;
};

const textPart = (id: string, text: string): CanonicalPart => ({
  id,
  sessionID: SDK_ID,
  messageID: id.startsWith('in-') ? 'msg_input' : 'msg_output',
  type: 'text',
  text,
});

const message = (
  id: number,
  role: CanonicalMessage['role'],
  sdkMessageId: string,
  parts: CanonicalPart[],
): CanonicalMessage => ({
  id,
  sessionId: LOCAL_ID,
  role,
  rawText: parts.filter((part) => part.type === 'text').map((part) => String(part.text ?? '')).join(''),
  strippedText: parts.filter((part) => part.type === 'text').map((part) => String(part.text ?? '')).join(''),
  createdAt: NOW,
  sdkMessageId,
  parts,
  tokens: null,
  cost: null,
});

const canonicalSession = (patch: Record<string, unknown> = {}) => ({
  id: LOCAL_ID,
  profileId: 'profile-phase4',
  opencodeAgentId: 'build',
  status: 'idle',
  statusMessage: null,
  sdkSessionId: SDK_ID,
  cwd: '/workspace/rhythm',
  name: 'Phase 4 contract session',
  projectId: null,
  providerId: 'omlx',
  modelId: 'gpt-oss-20b-MXFP4-Q8',
  archivedAt: null,
  category: 'chat',
  parentSessionId: null,
  worktreeName: null,
  worktreePath: null,
  worktreeBranch: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...patch,
});

type HarnessOptions = {
  session?: Record<string, unknown>;
  sessions?: Array<Record<string, unknown>>;
  messages?: CanonicalMessage[];
  olderPages?: Array<{ messages: CanonicalMessage[]; pageInfo: { nextCursor: string | null; hasMore: boolean } }>;
  resumeGone?: boolean;
};

async function openControlledLive(page: Page, options: HarnessOptions = {}) {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const outbound: Array<Record<string, unknown>> = [];
  const sockets: WebSocketRoute[] = [];
  const session = options.session ?? canonicalSession();
  const sessions = options.sessions ?? [session];
  let messages = options.messages ?? [message(1, 'input', 'msg_input', [textPart('in-text', 'Earlier prompt')])];
  let olderPageIndex = 0;

  await page.routeWebSocket('ws://127.0.0.1:4098/ws/agents', (socket) => {
    sockets.push(socket);
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      outbound.push(frame);
      if (frame.type === 'session.input' && Array.isArray(frame.parts)) {
        messages = [message(messages.length + 1, 'input', `msg_input_${messages.length + 1}`, frame.parts as CanonicalPart[])];
      }
    });
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== API && url.origin !== ENGINE) {
      await route.continue();
      return;
    }
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { body = request.postData(); }
    requests.push({ method: request.method(), path: `${url.pathname}${url.search}`, body });

    if (url.origin === ENGINE && url.pathname === '/global/health') {
      await route.fulfill({ status: 200, json: { healthy: true } });
    } else if (url.pathname === '/health') {
      await route.fulfill({ status: 200, json: { status: 'ok' } });
    } else if (url.pathname === '/agent-configs' && request.method() === 'GET') {
      await route.fulfill({ status: 200, json: [{
        id: 'profile-phase4', label: 'Phase 4 profile', icon: 'P4', enabled: true,
        isAgent: true, isManager: false, sessionSelectable: true,
        modelProvider: 'omlx', modelId: 'gpt-oss-20b-MXFP4-Q8', ocAgent: 'build',
        allowedMcpsJson: '[]', allowedSkillsJson: '[]', corePermissionsJson: '{}',
        allowedDelegatesJson: '[]', sortOrder: 0, updatedAt: NOW,
      }] });
    } else if (url.pathname === '/agent-sessions' && request.method() === 'GET') {
      await route.fulfill({ status: 200, json: { sessions } });
    } else if (url.pathname === `/agent-sessions/${LOCAL_ID}` && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        json: {
          session,
          messages,
          transcriptPage: {
            nextCursor: options.olderPages?.length ? 'cursor-1' : null,
            hasMore: Boolean(options.olderPages?.length),
          },
        },
      });
    } else if (url.pathname === `/agent-sessions/${LOCAL_ID}/messages` && request.method() === 'GET') {
      const page = options.olderPages?.[olderPageIndex++] ?? { messages: [], pageInfo: { nextCursor: null, hasMore: false } };
      await route.fulfill({ status: 200, json: page });
    } else if (url.pathname === `/agent-sessions/${LOCAL_ID}/cancel` && request.method() === 'POST') {
      await route.fulfill({ status: 204 });
    } else if (url.pathname === `/agent-sessions/${LOCAL_ID}/resume` && request.method() === 'POST') {
      await route.fulfill(options.resumeGone
        ? { status: 410, json: { error: `SDK session ${SDK_ID} no longer exists. Use start-fresh to create a new session.` } }
        : { status: 200, json: canonicalSession({ status: 'starting' }) });
    } else if (url.pathname === `/agent-sessions/${LOCAL_ID}/children/${CHILD_SDK_ID}/messages` && request.method() === 'GET') {
      await route.fulfill({ status: 200, json: { messages: [message(1, 'output', 'msg_child_output', [textPart('out-child', 'Child transcript result')])] } });
    } else {
      await route.fulfill({ status: 501, json: { error: `Unhandled contract route ${request.method()} ${url.pathname}` } });
    }
  });

  await page.goto('/#/agents');
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Phase 4 contract session' })).toBeVisible();
  requests.length = 0;
  outbound.length = 0;
  return {
    requests,
    outbound,
    sockets,
    send: (frame: Record<string, unknown>, index = sockets.length - 1) => {
      if (
        frame.type === 'message.part.delta' &&
        typeof frame.messageId === 'string' &&
        typeof frame.partId === 'string' &&
        frame.field === 'text' &&
        typeof frame.delta === 'string'
      ) {
        const existing = messages.find((item) => item.sdkMessageId === frame.messageId);
        if (existing) {
          const part = existing.parts.find((item) => item.id === frame.partId);
          if (part) part.text = `${String(part.text ?? '')}${frame.delta}`;
          else existing.parts.push(textPart(frame.partId, frame.delta));
        } else {
          messages.push(message(messages.length + 1, 'output', frame.messageId, [textPart(frame.partId, frame.delta)]));
        }
      }
      sockets[index].send(JSON.stringify(frame));
    },
  };
}

test('post-m1-p4-c2b: every canonical text delta accumulates before idle', async ({ page }) => {
  // Regression caught: streamedPartsRef deduplicates later deltas for the same part;
  // the complete-before-idle text assertion fails after only the first fragment.
  const harness = await openControlledLive(page, { messages: [] });
  harness.send({ v: 1, type: 'session.status', id: LOCAL_ID, status: 'working', working: true });
  harness.send({ v: 1, type: 'message.part.delta', id: LOCAL_ID, messageId: 'msg_stream', partId: 'part_stream', field: 'text', delta: 'alpha-' });
  harness.send({ v: 1, type: 'message.part.delta', id: LOCAL_ID, messageId: 'msg_stream', partId: 'part_stream', field: 'text', delta: 'beta-' });
  harness.send({ v: 1, type: 'message.part.delta', id: LOCAL_ID, messageId: 'msg_stream', partId: 'part_stream', field: 'text', delta: 'gamma' });
  await expect(page.getByTestId('message-msg_stream')).toContainText('alpha-beta-gamma');
});

test('post-m1-p4-c2d: canonical structured parts retain their types live and after reload', async ({ page }) => {
  // Regression caught: REST/live mapping coerces every canonical part to markdown;
  // the semantic renderers and part-specific labels are absent.
  const structured: CanonicalPart[] = [
    textPart('out-text', 'VISIBLE_TEXT_PART'),
    { id: 'out-reasoning', type: 'reasoning', text: 'VISIBLE_REASONING_PART' },
    { id: 'out-tool', type: 'tool', callID: 'call_phase4', tool: 'read', state: { status: 'completed', input: { filePath: 'phase4.txt' }, output: 'VISIBLE_TOOL_PART', title: 'Read phase4.txt', metadata: {}, time: { start: 1, end: 2 } } },
    { id: 'out-step-start', type: 'step-start', snapshot: 'VISIBLE_STEP_START' },
    { id: 'out-step-finish', type: 'step-finish', reason: 'stop', snapshot: 'VISIBLE_STEP_FINISH', cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
    { id: 'out-compaction', type: 'compaction', auto: true },
    { id: 'out-file', type: 'file', mime: 'image/png', filename: 'phase4.png', url: 'data:image/png;base64,iVBORw0KGgo=' },
    { id: 'out-agent', type: 'agent', name: 'build', source: { value: 'VISIBLE_AGENT_PART', start: 0, end: 18 } },
  ];
  const harness = await openControlledLive(page, { messages: [message(1, 'output', 'msg_structured', structured)] });
  await expect(page.locator('.reasoning-block')).toContainText('VISIBLE_REASONING_PART');
  await expect(page.locator('.tool-block')).toContainText('VISIBLE_TOOL_PART');
  await expect(page.getByText('phase4.png')).toBeVisible();
  harness.send({ v: 1, type: 'message.part.updated', id: LOCAL_ID, messageId: 'msg_structured', partId: 'out-reasoning', part: structured[1] });
  harness.send({ v: 1, type: 'message.updated', id: LOCAL_ID, info: { id: 'msg_structured', role: 'assistant' } });
  await page.reload();
  await expect(page.locator('.reasoning-block')).toContainText('VISIBLE_REASONING_PART');
});

test('post-m1-p4-c2e: real selected files become canonical session.input.parts and survive reload', async ({ page }) => {
  // Regression caught: the live composer exposes fixture choices and drops attachments from
  // session.input; the real file input or canonical parts assertions fail.
  const harness = await openControlledLive(page, { messages: [] });
  const chooser = page.locator('input[type="file"]');
  await expect(chooser, 'live composer must expose a real local file input').toHaveCount(1);
  await chooser.setInputFiles([
    { name: 'phase4.txt', mimeType: 'text/plain', buffer: Buffer.from('PHASE4_TEXT_FILE') },
    { name: 'phase4.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') },
  ]);
  await page.getByTestId('composer-input').fill('Deliver both attachments');
  await page.getByTestId('composer-send').click();
  await expect.poll(() => harness.outbound.find((frame) => frame.type === 'session.input')).toMatchObject({
    v: 1,
    type: 'session.input',
    id: LOCAL_ID,
    parts: expect.arrayContaining([
      { type: 'text', text: expect.stringContaining('PHASE4_TEXT_FILE') },
      { type: 'file', mime: 'image/png', filename: 'phase4.png', url: expect.stringMatching(/^data:image\/png;base64,/) },
    ]),
  });
  await page.reload();
  await expect(page.getByText('phase4.png')).toBeVisible();
});

test('post-m1-p4-c2f: older transcript pagination follows exclusive before cursors', async ({ page }) => {
  // Regression caught: Load older messages invents a local system row instead of requesting
  // the canonical paged endpoint; the request/cursor and prepended-message assertions fail.
  const older = message(1, 'system', 'msg_older', [textPart('out-older', 'CANONICAL_OLDER_MESSAGE')]);
  const harness = await openControlledLive(page, {
    olderPages: [
      { messages: [older], pageInfo: { nextCursor: 'cursor-2', hasMore: true } },
      { messages: [], pageInfo: { nextCursor: null, hasMore: false } },
    ],
  });
  await page.getByTestId('load-older').click();
  await expect.poll(() => harness.requests.some((request) => {
    const url = new URL(request.path, API);
    return request.method === 'GET' &&
      url.pathname === `/agent-sessions/${LOCAL_ID}/messages` &&
      url.searchParams.get('limit') === '50' &&
      url.searchParams.get('before') === 'cursor-1';
  })).toBe(true);
  await expect(page.getByText('CANONICAL_OLDER_MESSAGE')).toBeVisible();
  await page.getByTestId('load-older').click();
  await expect.poll(() => harness.requests.some((request) => {
    const url = new URL(request.path, API);
    return request.method === 'GET' &&
      url.pathname === `/agent-sessions/${LOCAL_ID}/messages` &&
      url.searchParams.get('limit') === '50' &&
      url.searchParams.get('before') === 'cursor-2';
  })).toBe(true);
  await expect(page.getByTestId('message-msg_older')).toHaveCount(1);
  await expect(page.getByTestId('load-older')).toHaveCount(0);
});

test('post-m1-p4-c3a: disconnect queues ordered input, reconnects, subscribes, and rehydrates', async ({ page }) => {
  // Regression caught: close drops the pending queue and no reconnect loop exists;
  // the second socket, ordered once-only frames, subscribe, or detail-refetch assertion fails.
  const harness = await openControlledLive(page, { messages: [] });
  // React 18 StrictMode double-invokes the connect effect in dev, so the mount that survives
  // is whichever socket connected last (the harness's own `send()` already defaults to this
  // same "current" socket via `sockets.length - 1`) — close that one, not a torn-down first mount.
  harness.sockets[harness.sockets.length - 1].close();
  for (const prompt of ['QUEUED_FIRST', 'QUEUED_SECOND']) {
    await page.getByTestId('composer-input').fill(prompt);
    await page.getByTestId('composer-input').press('Enter');
  }
  await expect.poll(() => harness.sockets.length).toBeGreaterThan(1);
  await expect.poll(() => harness.outbound.filter((frame) => frame.type === 'session.input').map((frame) => frame.data)).toEqual([
    'QUEUED_FIRST',
    'QUEUED_SECOND',
  ]);
  expect(harness.outbound.filter((frame) => frame.type === 'session.subscribe')).toEqual([
    { v: 1, type: 'session.subscribe', id: LOCAL_ID },
  ]);
  await expect.poll(() => harness.requests.filter((request) => request.method === 'GET' && request.path.startsWith(`/agent-sessions/${LOCAL_ID}?`)).length).toBeGreaterThan(0);
});

test('post-m1-p4-c3c: cancel posts the local id and preserves partial transcript', async ({ page }) => {
  // Regression caught: live Cancel only mutates fixture-shaped local state; the POST is absent.
  const harness = await openControlledLive(page, { messages: [] });
  harness.send({ v: 1, type: 'message.part.delta', id: LOCAL_ID, messageId: 'msg_partial', partId: 'part_partial', field: 'text', delta: 'PERSISTED_PARTIAL' });
  await expect(page.getByTestId('composer-cancel')).toBeVisible();
  await page.getByTestId('composer-cancel').click();
  await expect.poll(() => harness.requests.map((request) => `${request.method} ${request.path}`)).toContain(
    `POST /agent-sessions/${LOCAL_ID}/cancel`,
  );
  await page.reload();
  await expect(page.getByText('PERSISTED_PARTIAL')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Phase 4 contract session' })).toBeVisible();
});

test('post-m1-p4-c3d: resume reattaches sdkSessionId and exposes HTTP 410 start-fresh state', async ({ page }) => {
  // Regression caught: Resume mutates local group/status and silently substitutes identity;
  // the POST, stable SDK identity, or actionable 410 state assertion fails.
  const harness = await openControlledLive(page, {
    session: canonicalSession({ status: 'resumable' }),
    resumeGone: true,
  });
  await page.getByTestId(`session-menu-${LOCAL_ID}`).click();
  await page.getByTestId(`resume-${LOCAL_ID}`).click();
  await expect.poll(() => harness.requests.map((request) => `${request.method} ${request.path}`)).toContain(
    `POST /agent-sessions/${LOCAL_ID}/resume`,
  );
  await expect(page.getByRole('alert')).toContainText(/SDK session.*no longer exists/i);
  await expect(page.getByRole('button', { name: /start fresh/i })).toBeVisible();
  await expect(page.getByText(SDK_ID)).toBeVisible();
});

test('post-m1-p4-c3e: retrying status renders canonical attempt and reason then clears', async ({ page }) => {
  // Regression caught: session.status retry metadata is collapsed to idle/working;
  // attempt and reason never render, or remain stale after progress.
  const harness = await openControlledLive(page);
  harness.send({ v: 1, type: 'session.status', id: LOCAL_ID, status: 'retrying', attempt: 3, reason: 'provider_rate_limit' });
  const retry = page.getByRole('status').filter({ hasText: /retry/i });
  await expect(retry).toContainText('3');
  await expect(retry).toContainText('provider_rate_limit');
  harness.send({ v: 1, type: 'message.part.delta', id: LOCAL_ID, messageId: 'msg_retry', partId: 'part_retry', field: 'text', delta: 'progress' });
  await expect(retry).toHaveCount(0);
});

test('post-m1-p4-c2j: task child navigation keeps parent local and child SDK identities distinct', async ({ page }) => {
  // Regression caught: React treats the child SDK ID as a fixture/local row ID and never calls
  // the child transcript route with the parent local ID; route and read-only assertions fail.
  const taskPart: CanonicalPart = {
    id: 'out-task', type: 'tool', callID: 'call_task', tool: 'task',
    state: {
      status: 'completed',
      input: { description: 'Phase 4 child task' },
      output: `task_id: ${CHILD_SDK_ID} (for resuming to continue this task if needed)`,
      title: 'Phase 4 child task', metadata: {}, time: { start: 1, end: 2 },
    },
  };
  const harness = await openControlledLive(page, { messages: [message(1, 'output', 'msg_task', [taskPart])] });
  await page.getByRole('button', { name: /open child session phase 4 child task/i }).click();
  await expect.poll(() => harness.requests.map((request) => `${request.method} ${request.path}`)).toContain(
    `GET /agent-sessions/${LOCAL_ID}/children/${CHILD_SDK_ID}/messages`,
  );
  await expect(page.getByText('Child transcript result')).toBeVisible();
  await expect(page.getByText('Read only')).toBeVisible();
  await page.getByTestId('child-back').click();
  await expect(page.getByText('Phase 4 child task')).toBeVisible();
});
