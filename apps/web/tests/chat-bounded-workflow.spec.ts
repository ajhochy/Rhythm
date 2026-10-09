import { expect, test } from '@playwright/test';
import { fulfillJson, openInterceptedLiveApp } from './post-m1-phase-5-live-fixtures';

const rootSession = 'phase-5-local-session';
const boundedApproval = {
  id: 'bounded-current', sessionId: rootSession, action: 'Start bounded Coding Workflow',
  preview: 'Sunday brief · Sunday service notes v7 · 12,000 soft tokens · 180 seconds per worker · 600 seconds expiry',
  consequence: 'One workflow manager and reviewer; exact two checked criteria.', status: 'pending',
  actor: null, decidedAt: null, securityAction: 'coordinator.workflow.start',
  boundedWorkflow: true, payloadDigest: 'digest-exact', decisionNonce: 'nonce-exact',
  createdAt: '2026-10-06T12:00:00Z',
};

test('chat-bounded-c2: composed Transcript signs approve and deny only for the matching session and preserves held/error cards', async ({ page }) => {
  const approvals = [
    boundedApproval,
    { ...boundedApproval, id: 'generic-current', securityAction: 'task.create', boundedWorkflow: false },
    { ...boundedApproval, id: 'bounded-other-session', sessionId: 'another-session' },
    { ...boundedApproval, id: 'unsafe-preview', preview: '<img src=x onerror=alert(1)>' },
    { ...boundedApproval, id: 'bounded-no-signer' },
    { ...boundedApproval, id: 'bounded-no-native-bridge' },
  ];
  const nativeDecisions: Array<{ id: string; status: string; nonce: string; digest: string | null }> = [];
  const patches: Array<{ id: string; body: Record<string, unknown>; capability: string | undefined }> = [];
  await page.addInitScript(() => {
    Object.assign(window, {
      rhythmShell: {
        humanApproval: {
          capability: async () => 'test-native-capability',
          signDecision: async (id: string, status: string, nonce: string, digest: string | null) => {
            const target = (window as unknown as { rhythmShell: { nativeDecisions: unknown[]; signerAvailable: boolean } }).rhythmShell;
            if (!target.signerAvailable) throw new Error('native signer unavailable');
            target.nativeDecisions.push({ id, status, nonce, digest });
            return { capability: 'test-native-capability', signature: `signed:${id}:${status}:${nonce}:${digest}` };
          },
        },
        nativeDecisions: [], signerAvailable: true,
      },
    });
  });
  await page.route('https://api.vcrcapps.com/**', (route) => route.abort());
  await openInterceptedLiveApp(page, `/#/agents?sessionId=${rootSession}`, {
    handleApi: async (route, request) => {
      if (request.pathname === '/agent-approvals' && request.method === 'GET') {
        await fulfillJson(route, 200, approvals.filter((approval) => approval.status === 'pending'));
        return true;
      }
      const match = request.pathname.match(/^\/agent-approvals\/([^/]+)$/);
      if (match && request.method === 'PATCH') {
        patches.push({ id: decodeURIComponent(match[1]), body: request.body as Record<string, unknown>, capability: request.headers['x-rhythm-human-approval'] });
        if (patches.length === 1) await fulfillJson(route, 503, { error: 'native approval service unavailable' });
        else {
          const status = (request.body as { status: string }).status;
          const index = approvals.findIndex((approval) => approval.id === decodeURIComponent(match[1]));
          if (index >= 0) approvals[index] = { ...approvals[index], status };
          await fulfillJson(route, 200, { ...boundedApproval, status });
        }
        return true;
      }
      return false;
    },
  });

  // The store invokes the actual signer bridge; toggling its result exercises the fail-closed UI path.
  await page.evaluate(() => {
    const shell = (window as unknown as { rhythmShell: { signerAvailable: boolean } }).rhythmShell;
    shell.signerAvailable = true;
  });
  const card = page.getByTestId('workflow-approval-card-bounded-current');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Sunday brief');
  await expect(card).toContainText('Sunday service notes v7');
  await expect(card).toContainText('12,000 soft tokens');
  await expect(page.getByTestId('workflow-approval-card-generic-current')).toHaveCount(0);
  await expect(page.getByTestId('workflow-approval-card-bounded-other-session')).toHaveCount(0);
  await expect(card.locator('img')).toHaveCount(0);
  const unsafeCard = page.getByTestId('workflow-approval-card-unsafe-preview');
  await expect(unsafeCard).toContainText('<img src=x onerror=alert(1)>');
  await expect(unsafeCard.locator('img')).toHaveCount(0);

  await card.getByRole('button', { name: 'Approve and start' }).click();
  await expect(card).toContainText(/unavailable|failed|held/i);
  await expect(card).toBeVisible();
  expect(patches[0]).toMatchObject({ id: 'bounded-current', body: { status: 'approved', signature: 'signed:bounded-current:approved:nonce-exact:digest-exact' }, capability: 'test-native-capability' });

  // A successful denial uses the same signed native path and removes only this decision card.
  await card.getByRole('button', { name: 'Deny' }).click();
  await expect(card).toHaveCount(0);
  const signed = await page.evaluate(() => (window as unknown as { rhythmShell: { nativeDecisions: Array<{ id: string; status: string; nonce: string; digest: string | null }> } }).rhythmShell.nativeDecisions);
  expect(signed).toEqual([
    { id: 'bounded-current', status: 'approved', nonce: 'nonce-exact', digest: 'digest-exact' },
    { id: 'bounded-current', status: 'rejected', nonce: 'nonce-exact', digest: 'digest-exact' },
  ]);
  expect(patches[1]).toMatchObject({ body: { status: 'rejected' }, capability: 'test-native-capability' });

  // If the native signer is unavailable, approval remains visible and no decision request is sent.
  await page.evaluate(() => {
    (window as unknown as { rhythmShell: { signerAvailable: boolean } }).rhythmShell.signerAvailable = false;
  });
  const held = page.getByTestId('workflow-approval-card-bounded-no-signer');
  await expect(held).toBeVisible();
  await held.getByRole('button', { name: 'Approve and start' }).click();
  await expect(held).toContainText(/native.*sign|signer/i);
  await expect(held).toBeVisible();
  expect(patches).toHaveLength(2);

  // A dedicated bounded approval cannot use the generic WebCrypto fallback when the native bridge is absent.
  await page.evaluate(() => {
    const shell = window as unknown as { rhythmShell: { humanApproval?: unknown } };
    delete shell.rhythmShell.humanApproval;
  });
  const noBridge = page.getByTestId('workflow-approval-card-bounded-no-native-bridge');
  await expect(noBridge).toBeVisible();
  await noBridge.getByRole('button', { name: 'Approve and start' }).click();
  await expect(noBridge).toContainText(/native|sign|held/i);
  await expect(noBridge).toBeVisible();
  expect(patches).toHaveLength(2);
});
