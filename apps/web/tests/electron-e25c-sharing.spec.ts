import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import { createInspectorGateway } from '../src/gateway/inspector';

const Database = createRequire(import.meta.url)('better-sqlite3') as new (path: string) => any;

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
  const share = await gateway.createShare(source!.id, { reviewHash: prepared.reviewHash, review: prepared.snapshot, explicitlyIncludedItemIds: [], recipientUserIds: [2] });
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
  await expect(gateway.createShare('source', { reviewHash: 'a'.repeat(64), review: { items: [] }, explicitlyIncludedItemIds: [], recipientUserIds: [1] })).rejects.toMatchObject({ status: 409 });
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
