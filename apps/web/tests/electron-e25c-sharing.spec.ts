import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createInspectorGateway } from '../src/gateway/inspector';

const Database = createRequire(import.meta.url)('better-sqlite3') as new (path: string) => any;

const safeItem = { id: 'safe', category: 'message', content: { type: 'text', text: 'Sanitized selected copy' } };
const excludedEmail = { id: 'excluded-email', category: 'email', content: { type: 'tool', output: '[sanitized email preview]' } };
const excludedPath = { id: 'excluded-path', category: 'host_path', content: { type: 'text', text: '[sanitized path preview]' } };

async function installSharingFixture(page: Page, options: { shares?: any[]; sessions?: any[]; shareReadStatus?: number; sharePostStatus?: number; recipientsStatus?: number } = {}) {
  const session = { id: 'e25c', name: 'E25C', ownerUserId: 4189, profileId: 'profile', status: 'idle', createdAt: '2026-09-11T00:00:00Z' };
  const state = { posts: [] as any[], shares: [...(options.shares ?? [])], reviewRequests: 0 };
  await page.routeWebSocket(/\/ws\/agents$/, () => {});
  await page.route(/https:\/\/e25b.invalid|http:\/\/127.0.0.1:(4199|4197)/, async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    let json: unknown = [];
    if (path === '/agent-configs') json = [{ id: 'profile', label: 'Profile', enabled: true }];
    else if (path === '/agent-sessions') json = { sessions: options.sessions ?? [session] };
    else if (path === '/agent-sessions/e25c') json = { session, messages: [] };
    else if (path.endsWith('/messages')) json = { messages: [], pageInfo: { hasMore: false } };
    else if (path.endsWith('/shares/review')) { state.reviewRequests += 1; json = {
      sourceOwnerUserId: 4189,
      reviewHash: 'a'.repeat(64),
      review: { items: [safeItem, excludedEmail, excludedPath] },
      snapshot: { items: [safeItem] },
      inclusiveSnapshot: { items: [safeItem, excludedEmail, excludedPath] },
    }; }
    else if (path === '/workspaces/me/members') { if (options.recipientsStatus) return route.fulfill({ status: options.recipientsStatus, json: { error: 'unavailable' } }); json = [{ userId: 4189, name: 'Owner' }, { userId: 4190, name: 'Alex Recipient' }, { userId: 4191, name: 'Blair Recipient' }]; }
    else if (path === '/shares' && request.method() === 'POST') {
      const body = request.postDataJSON(); state.posts.push(body);
      if (options.sharePostStatus) return route.fulfill({ status: options.sharePostStatus, json: { error: 'synthetic failure' } });
      const created = { id: `share-${state.posts.length}`, ownerUserId: 4189, sourceSessionId: 'e25c', recipientUserIds: body.recipientUserIds, snapshot: body.review, expiresAt: body.expiresAt, revokedAt: null };
      state.shares.push(created); return route.fulfill({ status: 201, json: created });
    } else if (path === '/shares') json = state.shares;
    else if (path.startsWith('/shares/') && request.method() === 'DELETE') {
      const share = state.shares.find(item => item.id === path.split('/').pop());
      if (share) share.revokedAt = '2026-09-24T12:00:00Z';
      return route.fulfill({ status: 204 });
    } else if (path.startsWith('/shares/')) {
      const share = state.shares.find(item => item.id === path.split('/').pop());
      if (options.shareReadStatus || share?.revokedAt) return route.fulfill({ status: options.shareReadStatus ?? 410, json: { error: 'raw_status_must_not_render' } });
      json = share;
    }
    await route.fulfill({ json });
  });
  return state;
}

