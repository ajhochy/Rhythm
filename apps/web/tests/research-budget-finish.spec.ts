import { expect, test } from '@playwright/test';
import { fulfillJson, matching, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

// Regression: a 1,000-token / 60 s hard-coded budget exhausted every real run, which then had no
// synthesis, so Magazine/Export/Discussion all failed with a bare "failed (409)".
const project = {
  id: 'research-budget-project', ownerUserId: 1, name: 'Fantasy Football Week 4', question: 'Who should I add?',
  goals: ['Preserve evidence'], domain: 'Fantasy Football', profileId: 'research',
  passConfig: [{ role: 'evidence', profileId: 'research' }], modelPolicy: {},
  criticConfig: { enabled: true }, synthesisConfig: { enabled: true }, scheduleRef: null,
  budget: { maxPasses: 1, maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 60_000 },
  archivedAt: null, createdAt: '2026-09-28T19:47:00.000Z', updatedAt: '2026-09-28T19:47:00.000Z',
};
const exhaustedRun = {
  id: 'research-budget-run', projectId: project.id, ownerUserId: 1, triggerType: 'manual',
  configSnapshot: project, status: 'budget_exhausted',
  progress: { stages: [{ id: 'evidence-1', role: 'evidence', status: 'done', report: 'Evidence pass completed and registered.' }] },
  diagnostics: { budgetExhausted: true, reasons: ['tokens', 'wall_clock'] },
  startedAt: '2026-09-28T19:47:14.535Z', completedAt: '2026-09-28T19:51:34.573Z', createdAt: '2026-09-28T19:47:14.531Z',
  canonicalArtifact: null, artifacts: [], sources: [], usage: { tokens: 1_404_500, costUsd: 0 },
};
const finishedRun = {
  ...exhaustedRun, status: 'degraded',
  progress: { stages: [...exhaustedRun.progress.stages, { id: 'synthesis-1', role: 'synthesis', status: 'done', report: '# Final' }] },
  diagnostics: { budgetExhausted: true, reasons: ['tokens', 'wall_clock'], finishedWithCurrentEvidence: true, degraded: true },
  sources: [{ id: 'source-1', canonical_url: 'https://www.nfl.com/news/week-4-waiver-wire' }],
};

test('create dialog submits the editable budget in human units', async ({ page }) => {
  const seen: SeenRequest[] = [];
  await openPhase7Live(page, '/tools/deep-research', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-research/projects') {
      await fulfillJson(route, request.method() === 'POST' ? 201 : 200, request.method() === 'POST' ? project : []);
      return true;
    }
    if (url.pathname.endsWith('/runs')) return fulfillJson(route, 200, []).then(() => true);
    return false;
  });
  await page.getByTestId('research-new-project').click();
  const dialog = page.getByTestId('research-project-dialog');
  await dialog.getByLabel('Project name').fill('Week 4');
  await dialog.getByLabel('Research question').fill('Who should I add?');
  await expect(dialog.getByLabel('Token limit (millions)')).toHaveValue('5');
  await expect(dialog.getByLabel('Time limit (minutes)')).toHaveValue('30');
  await dialog.getByLabel('Max passes').fill('2');
  await dialog.getByLabel('Token limit (millions)').fill('8');
  await dialog.getByLabel('Cost limit ($)').fill('7.5');
  await dialog.getByLabel('Time limit (minutes)').fill('45');
  await page.getByTestId('research-project-create').click();
  await expect.poll(() => matching(seen, 'POST', '/agent-research/projects')[0]?.body).toMatchObject({
    budget: { maxPasses: 2, maxTokens: 8_000_000, maxCostUsd: 7.5, maxWallClockMs: 2_700_000 },
  });
});

