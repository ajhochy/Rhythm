import { expect, test } from '@playwright/test';
import { fulfillJson, matching, openPhase7Live, type SeenRequest } from './post-m1-phase-7-live-harness';

test('post-m1-p7-c4d: pending approval card signs an exact approved/rejected decision and focuses its owned session', async ({ page }) => {
  // Regression caught: the bell opens a fixture permission demo with no approval read, signature, or decision request.
  const seen: SeenRequest[] = [];
  const approval = {
    id: 'approval-7', sessionId: 'session-owned-7', agentConfigId: 'research', action: 'send_external',
    preview: 'Send the prepared message', consequence: 'The recipient receives the message', status: 'pending',
    actor: null, decidedAt: null, securityAction: 'external_send', payloadDigest: 'digest-7', taintId: null,
    taintedTurnId: null, boundAgent: 'research', expiresAt: null, consumedAt: null,
    decisionNonce: 'nonce-7', createdAt: '2026-08-15T10:00:00.000Z',
  };
  await openPhase7Live(page, '/agents', seen, async (route, request) => {
    const url = new URL(request.url());
    if (url.pathname === '/notifications') return fulfillJson(route, 200, []).then(() => true);
    if (url.pathname === '/agent-approvals') return fulfillJson(route, 200, [approval]).then(() => true);
    if (url.pathname === `/agent-approvals/${approval.id}`) return fulfillJson(route, 200, { ...approval, status: 'approved', decisionNonce: null }).then(() => true);
    if (url.pathname === `/agent-sessions/${approval.sessionId}`) return fulfillJson(route, 200, { id: approval.sessionId, ownerUserId: 7, status: 'idle' }).then(() => true);
    return false;
  });

  await expect.poll(() => matching(seen, 'GET', '/agent-approvals').length).toBeGreaterThan(0);
  await page.getByTestId('notifications-button').click();
  await expect(page.getByText(approval.preview)).toBeVisible();
  await expect(page.getByText(approval.consequence)).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(() => matching(seen, 'PATCH', `/agent-approvals/${approval.id}`)[0]?.body).toMatchObject({
    status: 'approved',
    signature: expect.any(String),
  });
  const decision = matching(seen, 'PATCH', `/agent-approvals/${approval.id}`)[0]?.body as Record<string, unknown>;
  expect(String(decision.signature)).not.toContain(approval.decisionNonce);
  expect(String(decision.signature)).not.toContain(approval.payloadDigest);
  await expect.poll(() => matching(seen, 'GET', `/agent-sessions/${approval.sessionId}`).length).toBe(1);
});