test('1425:share-review-confirm-expiry-ui:1 excluded summary tracks explicit inclusion', async ({ page }) => {
  await installSharingFixture(page);
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByRole('button', { name: 'Review transcript share' }).click();
  const dialog = page.getByTestId('transcript-share-review');
  await expect(dialog).toContainText('Excluded by default (2)');
  await expect(dialog).toContainText('email: 1');
  await expect(dialog).toContainText('host path: 1');
  await expect(dialog.getByTestId('share-item-excluded-email')).toContainText('Excluded by default');
  await dialog.getByLabel('Include excluded-email').check();
  await expect(dialog.getByTestId('share-item-excluded-email')).toContainText('Explicitly included');
  await expect(dialog).toContainText('Excluded by default (1)');
});

test('1425:share-review-confirm-expiry-ui:2 expiry defaults to 90 days and POST carries chosen window', async ({ page }) => {
  const state = await installSharingFixture(page);
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByRole('button', { name: 'Review transcript share' }).click();
  const dialog = page.getByTestId('transcript-share-review');
  await expect(dialog.getByLabel('Expires after')).toHaveValue('90');
  await expect(dialog.getByLabel('Expires after').locator('option')).toHaveText(['7 days', '30 days', '90 days']);
  await dialog.getByLabel('Expires after').selectOption('30');
  await dialog.getByLabel('Alex Recipient').check();
  await dialog.getByRole('button', { name: 'Create immutable share' }).click();
  await page.getByTestId('transcript-share-confirm').getByRole('button', { name: 'Confirm and share' }).click();
  await expect.poll(() => state.posts).toHaveLength(1);
  const delta = new Date(state.posts[0].expiresAt).getTime() - Date.now();
  expect(delta).toBeGreaterThan(29.99 * 24 * 60 * 60 * 1000);
  expect(delta).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
});

test('review:Inspector.tsx:167 default 90-day expiry is server-owned', async ({ page }) => {
  const state = await installSharingFixture(page);
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByRole('button', { name: 'Review transcript share' }).click();
  await page.getByLabel('Alex Recipient').check();
  await page.getByRole('button', { name: 'Create immutable share' }).click();
  await page.getByTestId('transcript-share-confirm').getByRole('button', { name: 'Confirm and share' }).click();
  await expect.poll(() => state.posts).toHaveLength(1);
  expect(state.posts[0]).not.toHaveProperty('expiresAt');
});

test('1425:share-review-confirm-expiry-ui:3 confirmation is the only publication boundary', async ({ page }) => {
  const state = await installSharingFixture(page);
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByRole('button', { name: 'Review transcript share' }).click();
  await page.getByLabel('Alex Recipient').check();
  await page.getByRole('button', { name: 'Create immutable share' }).click();
  expect(state.posts).toHaveLength(0);
  const confirm = page.getByTestId('transcript-share-confirm');
  await expect(confirm).toContainText('Alex Recipient');
  await expect(confirm).toContainText('90 days');
  await expect(confirm).toContainText('1 included');
  await expect(confirm).toContainText('2 excluded');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  const reviewsAfterCancel = state.reviewRequests;
  await page.waitForTimeout(100);
  expect(state.posts).toHaveLength(0);
  expect(state.reviewRequests).toBe(reviewsAfterCancel);
  await page.getByRole('button', { name: 'Create immutable share' }).click();
  await page.getByTestId('transcript-share-confirm').getByRole('button', { name: 'Confirm and share' }).click();
  await expect.poll(() => state.posts).toHaveLength(1);
});

test('review:Inspector.tsx:201 failed confirmation stays visible and announces the error', async ({ page }) => {
  await installSharingFixture(page, { sharePostStatus: 500 });
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByRole('button', { name: 'Review transcript share' }).click();
  await page.getByLabel('Alex Recipient').check();
  await page.getByRole('button', { name: 'Create immutable share' }).click();
  const confirm = page.getByTestId('transcript-share-confirm');
  await confirm.getByRole('button', { name: 'Confirm and share' }).click();
  await expect(confirm.getByRole('alert')).toHaveText('Share creation unavailable. No success confirmed.');
  await expect(confirm.getByRole('button', { name: 'Confirm and share' })).toBeFocused();
});

