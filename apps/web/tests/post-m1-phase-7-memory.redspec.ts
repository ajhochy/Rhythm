import { expect, test } from '@playwright/test';
import { fulfillJson, matching, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

const memory = {
  id: 'memory-canonical-7',
  kind: 'context',
  content: 'Phase 7 canonical memory canary',
  source: 'obsidian-memory',
  sourceId: 'context/phase-7-canary.md',
  tagsJson: '["phase-7"]',
  status: 'stable',
  staleAfter: null,
  verifiedJson: '[{"by":"human:phase-7","at":"2026-08-15T12:00:00.000Z"}]',
  sourcesJson: '[{"id":"source-7","title":"Phase 7 source"}]',
  generatedBy: 'agent:research/7',
  generatedAt: '2026-08-15T11:00:00.000Z',
  trustTier: 'human',
  autoInjectable: true,
  ownerUserId: 7,
  createdAt: '2026-08-15T11:00:00.000Z',
  updatedAt: '2026-08-15T12:00:00.000Z',
  lifecycleState: 'active',
  unverifiable: false,
};

test('post-m1-p7-c1a: live memory list and search round-trip the canonical persisted row', async ({ page }) => {
  // Regression caught: ToolWorkspace only changes its request trace and never calls the memory API.
  const seen: SeenRequest[] = [];
  await openPhase7Live(page, '/tools/brain', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-memory' || url.pathname === '/agent-memory/search') {
      await fulfillJson(route, 200, [memory]);
      return true;
    }
    return false;
  });

  await page.getByTestId('brain-refresh').click();
  await page.getByTestId('brain-search').fill('canary');

  await expect.poll(() => matching(seen, 'GET', '/agent-memory').length).toBeGreaterThan(0);
  await expect.poll(() => matching(seen, 'GET', '/agent-memory/search').length).toBeGreaterThan(0);
  await expect(page.getByText(memory.content)).toBeVisible();
});

test('post-m1-p7-c1b: live memory renders canonical provenance verification lifecycle and trust fields', async ({ page }) => {
  // Regression caught: the reduced fixture substitutes trust=verified/reviewed and drops provenance.
  const seen: SeenRequest[] = [];
  await openPhase7Live(page, '/tools/brain', seen, async (route, request) => {
    if (new URL(request.url()).pathname === '/agent-memory') {
      await fulfillJson(route, 200, [memory]);
      return true;
    }
    return false;
  });

  await expect.poll(() => matching(seen, 'GET', '/agent-memory').length).toBeGreaterThan(0);
  await expect(page.getByText('active', { exact: true })).toBeVisible();
  await expect(page.getByText('human', { exact: true })).toBeVisible();
  await expect(page.getByText('Phase 7 source')).toBeVisible();
  await expect(page.getByText(/human:phase-7/)).toBeVisible();
  await expect(page.getByText(/verified|reviewed/, { exact: true })).toHaveCount(0);
});

test('post-m1-p7-c1c: kind chips with counts, deprecated toggle, and load more page the live list', async ({ page }) => {
  // Regression caught: rebuild-time created_at let 30 deprecated daily summaries fill the only page.
  const rows = [
    ...Array.from({ length: 60 }, (_, i) => ({ ...memory, id: `fact-${i}`, kind: 'fact', content: `Fact number ${i}` })),
    { ...memory, id: 'pref-0', kind: 'preference', content: 'Preference canary' },
    { ...memory, id: 'syn-0', kind: 'synthesis', status: 'deprecated', lifecycleState: 'deprecated', content: 'Deprecated summary canary' },
  ];
  const seen: SeenRequest[] = [];
  await openPhase7Live(page, '/tools/brain', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname !== '/agent-memory') return false;
    const q = url.searchParams;
    const base = rows.filter((row) => q.get('includeDeprecated') === 'true' || row.status !== 'deprecated');
    const counts: Record<string, number> = {};
    for (const row of base) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    const filtered = base.filter((row) => !q.get('kind') || row.kind === q.get('kind'));
    const offset = Number(q.get('offset') ?? 0);
    const limit = Number(q.get('limit') ?? 50);
    await fulfillJson(route, 200, { items: filtered.slice(offset, offset + limit), counts, total: filtered.length });
    return true;
  });

  const list = page.getByRole('listbox', { name: 'Memories' });
  await expect(list.getByRole('option')).toHaveCount(50);
  await expect(page.getByTestId('brain-kind-all')).toContainText('61');
  await expect(page.getByTestId('brain-kind-fact')).toContainText('60');
  await expect(page.getByTestId('brain-kind-synthesis')).toContainText('0');
  await expect(page.getByText('Deprecated summary canary')).toHaveCount(0);

  await page.getByTestId('brain-load-more').click();
  await expect(list.getByRole('option')).toHaveCount(61);
  await expect(page.getByTestId('brain-load-more')).toHaveCount(0);
  expect(matching(seen, 'GET', '/agent-memory').some((r) => r.search.includes('offset=50'))).toBe(true);

  await page.getByTestId('brain-kind-preference').click();
  await expect(page.getByTestId('brain-kind-preference')).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByText('Preference canary')).toBeVisible();

  await page.getByTestId('brain-kind-synthesis').click();
  await expect(list.getByRole('option')).toHaveCount(0);
  await page.getByTestId('brain-show-deprecated').click();
  await expect(page.getByTestId('brain-show-deprecated')).toBeChecked();
  await expect(list.getByText('Deprecated summary canary')).toBeVisible();
  await expect(page.getByTestId('brain-kind-synthesis')).toContainText('1');
  expect(matching(seen, 'GET', '/agent-memory').some((r) => r.search.includes('includeDeprecated=true') && r.search.includes('kind=synthesis'))).toBe(true);
});
