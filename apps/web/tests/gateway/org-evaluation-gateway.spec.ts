import { expect, test } from '@playwright/test';
import { createLiveOrgProposalsGateway, OrgProposalsGatewayError } from '../../src/gateway/org-proposals';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const base = 'http://127.0.0.1:4098';

test('evaluation gateway uses the local API and preserves settings writes and exact approval proof', async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const gateway = createLiveOrgProposalsGateway(base, undefined, async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).endsWith('/evaluations/settings')) return json({ tokenLimit: 120_000, candidateCount: 3 });
    if (String(url).endsWith('/evaluations')) return json({ jobs: [] });
    return json({ id: 'proposal', kind: 'refine-skill', status: 'approved' });
  });
  expect(await gateway.getEvaluationSettings()).toEqual({ tokenLimit: 120_000, candidateCount: 3 });
  expect(await gateway.updateEvaluationSettings({ tokenLimit: 120_000, candidateCount: 3 }))
    .toEqual({ tokenLimit: 120_000, candidateCount: 3 });
  expect(await gateway.listEvaluations()).toEqual({ jobs: [] });
  await gateway.approve('proposal', false, { expectedEvaluationId: 'evaluation', finalCandidateHash: 'b'.repeat(64), originalHash: 'a'.repeat(64) });
  expect(requests).toEqual([
    { url: `${base}/agent-org-proposals/evaluations/settings`, method: 'GET', body: null },
    { url: `${base}/agent-org-proposals/evaluations/settings`, method: 'PATCH', body: { tokenLimit: 120_000, candidateCount: 3 } },
    { url: `${base}/agent-org-proposals/evaluations`, method: 'GET', body: null },
    { url: `${base}/agent-org-proposals/proposal/approve`, method: 'POST', body: { expectedEvaluationId: 'evaluation', finalCandidateHash: 'b'.repeat(64), originalHash: 'a'.repeat(64) } },
  ]);
});

test('evaluated queue rows fail closed when provenance or evaluation response is incomplete', async () => {
  const gateway = createLiveOrgProposalsGateway(base, undefined, async url => {
    if (String(url).includes('?status=')) return json([{ id: 'bad', kind: 'refine-skill', status: 'proposed', source: 'org-reviewer-evaluated', preReviewEvaluation: { evaluationId: 'job', originalHash: 'a'.repeat(64), finalCandidateHash: 'short', status: 'qualified' } }]);
    if (String(url).endsWith('/evaluations')) return json({ jobs: [{}] });
    return json({ tokenLimit: -1, candidateCount: 5 });
  });
  const [proposal] = await gateway.list('proposed');
  expect(proposal.evaluationProofInvalid).toBe(true);
  expect(proposal.preReviewEvaluation).toBeNull();
  await expect(gateway.getEvaluationSettings()).rejects.toBeInstanceOf(OrgProposalsGatewayError);
  await expect(gateway.listEvaluations()).rejects.toBeInstanceOf(OrgProposalsGatewayError);
});
