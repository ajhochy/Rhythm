import { expect, test } from '@playwright/test';
import { localSessionId, openInterceptedLiveApp } from './post-m1-phase-5-live-fixtures';

test('post-m1-p5-c1a: translated permission card sends exactly one canonical decision', async ({ page }) => {
  // Regression caught: permission.asked is ignored or a fixture card mutates local state;
  // the first card assertion or the exact request assertion fails.
  const boundary = await openInterceptedLiveApp(page, '/#/agents', {
    handleApi: async (route, request) => {
      if (request.pathname === `/agent-sessions/${localSessionId}/permissions/perm-phase-5/reply`) {
        await route.fulfill({ status: 204 });
        return true;
      }
      return false;
    },
  });
  boundary.send({
    v: 1,
    type: 'permission.asked',
    sessionId: localSessionId,
    permissionID: 'perm-phase-5',
    directory: '/workspace/phase-5',
    tool: 'bash',
    patterns: ['git status --short'],
    title: 'Inspect repository status',
    createdAt: '2026-08-15T12:01:00.000Z',
  });

  const card = page.getByTestId('permission-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Inspect repository status');
  await expect(card).toContainText('/workspace/phase-5');
  await expect(card).toContainText('git status --short');
  await page.getByTestId('permission-allow-once').click();

  await expect.poll(() => boundary.requests.filter((request) => request.pathname.endsWith('/permissions/perm-phase-5/reply')).length).toBe(1);
  expect(boundary.requests.filter((request) => request.pathname.endsWith('/permissions/perm-phase-5/reply'))[0]).toMatchObject({
    method: 'POST',
    pathname: `/agent-sessions/${localSessionId}/permissions/perm-phase-5/reply`,
    body: { reply: 'once' },
  });
});

test('post-m1-p5-c1c: reconnect rehydrates once and permission.replied closes the card', async ({ page }) => {
  // Regression caught: a reconnect loses a pending permission or duplicates it, and a remote
  // permission.replied frame leaves an actionable stale card behind.
  let pendingReads = 0;
  const boundary = await openInterceptedLiveApp(page, '/#/agents', {
    handleApi: async (route, request) => {
      if (request.pathname === `/agent-sessions/${localSessionId}/pending-permissions`) {
        pendingReads += 1;
        await route.fulfill({ status: 200, json: [{
          sessionId: localSessionId,
          permissionID: 'perm-recovered',
          directory: '/workspace/phase-5',
          tool: 'write',
          patterns: ['docs/ai/project-state.md'],
          title: 'Update project state',
          createdAt: '2026-08-15T12:02:00.000Z',
        }] });
        return true;
      }
      return false;
    },
  });

  await expect.poll(() => pendingReads, { message: 'the renderer must query the real pending-permissions route after connecting' }).toBeGreaterThan(0);
  await expect(page.getByTestId('permission-card')).toHaveCount(1);
  boundary.send({ v: 1, type: 'permission.replied', sessionId: localSessionId, permissionID: 'perm-recovered' });
  await expect(page.getByTestId('permission-card')).toHaveCount(0);
  expect(boundary.requests.filter((request) => request.pathname.endsWith('/permissions/perm-recovered/reply'))).toHaveLength(0);
});

test('post-m1-p5-c1e: permission mode uses canonical persisted values', async ({ page }) => {
  // Regression caught: display labels such as "Accept Edits" cross the PATCH boundary;
  // the canonical option-value assertion fails before a mislabeled request can be accepted.
  const boundary = await openInterceptedLiveApp(page, '/#/agents', {
    handleApi: async (route, request) => {
      if (request.pathname === `/agent-sessions/${localSessionId}` && request.method === 'PATCH') {
        await route.fulfill({ status: 200, json: {} });
        return true;
      }
      return false;
    },
  });
  const select = page.getByTestId('composer-permission-mode');
  expect(await select.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).toEqual([
    'default', 'acceptEdits', 'plan', 'bypassPermissions',
  ]);
  await select.selectOption('acceptEdits');
  await expect.poll(() => boundary.requests.filter((request) => request.method === 'PATCH' && request.pathname === `/agent-sessions/${localSessionId}`).length).toBe(1);
  expect(boundary.requests.find((request) => request.method === 'PATCH' && request.pathname === `/agent-sessions/${localSessionId}`)?.body).toEqual({ permissionMode: 'acceptEdits' });
});
