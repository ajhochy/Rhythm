// Offline test setup only. Existing copied frontend and real HTTP responses.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const [base, dependency, executablePath] = process.argv.slice(2);
assert.match(base, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
const { chromium } = createRequire(import.meta.url)(dependency);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
const denied = [];
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== base) {
      denied.push(route.request().url());
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base + '/?session=fixture-chat', { waitUntil: 'domcontentloaded' });
  // ponytail: use boot's terminal gateway subscription, not the transient restore.
  // Empty restored chats are intentionally cleared before this subscription.
  await page.waitForFunction(() => S._bootReady && !_loadingSessionId && _gatewaySSE?.readyState === 1,
    null, { timeout: 10000 });
  await page.evaluate(() => loadSession('fixture-chat'));
  try {
    await page.waitForFunction(() => S._bootReady && _isSessionCurrentPane('fixture-chat') && !_loadingSessionId
      && _sessionStreamSessionId === 'fixture-chat' && _sessionEventSource?.readyState === 1,
      null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => S.session.message_count), 0);
    assert.ok(!(await page.locator('#messages').innerText()).includes('Fixture native reply.'));
  } catch (error) {
    console.error(JSON.stringify({ errors, sessionGET: await (await context.request.get(
      base + '/api/session?session_id=fixture-chat')).json(),
      pane: await page.locator('#messages').innerText() }));
    throw error;
  }
  await page.waitForFunction(() => typeof _sessionEventSource !== 'undefined' && _sessionEventSource?.readyState === 1);
  const event = { version: 2, runId: 'fixture-run', eventId: 'fixture-event', cursor: 1,
    sessionId: 'fixture-anchor', hermesSessionId: 'fixture-chat', workflowId: 'fixture-run',
    kind: 'progress', text: 'Rhythm session linked.', referenceId: null, state: 'pending' };
  const response = await context.request.post(base + '/api/rhythm-notify/receive', {
    headers: { Authorization: 'Bearer fixture-only-token' }, data: event });
  assert.equal(response.status(), 200, await response.text());
  try {
    await page.waitForFunction(() => document.querySelector('#messages')?.innerText.includes('Fixture native reply.'),
      null, { timeout: 15000 });
  } catch (error) {
    console.error(JSON.stringify({ errors, pane: await page.locator('#messages').innerText(),
      state: await page.evaluate(() => ({sid:S.session?.session_id, busy:S.busy, stream:S.activeStreamId})) }));
    throw error;
  }
  const live = await page.locator('#messages').innerText();
  assert.equal(live.split('Fixture native reply.').length - 1, 1);
  assert.ok(live.includes('Rhythm session linked.'));
  // Real session frontend reopen from actual saved GET, not a test transcript.
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(base + '/?session=fixture-chat', { waitUntil: 'domcontentloaded' });
  await reopened.waitForFunction(() => S._bootReady && !_loadingSessionId && _gatewaySSE?.readyState === 1,
    null, { timeout: 10000 });
  await reopened.evaluate(() => loadSession('fixture-chat'));
  await reopened.waitForFunction(() => _isSessionCurrentPane('fixture-chat') && !_loadingSessionId
    && _sessionStreamSessionId === 'fixture-chat' && _sessionEventSource?.readyState === 1,
    null, { timeout: 10000 });
  await reopened.waitForFunction(() => document.querySelector('#messages')?.innerText.includes('Fixture native reply.'));
  assert.equal((await reopened.locator('#messages').innerText()).split('Fixture native reply.').length - 1, 1);
  await reopened.evaluate(() => loadSession('foreign-chat'));
  assert.ok(!(await reopened.locator('#messages').innerText()).includes('Fixture native reply.'));
  console.log(JSON.stringify({ liveDOM: 'PASS', reopenDOM: 'PASS', foreignChat: 'PASS',
    externalRequestsAborted: denied.length, pageErrors: errors }));
  await context.close();
} finally {
  await browser.close();
}
