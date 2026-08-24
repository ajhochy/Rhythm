import { expect, test } from '@playwright/test';
import { createLiveOrgProposalsGateway } from '../../src/gateway/org-proposals';
import { createLiveRunOutcomesGateway } from '../../src/gateway/run-outcomes';
import { createLiveAutoPromotionGateway, AutoPromotionGatewayError } from '../../src/gateway/auto-promotion';

const localBase = 'http://127.0.0.1:4098';
const cloudBase = 'https://api.example.test';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('self-improvement-gateway-a1: org proposals use the local boundary, preserve deployment/outcome status, and fail closed for tool safety', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const gateway = createLiveOrgProposalsGateway(localBase, undefined, async (url, init) => {
    calls.push({ url: String(url), init });
    return json([{ id: 'tool-1', title: 'Install tool', kind: 'tool-install', risk: 'high', status: 'proposed', outcomeStatus: 'future-outcome', rationale: null, createdAt: null, updatedAt: undefined, changeJson: '{"hostile":true}', toolSafety: { state: 'ready', verdict: 'safe', tool: { name: 'safe-tool', packageSource: 'local-tarball:sha256:abc' }, forbiddenPathViolations: [], networkCalls: [], workspaceWriteCount: 0, credentialAccessAttemptsCount: 0, scenarioAttemptsCount: 2, sandboxDurationMs: 3, reason: null } }]);
  });

  const [proposal] = await gateway.list('sandbox vetted');
  expect(calls[0].url).toBe(`${localBase}/agent-org-proposals?status=sandbox%20vetted`);
  expect(new Headers(calls[0].init?.headers).has('Authorization')).toBe(false);
  expect(proposal.status).toBe('proposed');
  expect(proposal.outcomeStatus).toBe('future-outcome');
  expect(proposal.changeJson).toBeNull();
  expect(proposal.toolSafety).toMatchObject({ state: 'ready', verdict: 'safe', tool: { name: 'safe-tool' } });

  const malformed = await createLiveOrgProposalsGateway(localBase, undefined, async () => json([{ id: 'tool-2', kind: 'tool-install', status: 'proposed', toolSafety: { state: 'ready', verdict: 'safe', tool: { name: 42 } } }])).list('proposed');
  expect(malformed[0].toolSafety).toEqual({ state: 'malformed', verdict: 'unknown' });

  const unknown = await createLiveOrgProposalsGateway(localBase, undefined, async () => json([{ id: 'tool-3', kind: 'tool-install', status: 'proposed', changeJson: '{"raw":"never expose"}', toolSafety: { state: 'ready', verdict: 'unknown', tool: { name: 'uncertain-tool', packageSource: 'local-tarball:sha256:def' }, forbiddenPathViolations: [], networkCalls: [], workspaceWriteCount: 0, credentialAccessAttemptsCount: 0, scenarioAttemptsCount: 1, sandboxDurationMs: 2, reason: 'report incomplete' } }])).list('proposed');
  expect(unknown[0].toolSafety).toMatchObject({ state: 'ready', verdict: 'unknown' });
  expect(unknown[0].changeJson).toBeNull();
});

test('self-improvement-gateway-a2: tool-install approval only transmits the explicit conditional confirmation', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const gateway = createLiveOrgProposalsGateway(localBase, undefined, async (url, init) => {
    calls.push({ url: String(url), init });
    return json({ id: 'tool id', kind: 'tool-install', status: 'approved' });
  });
  await gateway.approve('tool id', true);
  expect(calls[0].url).toBe(`${localBase}/agent-org-proposals/tool%20id/approve`);
  expect(calls[0].init?.method).toBe('POST');
  expect(calls[0].init?.body).toBe(JSON.stringify({ toolSafetyConfirmation: 'approve-conditional-tool-install' }));

  await gateway.reject('tool id');
  await gateway.revert('tool id');
  expect(calls.slice(1).map((call) => [call.url, call.init?.method, call.init?.body])).toEqual([
    [`${localBase}/agent-org-proposals/tool%20id/reject`, 'POST', undefined],
    [`${localBase}/agent-org-proposals/tool%20id/revert`, 'POST', undefined],
  ]);
});

test('self-improvement-gateway-a3: run outcomes make 404 absent, omit blank reasons, and reject unsupported verdicts', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const gateway = createLiveRunOutcomesGateway(localBase, undefined, async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/missing')) return json({ error: 'not found' }, 404);
    return json({ explicitUserVerdict: 'partial' });
  });
  expect(await gateway.get('missing')).toBeNull();
  await gateway.feedback('run 1', 'success', '  ');
  expect(calls[1].url).toBe(`${localBase}/agent-run-outcomes/run%201/feedback`);
  expect(calls[1].init?.body).toBe(JSON.stringify({ verdict: 'success' }));
  expect(() => gateway.feedback('run', 'inconclusive' as never)).toThrow(/success/i);
});

test('self-improvement-gateway-a4: auto-promotion uses the cloud token and confirmation header and rejects malformed state', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const gateway = createLiveAutoPromotionGateway(cloudBase, 'cloud-token', async (url, init) => {
    calls.push({ url: String(url), init });
    return json({ availability: true, state: { autoPromotionEnabled: false, enabledAt: null, autoPromotionEligible: true, totalVerified: 3, totalRegressions: 0, trustThreshold: 5 } });
  });
  await gateway.get();
  await gateway.setEnabled(true);
  expect(calls[0].url).toBe(`${cloudBase}/optimizer/auto-promotion`);
  expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer cloud-token');
  expect(new Headers(calls[0].init?.headers).get('X-Rhythm-Auto-Promotion-Confirmation')).toBeNull();
  expect(new Headers(calls[1].init?.headers).get('X-Rhythm-Auto-Promotion-Confirmation')).toBe('enable-auto-promotion');
  expect(calls[1].init?.body).toBe(JSON.stringify({ enabled: true }));

  const malformed = createLiveAutoPromotionGateway(cloudBase, 'cloud-token', async () => json({ availability: true, state: { autoPromotionEnabled: 'yes' } }));
  await expect(malformed.get()).rejects.toThrow(/malformed/i);
  const malformedCounters = createLiveAutoPromotionGateway(cloudBase, 'cloud-token', async () => json({ availability: true, state: { autoPromotionEnabled: false, enabledAt: null, autoPromotionEligible: false, totalVerified: -1, totalRegressions: 0.5, trustThreshold: 5 } }));
  await expect(malformedCounters.get()).rejects.toThrow(/malformed/i);
  const denied = createLiveAutoPromotionGateway(cloudBase, 'cloud-token', async () => json({}, 403));
  await expect(denied.get()).rejects.toBeInstanceOf(AutoPromotionGatewayError);
});
