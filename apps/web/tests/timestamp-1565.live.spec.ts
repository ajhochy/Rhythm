import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createRequire } from 'node:module';

const api = process.env.RHYTHM_LIVE_API_URL!;
const engine = process.env.RHYTHM_LIVE_ENGINE_URL!;
const token = 'e02-synthetic-session-not-a-secret';
const headers = { Authorization: `Bearer ${token}` };
const requireApi = createRequire(new URL('../../api_server/package.json', import.meta.url));
const dbPath = process.env.RHYTHM_SANDBOX_DIR && `${process.env.RHYTHM_SANDBOX_DIR}/rhythm.db`;

test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

async function fetchRows<T>(request: APIRequestContext, path: string): Promise<T[]> {
  const response = await request.get(`${api}${path}`, { headers });
  expect(response.status(), `${path} must come from the real sandbox API`).toBe(200);
  const rows: unknown = await response.json();
  expect(Array.isArray(rows), `${path} must expose an array`).toBe(true);
  return rows as T[];
}

async function visit(page: Page, route: string, name: string, outputPath: (name: string) => string) {
  const unexpected: string[] = [];
  await page.route('**/*', async routeRequest => {
    const url = new URL(routeRequest.request().url());
    // The production-routed gateway remains real. Only this reserved test origin
    // is forwarded to the isolated API; no DNS or network request reaches it.
    if (url.origin === 'https://timestamp-test.invalid') {
      const response = await routeRequest.fetch({
        url: `${api}${url.pathname}${url.search}`,
        headers: { ...routeRequest.request().headers(), ...headers },
        maxRedirects: 0,
      });
      expect(response.status(), 'sandbox forwarding must not redirect').toBeLessThan(300);
      return routeRequest.fulfill({ response });
    }
    if (!['http:', 'ws:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || !['4175', '6597', '6598', '6599'].includes(url.port)) {
      unexpected.push(url.href);
      return routeRequest.abort('blockedbyclient');
    }
    return routeRequest.continue();
  });
  await page.goto(`/#/${route}`);
  await expect(page.locator('#main-content')).toBeVisible();
  expect(unexpected, 'no request outside the isolated API or reserved test proxy').toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow`).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter(v => v.impact === 'critical'), `${name} critical accessibility violations`).toEqual([]);
  await page.screenshot({ path: outputPath(`issue-1565-live-${name}.png`), fullPage: true });
}

test('issue-1565-c3/c4: real sandbox messages populated, invalid and empty timestamp shapes reach rendered semantics', async ({ page, request }, info) => {
  expect(dbPath).toMatch(/^\/private\/tmp\/[^/]+\/rhythm\.db$/);
  const health = await request.get(`${api}/opencode/health`);
  expect((await health.json()).status).toBe('ready');
  expect((await request.get(engine)).status()).toBeLessThan(500);
  expect(await fetchRows(request, '/message-threads')).toEqual([]);
  const created = await request.post(`${api}/message-threads`, { headers, data: { title: '1565 synthetic thread', threadType: 'group', participantIds: [2] } });
  expect(created.status()).toBe(201);
  const thread = await created.json() as { id: number };
  const first = await request.post(`${api}/message-threads/${thread.id}/messages`, { headers, data: { body: 'Z instant' } });
  expect(first.status()).toBe(201);
  const second = await request.post(`${api}/message-threads/${thread.id}/messages`, { headers, data: { body: 'invalid instant' } });
  expect(second.status()).toBe(201);
  const firstId = (await first.json() as { id: number }).id;
  const secondId = (await second.json() as { id: number }).id;
  // Only the sandbox runtime copy is mutated. The source fixture stays read-only.
  const Database = requireApi('better-sqlite3') as new (path: string) => { prepare(sql: string): { run(...values: unknown[]): unknown }; close(): void };
  const db = new Database(dbPath!);
  try {
    db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run('2026-09-24T20:01:05Z', firstId);
    db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run('1970-01-01T00:00:00Z', secondId);
  } finally { db.close(); }
  const rows = await fetchRows<{ id: number; createdAt: string }>(request, `/message-threads/${thread.id}/messages`);
  expect(rows.find(row => row.id === firstId)?.createdAt).toBe('2026-09-24T20:01:05Z');
  expect(rows.find(row => row.id === secondId)?.createdAt).toBe('1970-01-01T00:00:00Z');
  await visit(page, `messages/${thread.id}`, 'messages', name => info.outputPath(name));
  const valid = page.locator('.messages-message', { hasText: 'Z instant' }).locator('time');
  await expect(valid).toHaveAttribute('datetime', '2026-09-24T20:01:05.000Z');
  await expect(valid).toHaveAttribute('title', /2026.*1:01:05 PM.*PDT/);
  await expect(valid.locator('[aria-hidden="true"]')).toHaveText(/1:01 PM/);
  await expect(valid.locator('.sr-only')).toHaveText(await valid.getAttribute('title') ?? '');
  const invalid = page.locator('.messages-message', { hasText: 'invalid instant' });
  await expect(invalid.locator('time')).toHaveCount(0);
  await expect(invalid.locator('[data-timestamp-fallback]')).toHaveText('Time unavailable');
  expect(await invalid.locator('[data-timestamp-fallback]').evaluate(el => getComputedStyle(el).fontSize)).toBe('8px');
  await page.screenshot({ path: info.outputPath('issue-1565-live-message-fallback.png'), fullPage: true });
});

test.describe('second timezone', () => {
  test.use({ timezoneId: 'Asia/Kolkata' });
  test('issue-1565-c3: real API Z instant renders a different compact hour in Kolkata', async ({ page, request }, info) => {
    const rows = await fetchRows<{ id: number; title: string }>(request, '/message-threads');
    const thread = rows.find(row => row.title === '1565 synthetic thread');
    expect(thread).toBeDefined();
    await visit(page, `messages/${thread!.id}`, 'kolkata-messages', name => info.outputPath(name));
    const time = page.locator('.messages-message', { hasText: 'Z instant' }).locator('time');
    await expect(time).toHaveAttribute('datetime', '2026-09-24T20:01:05.000Z');
    await expect(time.locator('[aria-hidden="true"]')).toContainText('1:31 AM');
  });
});
