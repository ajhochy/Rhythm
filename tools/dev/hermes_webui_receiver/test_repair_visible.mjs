// Frozen visibility acceptance, real copied renderer; no response or CSS injection.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const [base, dependency, executablePath, evidence] = process.argv.slice(2);
assert.match(base, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
const { chromium } = createRequire(import.meta.url)(dependency);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === base
    ? route.continue() : route.abort('blockedbyclient'));
  const page = await context.newPage();
  const diagnostics = [];
  page.on('pageerror', e => diagnostics.push({ error: e.message }));
  page.on('response', r => { if (r.status() >= 400) diagnostics.push({ url: r.url(), status: r.status() }); });
  await page.goto(base + '/?session=fixture-chat', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => S._bootReady && !_loadingSessionId && _gatewaySSE?.readyState === 1);
  await page.evaluate(() => loadSession('fixture-chat'));
  await page.waitForFunction(() => _isSessionCurrentPane('fixture-chat') && _sessionEventSource?.readyState === 1);
  const event = { version: 2, runId: 'fixture-run', eventId: 'fixture-event', cursor: 1,
    sessionId: 'fixture-anchor', hermesSessionId: 'fixture-chat', workflowId: 'fixture-run',
    kind: 'progress', text: 'Rhythm session linked.', referenceId: null, state: 'pending' };
  const response = await context.request.post(base + '/api/rhythm-notify/receive', {
    headers: { Authorization: 'Bearer fixture-only-token' }, data: event });
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.querySelector('#messages')?.innerText.includes('Fixture native reply.'));
  const reply = page.locator('#messages').getByText('Fixture native reply.', { exact: true }).first();
  await reply.scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence + '/red-live.png', fullPage: true });
  const proof = await reply.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { width: r.width, height: r.height, hit: hit?.outerHTML.slice(0, 300),
      unobscured: hit === el || el.contains(hit) };
  });
  console.log(JSON.stringify({ proof, diagnostics }));
  assert.ok(await reply.isVisible(), 'Reply element must be visible');
  assert.ok(proof.unobscured, 'Reply must pass hit-test, not sit behind first-run overlay');
  await context.close();
} finally {
  await browser.close();
}
