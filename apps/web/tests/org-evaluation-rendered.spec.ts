import { expect, test, type Page, type Route } from '@playwright/test';

const apiBase = 'http://127.0.0.1:4098';
const settingsPath = '/agent-org-proposals/evaluations/settings';
const jobsPath = '/agent-org-proposals/evaluations';
const hash = (character: string) => character.repeat(64);
const originalHash = hash('a');
const finalHash = hash('b');
const evaluated = {
  id: 'rendered-proposal', title: 'Repair review instructions', kind: 'refine-skill', risk: 'low',
  status: 'proposed', outcomeStatus: 'unmeasured', rationale: 'Candidate passed held-out checks.',
  createdAt: null, updatedAt: null, changeJson: '{}', experimentSummary: null, source: 'org-reviewer-evaluated',
  preReviewEvaluation: { evaluationId: 'rendered-qualified', originalHash, finalCandidateHash: finalHash, status: 'qualified' },
};
const job = (id: string, status: string, failureReason: string | null = null,
  budgetRootId: string | null = 'cycle-root', targetRef = 'agent_config:review-agent-org-health') => ({
  id, budgetRootId, sourceAuditRunId: null, ownerUserId: 1, status, maxTokens: 100_000,
  validationReserveTokens: 20_000, originalHash, targetRef,
  targetRevision: '7', inputJson: '{}', finalCandidateId: status === 'qualified' && !targetRef.startsWith('org-review-cycle:') ? 'final-1' : null,
  qualifiedProposalId: status === 'qualified' && !targetRef.startsWith('org-review-cycle:') ? evaluated.id : null, failureReason, revision: 3,
  createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:01:00.000Z',
});
const candidates = [
  { id: 'original-1', role: 'original', ordinal: 0, configHash: originalHash },
  { id: 'variant-1', role: 'variant', ordinal: 1, configHash: hash('c') },
  { id: 'variant-2', role: 'variant', ordinal: 2, configHash: hash('d') },
  { id: 'composition-1', role: 'composition', ordinal: 10, configHash: finalHash,
    compositionParts: [
      { sourceCandidateId: 'variant-1', changePath: 'systemPrompt.heading', retained: true,
        reason: 'Corrected the observed heading', evidenceResultIds: ['variant-probe-pass'] },
      { sourceCandidateId: 'variant-2', changePath: 'permissions.bash', retained: false,
        reason: 'Removed an unnecessary permission change', evidenceResultIds: ['variant-probe-fail'] },
    ] },
  { id: 'final-1', role: 'final', ordinal: 0, configHash: finalHash },
];
const results = [
  { id: 'variant-probe-pass', candidateId: 'variant-1', phase: 'probe', status: 'pass', score: 0.9, taskKey: 'heading-probe', receiptHash: hash('1'), receiptJson: '{"observed":"correct heading"}', tokenUsage: { totalTokens: 500, inputTokens: 400, outputTokens: 100, cacheReadTokens: 0, reasoningTokens: 0 } },
  { id: 'variant-probe-fail', candidateId: 'variant-2', phase: 'probe', status: 'fail', score: 0.2, taskKey: 'permission-probe', receiptHash: hash('2'), receiptJson: '{"observed":"permission widened"}', tokenUsage: { totalTokens: 500, inputTokens: 400, outputTokens: 100, cacheReadTokens: 0, reasoningTokens: 0 } },
  { id: 'base-result', candidateId: 'original-1', phase: 'validation', status: 'fail', score: 0, taskKey: 'heldout-1', receiptHash: hash('e'), receiptJson: '{"observed":"wrong heading"}', tokenUsage: { totalTokens: 800, inputTokens: 600, outputTokens: 200, cacheReadTokens: 0, reasoningTokens: 0 } },
  { id: 'final-result', candidateId: 'final-1', phase: 'validation', status: 'pass', score: 1, taskKey: 'heldout-1', receiptHash: hash('f'), receiptJson: '{"observed":"correct heading"}', tokenUsage: { totalTokens: 900, inputTokens: 650, outputTokens: 250, cacheReadTokens: 0, reasoningTokens: 0 } },
];
const budget = { maxTokens: 100_000, validationReserveTokens: 20_000, settledTokens: 3_200,
  outstandingTokens: 0, explorationAvailableTokens: 76_800, totalAvailableTokens: 96_800,
  hasUnknownUsage: false };

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function install(page: Page, options: { jobs?: ReturnType<typeof job>[]; proposals?: unknown[] } = {}) {
  let settings = { tokenLimit: 100_000, candidateCount: 2, lookbackDays: 7 };
  const patches: unknown[] = [];
  const approvals: unknown[] = [];
  const jobs = options.jobs ?? [];
  await page.route('http://127.0.0.1:4097/**', route => fulfill(route, { healthy: true }));
  const handler = async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === '/health' || pathname === '/global/health') return fulfill(route, { healthy: true });
    if (pathname === '/auth/me') return fulfill(route, { user: { id: 1, name: 'Evaluation fixture', email: 'evaluation@example.invalid', role: 'admin' } });
    if (pathname === settingsPath) {
      if (method === 'PATCH') { const input = route.request().postDataJSON(); patches.push(input); settings = input; }
      return fulfill(route, settings);
    }
    if (pathname === jobsPath) return fulfill(route, { jobs });
    const detailId = pathname.match(/^\/agent-org-proposals\/evaluations\/([^/]+)$/)?.[1];
    if (detailId) {
      const selected = jobs.find(item => item.id === detailId);
      const scan = selected?.budgetRootId === null && selected.targetRef.startsWith('org-review-cycle:');
      return fulfill(route, { job: selected, candidates: scan ? [] : candidates,
        results: scan ? [] : results, budget });
    }
    if (pathname === '/agent-org-proposals' && method === 'GET') return fulfill(route, options.proposals ?? []);
    if (pathname === `/agent-org-proposals/${evaluated.id}/approve` && method === 'POST') {
      approvals.push(route.request().postDataJSON());
      return fulfill(route, { ...evaluated, status: 'applied' });
    }
    if (pathname === '/notifications' || pathname === '/agent-approvals') return fulfill(route, []);
    return fulfill(route, []);
  };
  await page.route(`${apiBase}/**`, handler);
  await page.route('https://api.vcrcapps.com/**', handler);
  return { patches, approvals, getSettings: () => settings };
}

