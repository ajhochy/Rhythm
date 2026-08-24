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
