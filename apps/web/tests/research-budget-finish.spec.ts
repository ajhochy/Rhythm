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
  await expect(dialog.getByLabel('Token limit, in millions')).toHaveValue('5');
  await expect(dialog.getByLabel('Time limit, in minutes')).toHaveValue('30');
  await dialog.getByLabel('Researchers (passes)').fill('2');
  await dialog.getByLabel('Token limit, in millions').fill('8');
  await dialog.getByLabel('Spending limit, in dollars').fill('7.5');
  await dialog.getByLabel('Time limit, in minutes').fill('45');
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
  await expect(dialog.getByLabel('Token limit, in millions')).toHaveValue('0.001');
  await dialog.getByLabel('Researchers (passes)').fill('3');
  await dialog.getByLabel('Token limit, in millions').fill('5');
  await dialog.getByLabel('Spending limit, in dollars').fill('5');
  await dialog.getByLabel('Time limit, in minutes').fill('30');
  await page.getByTestId('research-budget-save').click();
  await expect.poll(() => matching(seen, 'PATCH', `/agent-research/projects/${project.id}`)[0]?.body).toEqual({
    budget: { maxPasses: 3, maxTokens: 5_000_000, maxCostUsd: 5, maxWallClockMs: 1_800_000 },
  });
  await expect(page.getByTestId('research-budget-summary')).toContainText('Up to 3 passes · 5M tokens · $5 · 30 min');

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

const CATALOG = [
  ['anthropic', 'claude-opus-4-5-20251101', 'Claude Opus 4.5'], ['anthropic', 'claude-opus-5-5', 'Claude Opus 5.5'],
  ['anthropic', 'claude-haiku-4-5', 'Claude Haiku 4.5'], ['openai', 'gpt-5.6-sol', 'GPT-5.6 Sol'], ['openai', 'gpt-5.6-luna', 'GPT-5.6 Luna'],
].map(([provider, modelId, displayName]) => ({ agent: 'opencode', provider, modelId, displayName, route: 'direct', authorized: true, available: true, visible: true, availabilityReason: 'ok', authProvider: provider }));