test('live Review Queue configures a whole-run cap and candidate count, then reloads saved values', async ({ page }) => {
  const server = await install(page);
  await page.goto('/#/tools/review');
  const panel = page.getByRole('region', { name: 'Evaluation settings' });
  await expect(panel.getByLabel('Whole-run token limit')).toHaveValue('100000');
  await expect(panel.getByLabel('Candidates per review')).toHaveValue('2');
  await expect(panel.getByLabel('Review lookback')).toHaveValue('7');
  await panel.getByLabel('Whole-run token limit').fill('120000');
  await panel.getByLabel('Candidates per review').selectOption('3');
  await panel.getByLabel('Review lookback').selectOption('14');
  await panel.getByRole('button', { name: 'Save evaluation settings' }).click();
  await expect.poll(() => server.patches).toEqual([{ tokenLimit: 120000, candidateCount: 3, lookbackDays: 14 }]);
  await page.reload();
  await expect(panel.getByLabel('Whole-run token limit')).toHaveValue('120000');
  await expect(panel.getByLabel('Candidates per review')).toHaveValue('3');
  await expect(panel.getByLabel('Review lookback')).toHaveValue('14');
  await expect(page.getByRole('region', { name: 'Evaluation activity' })).toContainText('No evaluations yet');
});

test('live Review Queue shows independent validation and sends only the exact tested version for approval', async ({ page }) => {
  const server = await install(page, { jobs: [job('rendered-qualified', 'qualified')], proposals: [evaluated] });
  await page.goto('/#/tools/review');
  const activity = page.getByRole('region', { name: 'Evaluation activity' });
  await activity.getByTestId('evaluation-rendered-qualified').click();
  const detail = page.getByTestId('evaluation-rendered-qualified-details');
  await expect(detail).toContainText('Original');
  await expect(detail).toContainText('Final validation');
  await expect(detail).toContainText('3,200');
  await expect(detail).toContainText('20,000');
  await expect(detail).toContainText('wrong heading');
  await expect(detail).toContainText('correct heading');
  await expect(detail.getByRole('region', { name: 'Composition decisions' })).toContainText('Kept systemPrompt.heading');
  await expect(detail.getByRole('region', { name: 'Composition decisions' })).toContainText('Rejected permissions.bash');
  await expect(detail).toContainText('score 0.9');
  await expect(detail).toContainText('score 0.2');
  await expect(detail.getByRole('button', { name: /^Approve$/ })).toHaveCount(0);
  await page.getByTestId(`proposal-approve-${evaluated.id}`).click();
  await page.getByTestId('proposal-confirm').click();
  await expect.poll(() => server.approvals).toEqual([{
    expectedEvaluationId: 'rendered-qualified', finalCandidateHash: finalHash, originalHash,
  }]);
});

