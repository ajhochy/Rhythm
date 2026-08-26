import { expect, test } from '@playwright/test';
import { canonicalProfile, canonicalSession, localSessionId, openInterceptedLiveApp } from './post-m1-phase-5-live-fixtures';

test('post-m1-p5-c2b: pending human approval is shared by review and originating transcript', async ({ page }) => {
  // Regression caught: the visually similar Review Queue remains seeded proposal state and never
  // reads /agent-approvals; the request-count assertion fails.
  let approvalReads = 0;
  await openInterceptedLiveApp(page, '/#/tools/review', {
    handleApi: async (route, request) => {
      if (request.pathname === '/agent-approvals' && request.method === 'GET') {
        approvalReads += 1;
        await route.fulfill({ status: 200, json: [{
          id: 'approval-phase-5',
          sessionId: localSessionId,
          action: 'Send the final handoff',
          preview: 'To: production@example.org',
          consequence: 'Sends an external email',
          status: 'pending',
          createdAt: '2026-08-15T12:03:00.000Z',
          decisionNonce: 'nonce-phase-5',
          payloadDigest: 'digest-phase-5',
        }] });
        return true;
      }
      return false;
    },
  });
  await expect.poll(() => approvalReads, { message: 'review must read the signed approval boundary, not proposal fixtures' }).toBeGreaterThan(0);
  await expect(page.getByText('Send the final handoff')).toBeVisible();
  await expect(page.getByText('To: production@example.org')).toBeVisible();
  await expect(page.getByText('Sends an external email')).toBeVisible();
});

test('post-m1-p5-c2d: child identity remains separate and its isolated transcript is read only', async ({ page }) => {
  // Regression caught: toSessionViewModel drops parentSessionId and hard-codes childIds, so the
  // child composer remains writable or the parent transcript is shown under the child identity.
  const child = {
    ...canonicalSession,
    id: 'phase-5-child-local',
    sdkSessionId: 'phase-5-child-sdk',
    profileId: 'phase-5-child-profile',
    opencodeAgentId: 'research',
    parentSessionId: localSessionId,
    delegationDepth: 1,
    name: 'Delegated research child',
  };
  await openInterceptedLiveApp(page, '/#/agents', {
    sessions: [child, canonicalSession],
    messagesBySession: {
      'phase-5-child-local': [{ info: { id: 'child-output', role: 'output', time: '2026-08-15T12:04:00.000Z' }, parts: [{ id: 'child-text', type: 'text', text: 'CHILD_ONLY_TRANSCRIPT' }] }],
      [localSessionId]: [{ info: { id: 'parent-output', role: 'output', time: '2026-08-15T12:04:00.000Z' }, parts: [{ id: 'parent-text', type: 'text', text: 'PARENT_ONLY_TRANSCRIPT' }] }],
    },
    handleApi: async (route, request) => {
      if (request.pathname === '/agent-configs') {
        await route.fulfill({ status: 200, json: [canonicalProfile, { ...canonicalProfile, id: 'phase-5-child-profile', label: 'Child profile', isManager: false, allowedDelegatesJson: '[]' }] });
        return true;
      }
      return false;
    },
  });

  await expect(page.getByText('CHILD_ONLY_TRANSCRIPT')).toBeVisible();
  await expect(page.getByText('PARENT_ONLY_TRANSCRIPT')).toHaveCount(0);
  await expect(page.getByTestId('composer-input')).toBeDisabled();
  await expect(page.getByText('Child-agent transcripts are read only.')).toBeVisible();
});

test('issue-1476-c1: canonical nested API children render beneath their parent, never as Active roots', async ({ page }) => {
  // Regression caught: the live mapper/rail ignores nested children and either
  // drops them or interleaves them into the top-level Active list.
  const child = {
    ...canonicalSession,
    id: 'issue-1476-child',
    sdkSessionId: 'issue-1476-child-sdk',
    parentSessionId: localSessionId,
    name: 'Nested delegated child',
  };
  await openInterceptedLiveApp(page, '/#/agents', {
    sessions: [{ ...canonicalSession, children: [child] }],
  });

  const active = page.getByTestId('group-active').locator('..');
  await expect(active.getByTestId(`session-${localSessionId}`)).toBeVisible();
  const parentTree = page.getByTestId(`session-tree-${localSessionId}`);
  const nestedChild = parentTree.getByTestId('session-issue-1476-child');
  await expect(nestedChild).toBeVisible();
  await expect(nestedChild).toHaveClass(/child-session/);
});