test('run history keeps earlier runs reachable: selecting an exhausted run shows Finish for that run', async ({ page }) => {
  const seen: SeenRequest[] = [];
  const running = { ...exhaustedRun, id: 'research-newer-run', status: 'running', diagnostics: {}, completedAt: null,
    startedAt: '2026-09-28T21:53:48.235Z', createdAt: '2026-09-28T21:53:48.233Z', usage: { tokens: 1_021_897, costUsd: 0 },
    progress: { stages: [{ id: 'evidence-2', role: 'evidence', status: 'gathering' }] } };
  let older: Record<string, unknown> = exhaustedRun;
  await openPhase7Live(page, '/tools/deep-research', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agent-research/projects') return fulfillJson(route, 200, [project]).then(() => true);
    if (url.pathname === `/agent-research/projects/${project.id}/runs`) return fulfillJson(route, 200, [running, older]).then(() => true);
    if (url.pathname === `/agent-research/projects/${project.id}/runs/${running.id}`) return fulfillJson(route, 200, running).then(() => true);
    if (url.pathname === `/agent-research/projects/${project.id}/runs/${exhaustedRun.id}`) return fulfillJson(route, 200, older).then(() => true);
    if (url.pathname.endsWith(`/runs/${exhaustedRun.id}/finish`)) { older = { ...finishedRun, status: 'running' }; return fulfillJson(route, 202, older).then(() => true); }
    return false;
  });
  const history = page.getByTestId('research-run-history');
  await expect(history.getByRole('button')).toHaveCount(2);
  await expect(page.getByTestId(`research-run-${running.id}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`research-run-${running.id}`)).toContainText('running');
  await expect(page.getByTestId(`research-run-${exhaustedRun.id}`)).toContainText('budget exhausted');
  await expect(page.getByTestId(`research-run-${exhaustedRun.id}`)).toContainText('1.4M tokens');
  await expect(page.getByTestId(`research-run-${exhaustedRun.id}`)).toContainText('0 sources');
  await expect(page.getByTestId('research-finish')).toHaveCount(0);
  await expect(page.getByTestId('research-cancel')).toBeVisible();

  await page.getByTestId(`research-run-${exhaustedRun.id}`).click();
  await expect(page.getByRole('heading', { name: `Run ${exhaustedRun.id}` })).toBeVisible();
  await page.getByTestId('research-finish').click();
  await expect.poll(() => matching(seen, 'POST', `/agent-research/projects/${project.id}/runs/${exhaustedRun.id}/finish`).length).toBe(1);
  expect(matching(seen, 'POST', `/agent-research/projects/${project.id}/runs/${running.id}/finish`)).toHaveLength(0);
  await expect(page.getByTestId(`research-run-${exhaustedRun.id}`)).toContainText('running');
  // An in-progress run keeps the history fresh.
  await expect.poll(() => matching(seen, 'GET', `/agent-research/projects/${project.id}/runs`).length, { timeout: 8_000 }).toBeGreaterThan(1);
});

test('budget editor presets fill plain-unit fields; editing a field switches to Custom', async ({ page }) => {
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
  await expect(dialog.getByTestId('research-budget-preset-standard')).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('Tokens count cached context on every turn; a pass typically uses 1–2M.')).toBeVisible();
  await dialog.getByTestId('research-budget-preset-deep').click();
  await expect(dialog.getByLabel('Researchers (passes)')).toHaveValue('6');
  await expect(dialog.getByLabel('Token limit, in millions')).toHaveValue('15');
  await expect(dialog.getByLabel('Spending limit, in dollars')).toHaveValue('15');
  await expect(dialog.getByLabel('Time limit, in minutes')).toHaveValue('90');
  await dialog.getByTestId('research-budget-preset-quick').click();
  await expect(dialog.getByLabel('Researchers (passes)')).toHaveValue('1');
  await dialog.getByLabel('Time limit, in minutes').fill('20');
  await expect(dialog.getByTestId('research-budget-preset-custom')).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByTestId('research-budget-preset-quick')).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByLabel('Project name').fill('Week 4');
  await dialog.getByLabel('Research question').fill('Who should I add?');
  await page.getByTestId('research-project-create').click();
  await expect.poll(() => matching(seen, 'POST', '/agent-research/projects')[0]?.body).toMatchObject({
    budget: { maxPasses: 1, maxTokens: 2_000_000, maxCostUsd: 2, maxWallClockMs: 1_200_000 },
  });
});

test('lead and researcher pickers default from the live catalog, submit a modelPolicy, and label run stages', async ({ page }) => {
  const seen: SeenRequest[] = [];
  const splitProject = { ...project, modelPolicy: { lead: { providerId: 'anthropic', modelId: 'claude-opus-5-5' }, researcher: { providerId: 'openai', modelId: 'gpt-5.6-luna' } } };
  const splitRun = { ...finishedRun, id: 'split-run', status: 'complete', diagnostics: {}, configSnapshot: splitProject, progress: { stages: [
    { id: 'plan', role: 'plan', ordinal: 999, status: 'done', model: 'anthropic/claude-opus-5-5', tokens: 12_000 },
    { id: 'r1', role: 'evidence', ordinal: 0, status: 'done', model: 'openai/gpt-5.6-luna', angle: 'Analyst rankings', tokens: 900_000 },
    { id: 's', role: 'synthesis', ordinal: 1001, status: 'done', model: 'anthropic/claude-opus-5-5', tokens: 300_000, report: '# Final' },
  ] } };
  let projects: unknown[] = [];
  await openPhase7Live(page, '/tools/deep-research', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/agents/models/catalog') return fulfillJson(route, 200, CATALOG).then(() => true);
    if (url.pathname === '/agent-research/projects') {
      if (request.method() === 'POST') projects = [splitProject];
      await fulfillJson(route, request.method() === 'POST' ? 201 : 200, request.method() === 'POST' ? splitProject : projects);
      return true;
    }
    if (url.pathname === `/agent-research/projects/${project.id}/runs`) return fulfillJson(route, 200, [splitRun]).then(() => true);
    if (url.pathname === `/agent-research/projects/${project.id}/runs/${splitRun.id}`) return fulfillJson(route, 200, splitRun).then(() => true);
    return false;
  });
  await page.getByTestId('research-new-project').click();
  const dialog = page.getByTestId('research-project-dialog');
  await expect(dialog.getByTestId('research-lead-model')).toHaveValue('anthropic/claude-opus-5-5');
  await expect(dialog.getByTestId('research-researcher-model')).toHaveValue('anthropic/claude-haiku-4-5');
  await dialog.getByTestId('research-researcher-model').selectOption('openai/gpt-5.6-luna');
  await dialog.getByLabel('Project name').fill('Week 4');
  await dialog.getByLabel('Research question').fill('Who should I add?');
  await page.getByTestId('research-project-create').click();
  await expect.poll(() => matching(seen, 'POST', '/agent-research/projects')[0]?.body).toMatchObject({ modelPolicy: splitProject.modelPolicy });

  await expect(page.getByTestId('research-model-summary')).toHaveText('Lead: Claude Opus 5.5 · Researchers: GPT-5.6 Luna');
  const stages = page.getByTestId('research-stages');
  await expect(stages.getByTestId('research-stage-plan')).toContainText('Claude Opus 5.5');
  await expect(stages.getByTestId('research-stage-evidence')).toContainText('Researcher 1');
  await expect(stages.getByTestId('research-stage-evidence')).toContainText('Analyst rankings');
  await expect(stages.getByTestId('research-stage-evidence')).toContainText('GPT-5.6 Luna');
  await expect(stages.getByTestId('research-stage-evidence')).toContainText('900,000');
  await expect(stages.getByTestId('research-stage-synthesis')).toContainText('Final report');

  await page.getByTestId('research-edit-budget').click();
  const settings = page.getByTestId('research-budget-dialog');
  await expect(settings.getByTestId('research-researcher-model')).toHaveValue('openai/gpt-5.6-luna');
  await settings.getByTestId('research-lead-model').selectOption('openai/gpt-5.6-sol');
  await settings.getByTestId('research-budget-preset-standard').click();
  await page.getByTestId('research-budget-save').click();
  await expect.poll(() => matching(seen, 'PATCH', `/agent-research/projects/${project.id}`)[0]?.body).toMatchObject({
    modelPolicy: { lead: { providerId: 'openai', modelId: 'gpt-5.6-sol' }, researcher: { providerId: 'openai', modelId: 'gpt-5.6-luna' } },
  });
});