test('review:Inspector.tsx:143 shares survive a recipient-directory failure and current actor is named', async ({ page }) => {
  await installSharingFixture(page, { recipientsStatus: 503, shares: [{ id: 'self', ownerUserId: 4189, sourceSessionId: 'e25c', recipientUserIds: [4189], snapshot: { items: [safeItem] }, expiresAt: '2099-01-01T00:00:00Z', revokedAt: null }] });
  await page.goto('/tests/electron-e22-harness.html');
  const share = page.getByTestId('share-self');
  await expect(share).toBeVisible();
  await expect(share).toContainText('Recipients: You');
});

test('review:AgentsWorkspace.tsx:161 shared list does not displace conversation grid tracks', async ({ page }) => {
  await installSharingFixture(page);
  await page.goto('/tests/electron-e22-harness.html');
  const boxes = await page.locator('.conversation-pane').evaluate(element => {
    const box = (selector: string) => { const rect = element.querySelector(selector)!.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height }; };
    return { header: box('.session-header'), transcript: box('.transcript-reader'), composer: box('.composer') };
  });
  expect(boxes.header.height).toBeGreaterThan(0);
  expect(boxes.transcript.height).toBeGreaterThan(0);
  expect(boxes.composer.height).toBeGreaterThan(0);
  expect(boxes.header.bottom).toBeLessThanOrEqual(boxes.transcript.top + 1);
  expect(boxes.transcript.bottom).toBeLessThanOrEqual(boxes.composer.top + 1);
});

test('1425:share-review-confirm-expiry-ui:4 share list names source and snapshot without numeric recipients', async ({ page }) => {
  await installSharingFixture(page, { shares: [
    { id: 'active', ownerUserId: 4189, sourceSessionId: 'e25c', recipientUserIds: [4190], snapshot: { items: [safeItem] }, expiresAt: '2099-01-01T00:00:00Z', revokedAt: null },
    { id: 'revoked', ownerUserId: 4189, sourceSessionId: 'e25c', recipientUserIds: [4191], snapshot: { items: [] }, expiresAt: '2099-01-01T00:00:00Z', revokedAt: '2026-09-11T00:00:00Z' },
    { id: 'expired', ownerUserId: 4189, sourceSessionId: 'e25c', recipientUserIds: [4190], snapshot: { items: [] }, expiresAt: '2020-01-01T00:00:00Z', revokedAt: null },
  ] });
  await page.goto('/tests/electron-e22-harness.html');
  const panel = page.getByLabel('Transcript sharing');
  await expect(panel).toContainText('Private source session');
  await expect(panel).toContainText('Shared snapshot (immutable)');
  await expect(panel).toContainText('Alex Recipient');
  await expect(panel).not.toContainText('Recipients: 4190');
  await expect(panel.getByTestId('share-revoked')).toContainText('Revoked');
  await expect(panel.getByTestId('share-expired')).toContainText('Expired');
  await expect(panel).not.toContainText('at most 30 days');
});

