import { expect, test } from '@playwright/test';

// Real end-to-end reproduction of the ST-1 production failure: the mobile
// provider had no `message.part.delta` handling, so `message.part.updated`
// armed a resettable 150ms debounce that, once it finally fired, replaced the
// whole transcript with a fresh `GET /session/:id/message` (measured at
// 1.61 MB/pause). Under a continuous token stream the debounce was starved,
// so the transcript froze until generation stopped, then slammed in the
// whole payload at once. With several sessions streaming at once this
// bricked the app.
//
// This spec drives the REAL `expo export` web build against the REAL fake
// OpenCode SSE server (see playwright.config.mjs) -- no mocked provider, no
// mocked reducer. It proves, with three sessions streaming concurrently:
//   1. Transcript text grows DURING generation, before `session.idle`.
//   2. Zero full-page `GET /session/:id/message` calls happen while deltas
//      are streaming (the proving assertion for the fix).
//   3. Sessions never cross-contaminate each other's deltas.
//   4. After `session.idle`, each transcript deep-equals (via its visible
//      text) the authoritative `GET /session/:id/message` payload.

const fakePort =
  process.env.RHYTHM_MOBILE_E2E_FAKE_PORT ??
  process.env.PLAYWRIGHT_FAKE_PORT ??
  '44096';