test('budget-exhausted run explains the missing report, edits the budget, and finishes with current evidence', async ({ page }) => {
  const seen: SeenRequest[] = [];
  let current: Record<string, unknown> = exhaustedRun;
  let currentProject: Record<string, unknown> = project;
  await openPhase7Live(page, '/tools/deep-research', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-research/projects') return fulfillJson(route, 200, [currentProject]).then(() => true);
    if (url.pathname === `/agent-research/projects/${project.id}` && request.method() === 'PATCH') {
      currentProject = { ...project, budget: request.postDataJSON().budget };
      return fulfillJson(route, 200, currentProject).then(() => true);
    }
    if (url.pathname === `/agent-research/projects/${project.id}/runs`) return fulfillJson(route, 200, [current]).then(() => true);
    if (url.pathname === `/agent-research/projects/${project.id}/runs/${exhaustedRun.id}`) return fulfillJson(route, 200, current).then(() => true);
    if (url.pathname.endsWith('/finish')) {
      current = finishedRun;
      return fulfillJson(route, 200, finishedRun).then(() => true);
    }
    return false;
  });

  await expect(page.getByTestId('research-report-unavailable')).toContainText('stopped before its final report (budget exhausted)');
  await expect(page.getByTestId('research-budget-exhausted')).toContainText('tokens, wall clock');
  for (const id of ['research-magazine', 'research-export', 'research-discuss']) {
    await expect(page.getByTestId(id)).toBeDisabled();
    await expect(page.getByTestId(id)).toHaveAttribute('aria-describedby', 'research-report-unavailable');
  }
  await expect(page.getByText('raise it first if you want to start a discussion')).toBeVisible();

  await page.getByTestId('research-edit-budget').click();
  const dialog = page.getByTestId('research-budget-dialog');
  await expect(dialog.getByLabel('Token limit (millions)')).toHaveValue('0.001');
  await dialog.getByLabel('Max passes').fill('3');
  await dialog.getByLabel('Token limit (millions)').fill('5');
  await dialog.getByLabel('Cost limit ($)').fill('5');
  await dialog.getByLabel('Time limit (minutes)').fill('30');
  await page.getByTestId('research-budget-save').click();
  await expect.poll(() => matching(seen, 'PATCH', `/agent-research/projects/${project.id}`)[0]?.body).toEqual({
    budget: { maxPasses: 3, maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 },
  });
  await expect(page.getByTestId('research-budget-summary')).toContainText('3 passes · 5M tokens · $5.00 · 30 min');

  await page.getByTestId('research-finish').click();
  await expect.poll(() => matching(seen, 'POST', `/agent-research/projects/${project.id}/runs/${exhaustedRun.id}/finish`).length).toBe(1);
  await expect(page.getByTestId('research-report-unavailable')).toHaveCount(0);
  await expect(page.getByTestId('research-magazine')).toBeEnabled();
  await expect(page.getByTestId('research-budget-exhausted')).toContainText('written from the evidence gathered so far');
  await expect(page.getByText('https://www.nfl.com/news/week-4-waiver-wire')).toBeVisible();
});

test('server 409 message replaces the bare status code', async ({ page }) => {
  const seen: SeenRequest[] = [];
  const stale = { ...finishedRun, status: 'complete', diagnostics: {} };
  await openPhase7Live(page, '/tools/deep-research', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-research/projects') return fulfillJson(route, 200, [project]).then(() => true);
    if (url.pathname === `/agent-research/projects/${project.id}/runs`) return fulfillJson(route, 200, [stale]).then(() => true);
    if (url.pathname === `/agent-research/projects/${project.id}/runs/${stale.id}`) return fulfillJson(route, 200, stale).then(() => true);
    if (url.pathname.endsWith('/discussions')) {
      return fulfillJson(route, 409, { error: { code: 'CONFLICT', message: 'This run used its whole token or cost budget. Raise the project budget.' } }).then(() => true);
    }
    return false;
  });
  await page.getByTestId('research-discuss').click();
  await expect(page.getByText('This run used its whole token or cost budget. Raise the project budget.')).toBeVisible();
  await expect(page.getByText(/failed \(409\)/)).toHaveCount(0);
});
