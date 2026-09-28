import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';
import { fulfillJson, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

const session = { id: 'usage-session', name: 'Usage session', status: 'idle', category: 'chat', profileId: 'profile', providerId: 'anthropic', modelId: 'claude-test', cwd: '/fixture', createdAt: '2026-09-24T10:00:00Z', updatedAt: '2026-09-24T10:00:00Z' };
const messages = [
  { sdkMessageId: 'usage-bearing', role: 'output', createdAt: '2026-09-24T10:01:00Z', parts: [{ id: 'usage-text', type: 'text', text: 'Usage-bearing answer' }], tokens: { input: 1200, output: 300, cache: { read: 149500, write: 0 } }, cost: 0.2 },
  { sdkMessageId: 'in-flight-zero', role: 'output', createdAt: '2026-09-24T10:02:00Z', parts: [{ id: 'zero-text', type: 'text', text: '' }], tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } }, cost: 0 },
];
const snapshot = { providers: [
  { provider: 'anthropic', label: 'Anthropic — Team', kind: 'window', accountId: 'team', items: [{ label: '5h limit', remainingFraction: 0.66, resetAt: '2026-09-24T11:10:00Z', detail: 'allowed' }, { label: 'exhausted', remainingFraction: 0, detail: 'allowed' }] },
  { provider: 'anthropic', label: 'Anthropic — Personal', kind: 'window', accountId: 'personal', items: [{ label: 'weekly', remainingFraction: 0.3, resetAt: '2026-09-26T13:00:00Z', detail: 'allowed' }] },
  { provider: 'openrouter', label: 'OpenRouter', kind: 'credits', items: [{ label: 'credits', remainingFraction: 1, detail: '$0.00 / $20.00' }] },
  { provider: 'gemini', label: 'Gemini', kind: 'unavailable', items: [], reason: 'quota fetch 401' },
  { provider: 'openai', label: 'OpenAI', kind: 'unavailable', items: [], reason: 'No usage API for the ChatGPT-plan token (standard API returns 401; Codex usage backend is undocumented).' },
] };

async function open(page, options: { failBudget?: boolean; contextLimit?: number; usageMessages?: unknown[] } = {}) {
  // Reusing the identical hash is a same-document navigation; remount the live store so one
  // scenario's hydrated transcript cannot leak into the next scenario.
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  const seen: SeenRequest[] = [];
  await openPhase7Live(page, '/agents', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-sessions') return fulfillJson(route, 200, { sessions: [session], pageInfo: { hasMore: false, nextCursor: null } }).then(() => true);
    if (url.pathname === '/agent-sessions/usage-session') return fulfillJson(route, 200, { session, messages: options.usageMessages ?? messages, transcriptPage: { hasMore: false, nextCursor: null } }).then(() => true);
    if (url.pathname === '/agent-configs') return fulfillJson(route, 200, [{ id: 'profile', label: 'Agent', enabled: true, sessionSelectable: true }]).then(() => true);
    if (url.pathname === '/agents/models/catalog') return fulfillJson(route, 200, [{ provider: 'anthropic', modelId: 'claude-test', displayName: 'Claude Test', authorized: true, ...(options.contextLimit === undefined ? { contextLimit: 1050000 } : options.contextLimit > 0 ? { contextLimit: options.contextLimit } : {}) }]).then(() => true);
    if (url.pathname === '/opencode/auth/accounts') return fulfillJson(route, 200, { accounts: [] }).then(() => true);
    if (url.pathname === '/agents/usage-budget') return fulfillJson(route, options.failBudget ? 500 : 200, options.failBudget ? { error: 'failed' } : snapshot).then(() => true);
    if (url.pathname === '/agent-run-outcomes/usage-session') return fulfillJson(route, 200, { explicitUserVerdict: 'partial' }).then(() => true);
    return false;
  });
  await expect(page.getByTestId('context-panel')).toBeVisible();
  return seen;
}

test('1566:inspector-usage-panel-and-context-gauge:1 renders all provider shapes and real context usage', async ({ page }) => {
  await open(page);
  const panel = page.getByTestId('usage-budget-panel');
  await expect(panel).toContainText('Anthropic — Team');
  await expect(panel).toContainText('5h limit');
  await expect(panel).toContainText('66%');
  await expect(panel).toContainText(/resets (?:\d+[mhd]|now)/);
  await expect(panel).toContainText('Anthropic — Personal');
  await expect(panel).toContainText('OpenRouter');
  await expect(panel).toContainText('$0.00 / $20.00');
  await expect(panel.locator('.usage-provider-unavailable').filter({ hasText: 'Gemini' })).toContainText('quota fetch 401');
  await expect(panel).toContainText('No usage API for the ChatGPT-plan token');
  await expect(panel.locator('.usage-provider-unavailable progress')).toHaveCount(0);
  await expect(panel.locator('progress[aria-label="exhausted remaining"]')).toHaveAttribute('value', '0');
  await expect(page.getByTestId('context-usage-value')).toHaveText('150.7k / 1050k');
  await expect(page.getByTestId('context-usage-percent')).toHaveText('14%');
  await expect(page.getByTestId('context-panel')).not.toContainText('0 of 0');
});

test('1566:inspector-usage-panel-and-context-gauge:2 refresh forces a second request', async ({ page }) => {
  const seen = await open(page);
  await expect.poll(() => seen.filter(request => request.pathname === '/agents/usage-budget').length).toBe(1);
  await page.getByRole('button', { name: 'Refresh usage budget' }).click();
  await expect.poll(() => seen.filter(request => request.pathname === '/agents/usage-budget').map(request => request.search)).toEqual(['', '?force=true']);
});

test('1566:inspector-usage-panel-and-context-gauge:3 budget failure is section-local and retryable', async ({ page }) => {
  await open(page, { failBudget: true });
  const panel = page.getByTestId('usage-budget-panel');
  await expect(panel.getByRole('alert')).toContainText('Usage budget unavailable');
  await expect(panel.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByTestId('context-usage-value')).toHaveText('150.7k / 1050k');
  await expect(page.getByRole('heading', { name: 'Memory provenance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Run feedback' })).toBeVisible();
});

test('1566:inspector-usage-panel-and-context-gauge:4 fallback budget and empty usage are honest', async ({ page }) => {
  await open(page, { contextLimit: 0 });
  await expect(page.getByTestId('context-usage-value')).toHaveText('150.7k / 200k');
  await page.unrouteAll({ behavior: 'wait' });
  await open(page, { usageMessages: [{ ...messages[1] }] });
  const emptyGauge = page.getByTestId('context-usage-empty');
  await expect(emptyGauge).toContainText('No persisted context usage yet');
  await expect(emptyGauge).not.toContainText('0%');
  await expect(page.getByTestId('context-usage-percent')).toHaveCount(0);
});

test('1566:inspector-usage-panel-and-context-gauge:5 fixture mode preserves its seeded gauge', async ({ page }) => {
  await openFixture(page);
  await expect(page.locator('.token-gauge')).toBeVisible();
  await expect(page.locator('.token-gauge')).not.toContainText('No persisted context usage yet');
});