const fakeServer = `http://127.0.0.1:${fakePort}`;

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${fakeServer}/__control/reset`, {
    data: { scenario: 'happy-path' },
  });
  expect(response.ok()).toBeTruthy();
});

async function openAgentsAction(page, name) {
  await expect(page.getByRole('menuitem')).toHaveCount(0, { timeout: 10_000 });
  await page
    .getByRole('button', { name: 'Chats menu', exact: true })
    .locator('visible=true')
    .click();
  const action = page
    .getByRole('menuitem', { name, exact: true })
    .locator('visible=true');
  await expect(action).toBeVisible({ timeout: 30_000 });
  return action;
}

async function activateMenuItem(item) {
  await item.click();
}

// Creates a chat and returns its real session id, read straight off the
// `POST /session` response -- never invented, never guessed from the title.
async function createChat(page, title) {
  const create = await openAgentsAction(page, 'Create chat');
  await expect(create).toBeEnabled({ timeout: 30_000 });
  await activateMenuItem(create);
  const titleInput = page
    .getByLabel('Chat title', { exact: true })
    .locator('visible=true');
  await titleInput.fill(title);
  await expect(titleInput).toHaveValue(title);
  await titleInput.press('Tab');
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        new URL(res.url()).pathname === '/session',
    ),
    page
      .getByRole('button', { name: 'Create', exact: true })
      .locator('visible=true')
      .click(),
  ]);
  const session = await response.json();
  await expect(
    page.getByPlaceholder('Ask anything...').locator('visible=true'),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole('button', { name: 'Back to Agents', exact: true })
    .locator('visible=true')
    .click();
  return session.id;
}

// Fresh, prompt-less sessions report status "idle", which the chat list's
// default "active" lifecycle filter hides (active == working/busy/starting/
// retry/running/queued). Switch to "All chat states" once so every created
// session stays reachable by its row testID regardless of status.
async function showAllChatStates(page) {
  await activateMenuItem(await openAgentsAction(page, 'All chat states'));
}

// The "All chat states" filter (deliberately, see chat-list.tsx) stops
// auto-expanding project groups, so the demo-project group can still be
// collapsed even though our sessions are underneath it. Expand it once, and
// only if it is actually collapsed -- clicking an already-expanded header
// would toggle it back closed.
async function ensureProjectGroupExpanded(page) {
  const collapsedHeader = page
    .getByRole('button', { name: /demo-project.*collapsed/ })
    .locator('visible=true');
  if (await collapsedHeader.count()) {
    await collapsedHeader.click();
  }
}

async function openChatRow(page, sessionId) {
  await ensureProjectGroupExpanded(page);
  await page
    .getByTestId(`chat-row-open-${sessionId}`)
    .locator('visible=true')
    .click();
  await expect(
    page.getByTestId('chat-transcript').locator('visible=true'),
  ).toBeVisible({ timeout: 30_000 });
}

async function backToAgents(page) {
  await page
    .getByRole('button', { name: 'Back to Agents', exact: true })
    .locator('visible=true')
    .click();
}

function transcriptLocator(page) {
  return page.getByTestId('chat-transcript').locator('visible=true');
}

function joinChunks(chunks) {
  return chunks.join('').trim();
}

async function burstDeltas(request, sessionId, chunks, intervalMs) {
  const response = await request.post(`${fakeServer}/__control/delta-burst`, {
    data: { sessionId, chunks, intervalMs },
  });
  expect(response.ok()).toBeTruthy();
  return response;
}

async function flushIdle(request, sessionId) {
  const response = await request.post(`${fakeServer}/__control/delta-burst`, {
    data: { sessionId, chunks: [], idle: true },
  });
  expect(response.ok()).toBeTruthy();
  return response;
}

test('three concurrent sessions stream deltas live, without full-page refetches, and never cross-contaminate', async ({
  page,
  request,
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const idA = await createChat(page, 'Delta Session Alpha');
  const idB = await createChat(page, 'Delta Session Bravo');
  const idC = await createChat(page, 'Delta Session Charlie');
  await showAllChatStates(page);

  const chunkSets = {
    [idA]: ['Alpha-1 ', 'Alpha-2 ', 'Alpha-3 ', 'Alpha-4 ', 'Alpha-5 ', 'Alpha-6 ', 'Alpha-7 ', 'Alpha-8 '],
    [idB]: ['Bravo-1 ', 'Bravo-2 ', 'Bravo-3 ', 'Bravo-4 ', 'Bravo-5 ', 'Bravo-6 ', 'Bravo-7 ', 'Bravo-8 '],
    [idC]: ['Charlie-1 ', 'Charlie-2 ', 'Charlie-3 ', 'Charlie-4 ', 'Charlie-5 ', 'Charlie-6 ', 'Charlie-7 ', 'Charlie-8 '],
  };
  const intervalMs = 150; // matches the production cadence named in the bug report

  // Open session A first so its one legitimate "load transcript on open" GET
  // fires and settles BEFORE we start counting. That isolates the bug's
  // debounce-driven refetch from the ordinary GET every chat open causes.
  await openChatRow(page, idA);

  const messageGetHits = [];
  const onRequest = (req) => {
    if (
      req.method() === 'GET' &&
      /\/session\/[^/]+\/message$/.test(new URL(req.url()).pathname)
    ) {
      messageGetHits.push({ url: req.url(), t: Date.now() });
    }
  };
  page.on('request', onRequest);
  await page.waitForTimeout(150); // let the initial load's GET land before the window starts

  const streamWindowStart = Date.now();
  const bursts = Promise.all([
    burstDeltas(request, idA, chunkSets[idA], intervalMs),
    burstDeltas(request, idB, chunkSets[idB], intervalMs),
    burstDeltas(request, idC, chunkSets[idC], intervalMs),
  ]);

  // --- Assertion 1: transcript text grows DURING generation, pre-idle. ---
  // Session A is on screen; wait for an early chunk, then immediately check
  // the final chunk has NOT landed yet -- proving we caught a real partial
  // state and not the fully-settled final text.
  await expect(transcriptLocator(page)).toContainText('Alpha-2', { timeout: 5_000 });
  const midStreamText = await transcriptLocator(page).innerText();
  expect(midStreamText).not.toContain('Alpha-8');
  // --- Assertion 3 (partial, live): no cross-session contamination while streaming. ---
  expect(midStreamText).not.toContain('Bravo');
  expect(midStreamText).not.toContain('Charlie');

  await bursts;
  const streamWindowEnd = Date.now();
  page.off('request', onRequest);

  // --- Assertion 2: zero full-page messages GETs while deltas were streaming. ---
  const duringStream = messageGetHits.filter(
    (hit) => hit.t >= streamWindowStart && hit.t <= streamWindowEnd,
  );
  expect(duringStream, JSON.stringify(duringStream)).toHaveLength(0);

  // --- Assertion 3 (full): each session shows only its own streamed text. ---
  for (const [key, id] of [['a', idA], ['b', idB], ['c', idC]]) {
    await backToAgents(page);
    await openChatRow(page, id);
    await expect(transcriptLocator(page)).toContainText(joinChunks(chunkSets[id]), { timeout: 10_000 });
    const text = await transcriptLocator(page).innerText();
    for (const [otherKey, otherId] of [['a', idA], ['b', idB], ['c', idC]]) {
      if (otherKey === key) continue;
      const otherWord = chunkSets[otherId][0].split('-')[0];
      expect(text).not.toContain(otherWord);
    }
  }

  // --- Assertion 4: after session.idle, each transcript reconciles with the
  // authoritative GET /session/:id/message payload. ---
  for (const id of [idA, idB, idC]) {
    await flushIdle(request, id);
  }

  for (const id of [idA, idB, idC]) {
    await backToAgents(page);
    await openChatRow(page, id);
    await page.waitForTimeout(300); // let the idle reconciliation GET (delayMs: 50) land
    const messagesResponse = await request.get(`${fakeServer}/session/${id}/message`);
    expect(messagesResponse.ok()).toBeTruthy();
    const messages = await messagesResponse.json();
    const assistantMessage = messages.find((message) => message.info.role === 'assistant');
    const authoritativeText = assistantMessage.parts
      .find((part) => part.type === 'text')
      .text.trim();
    expect(authoritativeText).toBe(joinChunks(chunkSets[id]));
    const displayedText = await transcriptLocator(page).innerText();
    expect(displayedText).toContain(authoritativeText);
  }
});
