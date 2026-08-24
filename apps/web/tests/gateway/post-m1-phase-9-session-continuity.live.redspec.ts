import { expect, test, type Page, type Route, type WebSocketRoute } from '@playwright/test';

// post-m1-p9-c3b/c3d/c3e/c3f: the canonical desktop session boundary — reconnect/re-subscribe/
// queued-input delivery, real attachment parts, per-session diff, and child-session continuity —
// proven against the REAL apps/web gateway/store code (gateway/sessions.ts, store.tsx,
// components/Composer.tsx, components/Inspector.tsx, components/Transcript.tsx) via
// page.route/page.routeWebSocket interception, mirroring
// apps/web/tests/gateway/post-m1-phase-9-mobile-access.live.redspec.ts's installAuthenticatedHost
// pattern. No product test-hook, no VITE_RHYTHM_LIVE_TOKEN.

const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:4591',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-rhythm-human-approval',
};

async function json(route: Route, status: number, value: unknown) {
  await route.fulfill({ status, headers: cors, json: value });
}

async function installAuthenticatedHost(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'rhythmShell', {
      configurable: true,
      value: Object.freeze({
        version: 9,
        gateway: Object.freeze({ apiBase: 'http://127.0.0.1:4098', engineBase: 'http://127.0.0.1:4097', productionApiBase: 'https://api.vcrcapps.com' }),
        auth: Object.freeze({
          signInWithGoogle: async () => ({
            sessionToken: 'phase-9-owner-token',
            user: { id: 91, name: 'Avery Owner', email: 'avery@example.test', role: 'admin', artifactTabIds: [] },
          }),
        }),
      }),
    });
  });
}

const profile = { id: 'profile-1', label: 'Reviewer', icon: 'AG', enabled: true, isAgent: true, isManager: false, sessionSelectable: true, modelProvider: 'anthropic', modelId: 'claude-sonnet-4' };

function sessionRaw(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, name: `Session ${id}`, status: 'idle', cwd: '/workspace/rhythm', branch: 'main',
    profileId: 'profile-1', projectId: 'proj-1', projectName: 'Rhythm', sdkSessionId: `sdk-${id}`,
    createdAt: '2026-08-15T12:00:00.000Z', updatedAt: '2026-08-15T12:00:00.000Z', permissionMode: 'default',
    ...overrides,
  };
}

// A `tool`/`task` part whose output embeds `task_id: <sdk id>` — the exact shape mapPart
// (apps/web/src/gateway/sessions.ts:190-195) reads to surface a clickable child-session chip.
const parentMessages = [
  { sdkMessageId: 'm1', info: { role: 'input', time: 1755259200000 }, parts: [{ type: 'text', text: 'Kick off the review' }] },
  { sdkMessageId: 'm2', info: { role: 'output', time: 1755259210000 }, parts: [{ type: 'tool', tool: 'task', state: { title: 'Delegate to reviewer', status: 'completed', output: 'task_id: sdk-child-1 (for resuming...)' } }] },
];

const childMessages = [
  { sdkMessageId: 'c1', info: { role: 'input', time: 1755259220000 }, parts: [{ type: 'text', text: 'Review the diff' }] },
  { sdkMessageId: 'c2', info: { role: 'output', time: 1755259230000 }, parts: [{ type: 'text', text: 'Looks good.' }] },
  { sdkMessageId: 'c3', info: { role: 'system', time: 1755259240000 }, parts: [{ type: 'text', text: 'Child session archived.' }] },
];

