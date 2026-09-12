import { mkdir } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import type { WebSocketRoute } from '@playwright/test';
const safe = { id: 'safe', category: 'message', content: { type: 'text', text: 'Reviewed text A' } };
const tool = { id: 'tool', category: 'tool_output', content: { type: 'tool', output: 'Explicit tool content' } };
const artifactId = '11111111-1111-4111-8111-111111111111';
for (const initiallyEmpty of [true, false]) {
  test(`E25B-empty-identity: ${initiallyEmpty ? 'empty startup' : 'removed selected session'} never mounts session requests or stale panels`, async ({ page }) => {
    // Regression: mounting Inspector children with the store's real empty ID leaks requests/data.
    let empty = initiallyEmpty;
    let socket: WebSocketRoute | undefined;
    const forbidden: string[] = [];
    const session = { id: 'empty-check', name: 'Selected session', profileId: 'profile', status: 'idle', createdAt: '2026-09-11T00:00:00Z' };
    await page.routeWebSocket(/\/ws\/agents$/, value => { socket = value; });
    await page.route(/https:\/\/e25b.invalid|http:\/\/127.0.0.1:(4199|4197)/, async route => {
      const path = new URL(route.request().url()).pathname;
      if (empty && (path.startsWith('/agent-sessions/') || path.startsWith('/agent-run-outcomes/') || path === '/shares' || path.startsWith('/shares/'))) {
        forbidden.push(path); return route.abort();
      }
      let json: unknown = [];
      if (path === '/agent-configs') json = [{ id: 'profile', label: 'Profile', enabled: true }];
      else if (path === '/agent-sessions') json = { sessions: empty ? [] : [session] };
      else if (path === '/agent-sessions/empty-check') json = { session, messages: [] };
      else if (path.endsWith('/todo')) json = [{ id: 'old', content: 'Previous session plan', status: 'pending', priority: 'high' }];
      else if (path.endsWith('/memory-provenance')) json = { recorded: true, memoryIds: ['previous-memory'], notePaths: [], items: [] };
      else if (path.endsWith('/messages')) json = { messages: [], pageInfo: { hasMore: false, nextCursor: null } };
      await route.fulfill({ json });
    });
    await page.goto('/tests/electron-e22-harness.html');
    const inspector = page.getByLabel('Session inspector', { exact: true });
    if (!initiallyEmpty) {
      await expect(inspector).toContainText('Previous session plan');
      await expect(inspector).toContainText('previous-memory');
      await expect.poll(() => Boolean(socket)).toBe(true);
      empty = true;
      socket!.send(JSON.stringify({ v: 1, type: 'session.removed', id: session.id }));
    }
    await expect.poll(async () => JSON.parse(await page.getByTestId('state').innerText()).selected.id).toBe('');
    for (const tab of ['context', 'artifacts', 'files', 'changes', 'terminal']) {
      await page.getByTestId(`inspector-${tab}`).click();
      await expect(inspector.getByRole('status')).toHaveText('Select a session to inspect its details.');
      await expect(inspector).not.toContainText('Previous session plan');
      await expect(inspector).not.toContainText('previous-memory');
      await expect(inspector.getByRole('button', { name: /Review transcript share|Refresh shares|Refresh plan|Refresh resources/ })).toHaveCount(0);
    }
    await expect(inspector.locator('iframe')).toHaveCount(0);
    expect(forbidden).toEqual([]);
  });
}
async function open(page: Page, conflict = false, unavailable = false) {
  let revision = 'a'; let share: Record<string, unknown> | undefined;
  const posts: unknown[] = []; const requests: string[] = []; const sharingBoundaries: Array<{ origin: string; authorization: string | null }> = [];
  const session = { id: 'e25b', name: 'E25B', ownerUserId: 4189, profileId: 'profile', status: 'idle', createdAt: '2026-09-11T00:00:00Z' };
  await page.routeWebSocket(/\/ws\/agents$/, () => {});
  await page.route(/https:\/\/e25b.invalid|http:\/\/127.0.0.1:(4199|4197)/, async route => {
    const request = route.request(); const path = new URL(request.url()).pathname; requests.push(`${request.method()} ${path}`);
    if (path.includes('/shares') || path === '/workspaces/me/members') sharingBoundaries.push({ origin: new URL(request.url()).origin, authorization: request.headers()['authorization'] ?? null });
    const fail = (status: number) => route.fulfill({ status, json: { error: { code: 'UNAVAILABLE' } } });
    let json: unknown = [];
    if (path === '/agent-configs') json = [{ id: 'profile', label: 'Profile', enabled: true }];
    else if (path === '/agent-sessions') json = { sessions: [session] };
    else if (path === '/agent-sessions/e25b') json = { session, messages: [] };
    else if (path.endsWith('/todo')) { if (unavailable) return fail(503); json = [{ id: 't1', content: 'Real session todo', status: 'in_progress', priority: 'high' }]; }
    else if (path.endsWith('/memory-provenance')) json = { recorded: true, memoryIds: ['memory-real'], notePaths: ['project/real.md'], items: [] };
    else if (path.endsWith('/messages')) json = new URL(request.url()).searchParams.has('before')
      ? { messages: [{ id: 1, parts: [{ type: 'tool', tool: 'rhythm_create_live_artifact', state: { status: 'completed', output: JSON.stringify({ id: artifactId }) } }, { type: 'tool', tool: 'rhythm_update_live_artifact_state', state: { status: 'completed', input: { id: artifactId } } }] }], pageInfo: { hasMore: false, nextCursor: null } }
      : { messages: [{ id: 2, parts: [{ id: 'mcp', type: 'tool', callID: 'call-real', tool: 'mcp_demo', state: { status: 'completed', mcpAppResource: { sessionID: 'sdk-e25b', callID: 'call-real', serverName: 'demo', resourceUri: 'ui://real', advertisedAt: '2026-09-11T00:00:00.000Z', expiresAt: '2026-09-11T00:10:00.000Z' } } }] }], pageInfo: { hasMore: true, nextCursor: 2 } };
    else if (path === `/live-artifacts/${artifactId}`) json = { id: artifactId, title: 'Real session artifact', state: { version: 2 } };
    else if (path === `/live-artifacts/${artifactId}/render`) return route.fulfill({ contentType: 'text/html', body: '<h1>Persisted artifact content</h1>' });
    else if (path.endsWith('/mcp-app-resource/call-real')) { if (unavailable) return fail(404); json = { mimeType: 'text/html;profile=mcp-app', text: '<h1>Bound resource</h1><a href="https://escape.invalid">Untrusted link</a><script>parent.postMessage("unsafe", "*")</script><form action="https://escape.invalid"><input value="private"></form>' }; }
    else if (path.endsWith('/shares/review')) { if (unavailable) return fail(403); json = { sourceOwnerUserId: 4189, reviewHash: revision.repeat(64), review: { items: [safe, tool] }, snapshot: { items: [safe] }, inclusiveSnapshot: { items: [safe, tool] } }; }
    else if (path === '/workspaces/me/members') json = [{ userId: 4189, name: 'Owner' }, { userId: 4190, name: 'Recipient Real', email: 'recipient@example.invalid' }];
    else if (path === '/agent-sessions/e25b/shares' && request.method() === 'POST') {
      const body = request.postDataJSON(); posts.push(body);
      if (conflict && revision === 'a') { revision = 'b'; return fail(409); }
      share = { id: 'share-real', sourceSessionId: 'e25b', ownerUserId: 4189, recipientUserIds: body.recipientUserIds, snapshot: { items: [safe, tool].filter(item => body.review.items.some((selected: { id: string }) => selected.id === item.id)) }, expiresAt: '2099-01-01T00:00:00Z', revokedAt: null };
      return route.fulfill({ status: 201, json: share });
    } else if (path === '/shares') json = share ? [share] : [];
    else if (path === '/shares/share-real' && request.method() === 'DELETE') { share = { ...share, revokedAt: '2026-09-11T00:00:00Z' }; return route.fulfill({ status: 204 }); }
    else if (path === '/shares/share-real') json = share;
    return route.fulfill({ json });
  });
  await page.goto('/tests/electron-e22-harness.html');
  await page.getByTestId('inspector-context').click();
  return { posts, requests, sharingBoundaries };
}
test('E25B-c4: composing AgentsWorkspace renders API todos and provenance, not fixture claims', async ({ page }) => {
  await open(page);
  await expect(page.getByLabel('Session inspector')).toContainText('Real session todo');
  await expect(page.getByLabel('Session inspector')).toContainText('project/real.md');
  await expect(page.getByLabel('Session inspector')).not.toContainText('fixed fixture clock');
});
test('E25B-c5: exact server-sanitized selection, authoritative recipients, list/read/revoke', async ({ page }) => {
  const { posts, requests, sharingBoundaries } = await open(page);
  await page.getByRole('button', { name: 'Review transcript share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share reviewed transcript' });
  await expect(dialog).toContainText('Reviewed text A');
  await expect(dialog.getByLabel('Include tool')).not.toBeChecked();
  await dialog.getByLabel('Include tool').check();
  await dialog.getByLabel('Recipient Real').check();
  await mkdir('../../docs/ai/runs/artifacts/e25b', { recursive: true });
  await page.screenshot({ path: '../../docs/ai/runs/artifacts/e25b/share-review.png' });
  await dialog.getByRole('button', { name: 'Create immutable share' }).click();
  await expect(page.getByTestId('share-share-real')).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ reviewHash: 'a'.repeat(64), review: { items: [safe, tool] }, recipientUserIds: [4190], explicitlyIncludedItemIds: ['tool'] });
  expect(requests).toContain('GET /workspaces/me/members'); expect(requests).not.toContain('GET /users');
  await page.getByTestId('share-share-real').getByRole('button', { name: 'View snapshot' }).click();
  await expect(page.getByRole('dialog', { name: 'Shared snapshot' })).toContainText('Explicit tool content');
  await page.getByRole('dialog', { name: 'Shared snapshot' }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('share-share-real').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByTestId('share-share-real')).toContainText('Revoked');
  expect(sharingBoundaries.length).toBeGreaterThan(0);
  expect(sharingBoundaries.every(boundary => boundary.origin === 'https://e25b.invalid' && boundary.authorization === 'Bearer e25b-synthetic')).toBe(true);
});
test('E25B-c6: conflict invalidates confirmation and requires a new review, never auto-retries', async ({ page }) => {
  const { posts } = await open(page, true);
  await page.getByRole('button', { name: 'Review transcript share', exact: true }).click();
  await page.getByLabel('Recipient Real').check();
  await page.getByRole('button', { name: 'Create immutable share' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Review again' })).toBeVisible();
  expect(posts).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Create immutable share' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review transcript share', exact: true }).click();
  await page.getByLabel('Recipient Real').check();
  await page.getByRole('button', { name: 'Create immutable share' }).click();
  await expect(page.getByTestId('share-share-real')).toBeVisible();
  expect(posts[1]).toMatchObject({ reviewHash: 'b'.repeat(64) });
});
test('E25B-c7: MCP resource comes from call-bound route, with a non-executable isolated preview', async ({ page }) => {
  const { requests } = await open(page);
  await page.getByTestId('inspector-artifacts').click();
  await page.getByRole('button', { name: 'Open MCP resource call-real' }).click();
  const frame = page.getByTitle('MCP resource call-real');
  await expect(frame).toHaveAttribute('sandbox', '');
  await expect(frame.contentFrame().getByRole('heading', { name: 'Bound resource' })).toBeVisible();
  await expect(frame.contentFrame().locator('script, form, [href], [src], [onclick]')).toHaveCount(0);
  expect(requests).toContain('GET /agent-sessions/e25b/mcp-app-resource/call-real');
  await mkdir('../../docs/ai/runs/artifacts/e25b', { recursive: true });
  await page.screenshot({ path: '../../docs/ai/runs/artifacts/e25b/inspector-resource.png', fullPage: false });
});
test('E25B-c7: earlier structured history yields one stable artifact and consumes real detail/render routes', async ({ page }) => {
  const { requests } = await open(page);
  await page.getByTestId('inspector-artifacts').click();
  await page.getByRole('button', { name: 'Load earlier resources' }).click();
  const openArtifact = page.getByRole('button', { name: `Open artifact ${artifactId}` });
  await expect(openArtifact).toHaveCount(1); await openArtifact.click();
  await expect(page.getByTitle('Real session artifact').contentFrame().getByRole('heading', { name: 'Persisted artifact content' })).toBeVisible();
  expect(requests).toContain(`GET /live-artifacts/${artifactId}`);
  expect(requests).toContain(`GET /live-artifacts/${artifactId}/render`);
  await expect(page.getByRole('button', { name: 'Load earlier resources' })).toHaveCount(0);
});
test('E25B-c8: unavailable services surface errors, never fixture resources or false sharing success', async ({ page }) => {
  await open(page, false, true);
  await expect(page.getByLabel('Session inspector')).toContainText('Session plan unavailable');
  await page.getByRole('button', { name: 'Review transcript share', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Share review unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create immutable share' })).toHaveCount(0);
  await page.getByTestId('inspector-artifacts').click();
  await page.getByRole('button', { name: 'Open MCP resource call-real' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Resource unavailable' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});
