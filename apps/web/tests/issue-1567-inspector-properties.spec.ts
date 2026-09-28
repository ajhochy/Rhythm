import { expect, test } from '@playwright/test';
import { chooseDemo, openFixture } from './helpers';
import { fulfillJson, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

async function openLive(page, costs: number[]) {
  const seen: SeenRequest[] = [];
  const session = { id: 'properties', name: 'Properties', status: 'idle', category: 'chat', profileId: 'profile', providerId: 'openai', modelId: 'gpt-test', cwd: '/fixture', isolateWorktree: true, worktreeBranch: 'opencode/properties', createdAt: '2026-09-24T10:00:00Z', updatedAt: '2026-09-24T11:00:00Z' };
  const messages = costs.map((cost, index) => ({ sdkMessageId: `cost-${index}`, role: 'output', createdAt: `2026-09-24T10:0${index}:00Z`, cost, parts: [{ id: `part-${index}`, type: 'text', text: `answer ${index}` }] }));
  await openPhase7Live(page, '/agents', seen, async (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/agent-sessions') return fulfillJson(route, 200, { sessions: [session], pageInfo: { hasMore: false, nextCursor: null } }).then(() => true);
    if (path === '/agent-sessions/properties') return fulfillJson(route, 200, { session, messages, transcriptPage: { hasMore: false, nextCursor: null } }).then(() => true);
    if (path === '/agent-configs') return fulfillJson(route, 200, [{ id: 'profile', label: 'Coding Workflow', enabled: true, sessionSelectable: true }]).then(() => true);
    if (path === '/agents/models/catalog') return fulfillJson(route, 200, [{ provider: 'openai', modelId: 'gpt-test', displayName: 'GPT Test', authorized: true, contextLimit: 200000 }]).then(() => true);
    if (path === '/opencode/auth/accounts') return fulfillJson(route, 200, { accounts: [] }).then(() => true);
    if (path === '/agents/usage-budget') return fulfillJson(route, 200, { providers: [] }).then(() => true);
    return false;
  });
  await expect(page.getByTestId('context-panel')).toBeVisible();
}

test('1567:reduce-inspector-properties:1 context properties retain only unique timestamps and isolated branch', async ({ page }) => {
  await openLive(page, [0.10543375, 0.0940935]);
  const panel = page.getByTestId('context-panel');
  await expect(panel).not.toContainText('$2.00 session cap');
  const labels = await panel.locator('.property-list dt').allTextContents();
  expect(labels).toEqual(['Created', 'Updated', 'Worktree branch']);
  await expect(panel.locator('.property-list time')).toHaveCount(2);
  await expect(panel.locator('.property-list time').nth(0)).toHaveAttribute('datetime', '2026-09-24T10:00:00.000Z');
  await expect(panel).toContainText('opencode/properties');
});

test('1567:reduce-inspector-properties:2 header sums loaded positive message costs and hides plan-priced zero', async ({ page }) => {
  await openLive(page, [0.10543375, 0.0940935]);
  await expect(page.getByTestId('session-cost')).toHaveText('$0.20');
  await expect(page.getByTestId('session-cost')).not.toHaveText('$0.000');
  await page.reload();
  await openLive(page, [0, 0]);
  await expect(page.getByTestId('session-cost')).toHaveCount(0);
});

test('1567:reduce-inspector-properties:3 artifact update is a semantic timestamp', async ({ page }) => {
  await openFixture(page);
  await chooseDemo(page, 'completed');
  await page.getByTestId('inspector-artifacts').click();
  const timestamp = page.locator('.artifact-meta time');
  await expect(timestamp).toHaveCount(1);
  await expect(timestamp).toHaveAttribute('datetime', /T/);
});