test('post-m1-p9-c3b/c3d/c3e/c3f (live): reconnect delivers queued input once, real attachment parts, per-session diff, and child-session continuity', async ({ page }) => {
  const detailRequests: Record<string, number> = { 'sess-1': 0, 'sess-2': 0 };
  const wsFrames: Array<Record<string, unknown>> = [];
  // apps/web/src/main.tsx:34,72 wraps the app in React.StrictMode, which intentionally
  // double-invokes effects in dev (mount -> cleanup -> mount) to surface cleanup bugs. The
  // store's live-session effect (store.tsx ~301-435) opens the WS and fetches session detail
  // inside that same effect, so this test tracks connections as opened-minus-closed (never a
  // raw creation count) and measures request deltas across the real outage, not absolute totals.
  const wsConnections: WebSocketRoute[] = [];
  const wsClosed = new Set<WebSocketRoute>();
  const liveConnectionCount = () => wsConnections.filter((ws) => !wsClosed.has(ws)).length;

  await installAuthenticatedHost(page);
  await page.routeWebSocket('ws://127.0.0.1:4098/ws/agents', (ws) => {
    wsConnections.push(ws);
    ws.onClose(() => wsClosed.add(ws));
    ws.onMessage((message) => {
      try { wsFrames.push(JSON.parse(String(message))); } catch { /* ignore non-JSON */ }
    });
    // Fully mocked — no upstream connectToServer(). The gateway only needs an OPEN socket.
  });

  await page.route('http://127.0.0.1:4097/**', (route) => json(route, 200, { healthy: true }));
  await page.route('http://127.0.0.1:4098/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    if (url.pathname === '/health') return json(route, 200, { healthy: true });
    if (url.pathname === '/agent-configs') return json(route, 200, [profile]);
    if (url.pathname === '/agent-sessions' && url.searchParams.get('scope') === 'chats') {
      return json(route, 200, { sessions: [sessionRaw('sess-1'), sessionRaw('sess-2')] });
    }
    if (url.pathname === '/agent-sessions/sess-1' && request.method() === 'GET') {
      detailRequests['sess-1'] += 1;
      return json(route, 200, { session: sessionRaw('sess-1'), messages: parentMessages, transcriptPage: { nextCursor: null, hasMore: false } });
    }
    if (url.pathname === '/agent-sessions/sess-2' && request.method() === 'GET') {
      detailRequests['sess-2'] += 1;
      return json(route, 200, { session: sessionRaw('sess-2'), messages: [], transcriptPage: { nextCursor: null, hasMore: false } });
    }
    if (url.pathname === '/agent-sessions/sess-1/diff') {
      return json(route, 200, [{ file: 'services/2026-08-16/run-sheet.md', before: 'old', after: 'new', additions: 3, deletions: 1 }]);
    }
    // c3e (distinct empty state): a second session with no changes yet must render its OWN
    // empty diff — never sess-1's cached rows.
    if (url.pathname === '/agent-sessions/sess-2/diff') return json(route, 200, []);
    if (url.pathname === '/agent-sessions/sess-1/children/sdk-child-1/messages') return json(route, 200, { messages: childMessages });
    if (url.pathname === '/notifications') return json(route, 200, []);
    if (url.pathname === '/agent-approvals') return json(route, 200, []);
    if (/^\/agent-sessions\/[^/]+\/pending-permissions$/.test(url.pathname)) return json(route, 200, []);
    return json(route, 404, { error: { code: 'NOT_FOUND' } });
  });

  await page.goto('/#/agents');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByTestId('transcript')).toBeVisible();
  await expect(page.getByTestId('session-sess-1')).toHaveAttribute('aria-current', 'true');

  // --- c3b: exactly one LIVE connection once StrictMode's double-mount settles (not a raw
  // creation count — see the note above). ---
  await expect.poll(() => liveConnectionCount()).toBe(1);
  const baselineDetailCount = detailRequests['sess-1'];

  // --- c3b: simulate a transient gateway outage, then send while disconnected. ---
  const liveBeforeOutage = wsConnections.find((ws) => !wsClosed.has(ws))!;
  await liveBeforeOutage.close();
  const draft = page.getByTestId('composer-input');
  await draft.fill('Still here after the outage');
  await page.getByTestId('composer-send').click();
  // The frame is queued client-side (gateway/sessions.ts's bounded queue) rather than lost —
  // the optimistic local message row renders immediately regardless of socket state.
  await expect(page.getByText('Still here after the outage')).toBeVisible();

  // Bounded exponential backoff starts at 250ms — wait past it for the reconnect to re-establish
  // exactly one live connection again.
  await expect.poll(() => liveConnectionCount(), { timeout: 5_000 }).toBe(1);
  await expect.poll(() => wsConnections.length, { timeout: 5_000 }).toBeGreaterThan(wsConnections.indexOf(liveBeforeOutage) + 1);
  // c3b: reconnect resubscribes and rehydrates the authoritative transcript exactly once — never
  // silently reuses stale content, never re-fetches in a loop.
  await expect.poll(() => detailRequests['sess-1'], { timeout: 5_000 }).toBe(baselineDetailCount + 1);

  const inputFrames = wsFrames.filter((frame) => frame.type === 'session.input' && frame.data === 'Still here after the outage');
  // Delivered once — no silent loss, no duplication across the reconnect.
  expect(inputFrames).toHaveLength(1);
  const subscribeFrames = wsFrames.filter((frame) => frame.type === 'session.subscribe' && frame.id === 'sess-1');
  expect(subscribeFrames.length).toBeGreaterThanOrEqual(1);

  // --- c3d: a real attachment resolves to a canonical `parts` vocabulary, not a dropped part. ---
  await draft.fill('Please review this note');
  await page.getByTestId('composer-live-file-input').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('attachment body text') });
  await expect(page.getByTestId('live-attachment-0')).toBeVisible();
  await page.getByTestId('composer-send').click();
  await expect.poll(() => wsFrames.some((frame) => frame.type === 'session.input' && Array.isArray(frame.parts))).toBe(true);
  const partsFrame = wsFrames.find((frame) => frame.type === 'session.input' && Array.isArray(frame.parts));
  const parts = (partsFrame?.parts ?? []) as Array<{ type: string; text?: string }>;
  expect(parts.some((part) => part.type === 'text' && part.text === 'Please review this note')).toBe(true);
  expect(parts.some((part) => part.type === 'text' && part.text === 'attachment body text')).toBe(true);

  // --- c3e: session-scoped diff, invalidated per session (not a global cache). ---
  await page.getByTestId('inspector-changes').click();
  await expect(page.getByTestId('changes-panel')).toBeVisible();
  await expect(page.getByTestId('change-file-services-2026-08-16-run-sheet-md')).toContainText('+3');
  await page.getByTestId('session-sess-2').click();
  await expect(page.getByTestId('changes-panel')).toBeVisible();
  // c3e: sess-2's own (empty) diff loaded — distinct empty state, not sess-1's stale rows.
  await expect(page.getByText('No changes.')).toBeVisible();
  await expect(page.getByTestId('change-file-services-2026-08-16-run-sheet-md')).toHaveCount(0);

  // --- c3f: child-session continuity — parentSessionId/sdkSessionId preserved, opened by SDK id. ---
  await page.getByTestId('session-sess-1').click();
  await expect(page.getByTestId('open-child-sdk-child-1')).toBeVisible();
  await page.getByTestId('open-child-sdk-child-1').click();
  await expect(page.getByText('Review the diff')).toBeVisible();
  await expect(page.getByText('Looks good.')).toBeVisible();
  await expect(page.getByText('Child session archived.')).toBeVisible();
  // The child transcript is read only — rendered from its own fetched messages via the SDK
  // child id, never selected into the local session list (its SDK id never becomes a local id).
  await expect(page.getByTestId('session-sdk-child-1')).toHaveCount(0);
});