test('1425:share-review-confirm-expiry-ui:5 review and confirmation have no serious or critical axe violations', async ({ page }) => {
  await installSharingFixture(page);
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByRole('button', { name: 'Review transcript share' }).click();
  let result = await new AxeBuilder({ page }).include('[data-testid="transcript-share-review"]').analyze();
  expect(result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
  await page.getByLabel('Alex Recipient').check();
  await page.getByRole('button', { name: 'Create immutable share' }).click();
  result = await new AxeBuilder({ page }).include('[data-testid="transcript-share-confirm"]').analyze();
  expect(result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});

test('1425:shared-with-me-and-denial-states:1 zero-session recipient can list and open immutable snapshots', async ({ page }) => {
  await installSharingFixture(page, { sessions: [], shares: [{ id: 'recipient-copy', ownerUserId: 4190, sourceSessionId: null, recipientUserIds: [4189], snapshot: { items: [{ ...safeItem, content: { type: 'text', text: 'Recipient immutable snapshot' } }] }, expiresAt: '2099-01-01T00:00:00Z', revokedAt: null }] });
  await page.goto('/tests/electron-e22-harness.html');
  const list = page.getByLabel('Shared with me');
  await expect(list.getByTestId('shared-with-me-recipient-copy')).toContainText('Shared snapshot (immutable)');
  await list.getByRole('button', { name: 'Open shared snapshot' }).click();
  await expect(page.getByTestId('shared-with-me-snapshot')).toContainText('Recipient immutable snapshot');
});

test('1425:shared-with-me-and-denial-states:2 denied reads are generic and never log snapshot content', async ({ page }) => {
  const logs: string[] = []; page.on('console', message => logs.push(message.text()));
  const secret = 'SNAPSHOT_CONTENT_MUST_NEVER_LOG';
  for (const status of [401, 404, 410]) {
    await page.unrouteAll({ behavior: 'wait' });
    await installSharingFixture(page, { sessions: [], shareReadStatus: status, shares: [{ id: `denied-${status}`, ownerUserId: 4190, sourceSessionId: null, recipientUserIds: [4189], snapshot: { items: [{ ...safeItem, content: secret }] }, expiresAt: '2099-01-01T00:00:00Z', revokedAt: null }] });
    await page.goto('/tests/electron-e22-harness.html');
    await page.getByLabel('Shared with me').getByRole('button', { name: 'Open shared snapshot' }).click();
    await expect(page.getByLabel('Shared with me')).toContainText('Shared snapshot unavailable');
    await expect(page.getByLabel('Shared with me')).not.toContainText(secret);
    await expect(page.getByLabel('Shared with me')).not.toContainText(String(status));
  }
  expect(logs.join('\n')).not.toContain(secret);
});

test('1425:shared-with-me-and-denial-states:3 revoke updates owner and recipient surfaces immediately', async ({ page }) => {
  await installSharingFixture(page, { shares: [{ id: 'shared-active', ownerUserId: 4189, sourceSessionId: 'e25c', recipientUserIds: [4189], snapshot: { items: [safeItem] }, expiresAt: '2099-01-01T00:00:00Z', revokedAt: null }] });
  await page.goto('/tests/electron-e22-harness.html');
  await expect(page.getByTestId('shared-with-me-shared-active')).toBeVisible();
  await page.getByTestId('share-shared-active').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByTestId('share-shared-active')).toContainText('Revoked');
  await expect(page.getByTestId('shared-with-me-shared-active')).toHaveCount(0);
});

test('1425:shared-with-me-and-denial-states:4 shared-with-me list has no serious or critical axe violations', async ({ page }) => {
  await installSharingFixture(page, { sessions: [], shares: [{ id: 'axe-copy', ownerUserId: 4190, sourceSessionId: null, recipientUserIds: [4189], snapshot: { items: [safeItem] }, expiresAt: '2099-01-01T00:00:00Z', revokedAt: null }] });
  await page.goto('/tests/electron-e22-harness.html');
  const result = await new AxeBuilder({ page }).include('[aria-label="Shared with me"]').analyze();
  expect(result.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});

test('E25C-c6: safe live local review publishes sanitized selection to inert production only', async ({ request }) => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Uses only test-owned rows in the approved synthetic sandbox');
  const local = 'http://127.0.0.1:4098'; const token = 'e02-synthetic-session-not-a-secret';
  const sandbox = realpathSync(process.env.RHYTHM_SANDBOX_DIR ?? '');
  const dbPath = realpathSync(process.env.RHYTHM_LIVE_DB_PATH ?? '');
  expect(dbPath.startsWith(`${sandbox}/`)).toBe(true);
  const db = new Database(dbPath);
  const seededSourceId = `e25c-${randomUUID()}`;
  expect(db.prepare("SELECT id FROM users WHERE id = 1 AND email = 'admin@example.invalid'").get()).toBeTruthy();
  db.prepare("INSERT INTO agent_sessions (id, agent_kind, status, cwd, name, owner_user_id) VALUES (?, 'codex', 'idle', '/tmp/e25c', 'E25C live source', 1)").run(seededSourceId);
  db.prepare("INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text, parts_json) VALUES (?, 'user', 'approved E25C transcript', 'approved E25C transcript', ?)").run(seededSourceId, JSON.stringify([{ id: 'e25c-safe', type: 'text', text: 'approved E25C transcript' }]));
  try {
  const health = await request.get(`${local}/opencode/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ready' });
  const sessions = await request.get(`${local}/agent-sessions`);
  expect(sessions.status()).toBe(200);
  const rows = (await sessions.json()).sessions as Array<{ id: string; ownerUserId?: number }>;
  let source: { id: string; prepared: any } | undefined;
  const candidates: Array<{ status: number; owned?: boolean; safeItems?: number }> = [];
  for (const row of rows.slice(0, 20)) {
    const result = await request.get(`${local}/agent-sessions/${encodeURIComponent(row.id)}/shares/review`, { headers: { Authorization: `Bearer ${token}` } });
    if (result.status() !== 200) { candidates.push({ status: result.status() }); continue; }
    const prepared = await result.json();
    candidates.push({ status: 200, owned: prepared.sourceOwnerUserId === 1, safeItems: prepared.snapshot.items.length });
    if (prepared.sourceOwnerUserId === 1 && prepared.snapshot.items.length) { source = { id: row.id, prepared }; break; }
  }
  expect(source, `Existing nonempty synthetic owned source required; never seed manager sandbox. Candidates=${JSON.stringify(candidates)}`).toBeTruthy();
  let copy: any; const receipts: string[] = [];
  const boundary: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    receipts.push(`${init?.method ?? 'GET'} ${url.origin}${url.pathname}`);
    if (url.origin === local) {
      expect(init?.method).toBe('GET');
      return fetch(input, init);
    }
    expect(url.origin).toBe('https://e25c.invalid');
    if (url.pathname === '/shares' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      expect(body.review).toEqual(source!.prepared.snapshot);
      copy = { id: 'inert-copy', snapshot: body.review, sourceSessionId: null, ownerUserId: 1, recipientUserIds: [2], revokedAt: null, expiresAt: '2026-10-01T00:00:00Z' };
      return Response.json(copy, { status: 201 });
    }
    if (url.pathname === '/shares/inert-copy' && init?.method === 'DELETE') { copy.revokedAt = 'revoked'; return new Response(null, { status: 204 }); }
    return Response.json(url.pathname === '/shares' ? [copy] : url.pathname.endsWith('/members') ? [{ userId: 2, name: 'Synthetic recipient' }] : copy);
  };
  const gateway = createInspectorGateway(local, 'https://e25c.invalid', token, boundary);
  const prepared = await gateway.review(source!.id);
  expect(prepared.reviewHash).toBe(source!.prepared.reviewHash);
  await gateway.recipients();
  const share = await gateway.createShare(source!.id, { reviewHash: prepared.reviewHash, review: prepared.snapshot, explicitlyIncludedItemIds: [], recipientUserIds: [2], expiresAt: '2026-12-23T00:00:00Z' });
  expect((await gateway.share(share.id)).snapshot).toEqual(prepared.snapshot);
  expect(await gateway.shares()).toHaveLength(1);
  await gateway.revoke(share.id);
  expect(copy.revokedAt).toBe('revoked');
  console.log(`E25C live: real local exact review, ${prepared.snapshot.items.length} sanitized items; ${receipts.length} gateway requests; central boundary inert; test-owned local rows cleaned; no provider input`);
  } finally {
    db.prepare('DELETE FROM agent_session_messages WHERE session_id = ?').run(seededSourceId);
    db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(seededSourceId);
    db.close();
  }
});

test('E25C-c4: changed local hash aborts before central publication', async () => {
  const requests: string[] = [];
  const boundary: typeof fetch = async input => { requests.push(String(input)); return Response.json({ reviewHash: 'b'.repeat(64) }); };
  const gateway = createInspectorGateway('http://127.0.0.1:4199', 'https://e25b.invalid', 'synthetic', boundary);
  await expect(gateway.createShare('source', { reviewHash: 'a'.repeat(64), review: { items: [] }, explicitlyIncludedItemIds: [], recipientUserIds: [1], expiresAt: '2026-12-23T00:00:00Z' })).rejects.toMatchObject({ status: 409 });
  expect(requests).toEqual(['http://127.0.0.1:4199/agent-sessions/source/shares/review']);
});

test('E25C-c3: real SharePanel reviews locally but publishes only sanitized selection to central authority', async ({ page }) => {
  const safe = { id: 'safe', category: 'message', content: { type: 'text', text: 'Sanitized selected copy' } };
  const excluded = { id: 'excluded', category: 'email', content: { type: 'tool', output: 'RAW_EXCLUDED_EMAIL' } };
  const session = { id: 'e25c', name: 'E25C', ownerUserId: 4189, profileId: 'profile', status: 'idle', createdAt: '2026-09-11T00:00:00Z' };
  const receipts: Array<{ path: string; origin: string; method: string; auth: string | undefined }> = [];
  let share: any; let published: any;
  await page.routeWebSocket(/\/ws\/agents$/, () => {});
  await page.route(/https:\/\/e25b.invalid|http:\/\/127.0.0.1:(4199|4197)/, async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (path.includes('/shares') || path.includes('/members')) receipts.push({ path, origin: url.origin, method: request.method(), auth: request.headers().authorization });
    let json: unknown = [];
    if (path === '/agent-configs') json = [{ id: 'profile', label: 'Profile', enabled: true }];
    else if (path === '/agent-sessions') json = { sessions: [session] };
    else if (path === '/agent-sessions/e25c') json = { session, messages: [] };
    else if (path.endsWith('/messages')) json = { messages: [], pageInfo: { hasMore: false } };
    else if (path.endsWith('/shares/review')) json = { sourceOwnerUserId: 4189, reviewHash: 'a'.repeat(64), review: { items: [safe, excluded] }, snapshot: { items: [safe] }, inclusiveSnapshot: { items: [safe, { ...excluded, content: '[sanitized excluded preview]' }] } };
    else if (path === '/workspaces/me/members') json = [{ userId: 4190, name: 'Recipient' }];
    else if (path === '/shares' && request.method() === 'POST') {
      published = request.postDataJSON(); share = { id: 'detached', ownerUserId: 4189, sourceSessionId: null, recipientUserIds: [4190], snapshot: published.review, expiresAt: '2026-10-01T00:00:00Z', revokedAt: null };
      return route.fulfill({ status: 201, json: share });
    } else if (path === '/shares') json = share ? [share] : [];
    else if (path === '/shares/detached' && request.method() === 'DELETE') { share.revokedAt = '2026-09-11T00:00:00Z'; return route.fulfill({ status: 204 }); }
    else if (path === '/shares/detached') json = share;
    await route.fulfill({ json });
  });
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByRole('button', { name: 'Review transcript share', exact: true }).click();
  await page.getByLabel('Recipient', { exact: true }).check();
  await page.getByRole('button', { name: 'Create immutable share' }).click();
  await page.getByRole('button', { name: 'Confirm and share' }).click();
  await expect(page.getByTestId('share-detached')).toBeVisible();
  expect(published.review).toEqual({ items: [safe] });
  expect(JSON.stringify(published)).not.toContain('RAW_EXCLUDED_EMAIL');
  await page.getByRole('button', { name: 'View snapshot' }).click();
  await expect(page.getByRole('dialog', { name: 'Shared snapshot' })).toContainText('Sanitized selected copy');
  await page.getByRole('dialog', { name: 'Shared snapshot' }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByTestId('share-detached')).toContainText('Revoked');
  await expect(page.getByLabel('Transcript sharing')).toContainText('even if the local session is deleted');
  expect(receipts.some(r => r.path.endsWith('/shares/review'))).toBe(true);
  for (const r of receipts) {
    expect(r.auth).toBe('Bearer e25b-synthetic');
    expect(r.origin).toBe(r.path.startsWith('/agent-sessions/') ? 'http://127.0.0.1:4199' : 'https://e25b.invalid');
  }
});