test('inconclusive evaluation remains visible with its reason and never enters human approval', async ({ page }) => {
  await install(page, { jobs: [job('rendered-inconclusive', 'inconclusive', 'Unknown provider token usage')], proposals: [] });
  await page.goto('/#/tools/review');
  const activity = page.getByRole('region', { name: 'Evaluation activity' });
  await activity.getByTestId('evaluation-rendered-inconclusive').click();
  const detail = page.getByTestId('evaluation-rendered-inconclusive-details');
  await expect(detail).toContainText('Unknown provider token usage');
  await expect(detail.getByRole('button', { name: /^Approve$/ })).toHaveCount(0);
  await expect(page.getByTestId('proposal-approve-rendered-inconclusive')).toHaveCount(0);
});

test('evaluated proposal with incomplete version proof cannot be approved', async ({ page }) => {
  const malformed = { ...evaluated, id: 'rendered-malformed', preReviewEvaluation: { ...evaluated.preReviewEvaluation, finalCandidateHash: 'missing' } };
  await install(page, { proposals: [malformed] });
  await page.goto('/#/tools/review');
  const card = page.getByTestId('proposal-rendered-malformed-details');
  await expect(card).toContainText('Approval unavailable: evaluated version proof is incomplete.');
  await expect(page.getByTestId('proposal-approve-rendered-malformed')).toBeDisabled();
});

test('closed cycle reports child outcomes without claiming the whole cycle qualified', async ({ page }) => {
  await install(page, { jobs: [
    job('cycle-root', 'qualified', null, null, 'org-review-cycle:cycle-root'),
    job('target-passed', 'qualified'),
    job('target-inconclusive', 'inconclusive', 'No reliable provider usage'),
  ] });
  await page.goto('/#/tools/review');
  const activity = page.getByRole('region', { name: 'Evaluation activity' });
  const root = activity.getByTestId('evaluation-cycle-root');
  await expect(root).toContainText('Scan complete');
  await expect(root).toContainText('2 targets evaluated');
  await expect(root).toContainText('1 improvement qualified');
  await expect(root).toContainText('1 inconclusive');
  await expect(activity.getByTestId('evaluation-target-passed')).toContainText('Improvement qualified');
  await root.click();
  const detail = activity.getByTestId('evaluation-cycle-root-details');
  await expect(detail.getByRole('heading', { level: 4 })).toContainText('Scan complete');
  await expect(detail).toContainText('2 targets evaluated');
  await expect(detail).toContainText('1 improvement qualified');
  await expect(detail).toContainText('1 inconclusive');
  await expect(detail).toContainText('Not applicable to a scan');
});

test('completed root scan without a target reports no qualified improvement of its own', async ({ page }) => {
  await install(page, { jobs: [job('cycle-root', 'qualified', null, null, 'org-review-cycle:cycle-root')] });
  await page.goto('/#/tools/review');
  const activity = page.getByRole('region', { name: 'Evaluation activity' });
  const root = activity.getByTestId('evaluation-cycle-root');
  await expect(root).toContainText('Scan complete');
  await expect(root).toContainText('0 targets evaluated');
  await expect(root).toContainText('0 improvements qualified');
  await root.click();
  const detail = activity.getByTestId('evaluation-cycle-root-details');
  await expect(detail).toContainText('Review each target to see whether an improvement qualified');
  await expect(detail).toContainText('Not applicable to a scan');
});

test('qualified standalone target keeps its final version and improvement status', async ({ page }) => {
  await install(page, { jobs: [job('standalone-target', 'qualified', null, null)] });
  await page.goto('/#/tools/review');
  const activity = page.getByRole('region', { name: 'Evaluation activity' });
  const target = activity.getByTestId('evaluation-standalone-target');
  await expect(target).toContainText('Improvement qualified');
  await expect(target).not.toContainText('Scan complete');
  await expect(target).not.toContainText('targets evaluated');
  await target.click();
  const detail = activity.getByTestId('evaluation-standalone-target-details');
  await expect(detail.getByRole('heading', { level: 4 })).toContainText('Improvement qualified');
  await expect(detail).toContainText(finalHash);
  await expect(detail).not.toContainText('Not applicable to a scan');
});
