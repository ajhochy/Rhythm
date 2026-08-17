import { expect, test } from '@playwright/test';
import { canonicalProfile, localSessionId, openInterceptedLiveApp } from './post-m1-phase-5-live-fixtures';

test('post-m1-p5-c3d: profile MCP policy is authored from live servers and exact tools', async ({ page }) => {
  // Regression caught: Profiles keeps its hard-coded MCP names and collapses an exact tool map
  // into display labels; the live server assertion or exact PATCH assertion fails.
  const boundary = await openInterceptedLiveApp(page, '/#/profiles', {
    handleApi: async (route, request) => {
      if (request.pathname === '/opencode/mcp' && request.method === 'GET') {
        await route.fulfill({ status: 200, json: [{ name: 'phase5-server', status: 'connected', error: null, requiredEnv: [], needsCredentials: false, source: 'adhoc', tools: ['read_live', 'write_live'] }] });
        return true;
      }
      if (request.pathname === `/agent-configs/${canonicalProfile.id}` && request.method === 'PATCH') {
        await route.fulfill({ status: 200, json: { ...canonicalProfile, allowedMcpsJson: '{"phase5-server":["read_live"]}' } });
        return true;
      }
      return false;
    },
  });
  await expect(page.getByText('phase5-server', { exact: true })).toBeVisible();
  await page.getByLabel('read_live').check();
  await page.getByTestId('profile-save').click();
  await expect.poll(() => boundary.requests.some((request) => request.method === 'PATCH' && request.pathname === `/agent-configs/${canonicalProfile.id}`)).toBe(true);
  expect(boundary.requests.find((request) => request.method === 'PATCH' && request.pathname === `/agent-configs/${canonicalProfile.id}`)?.body).toMatchObject({
    allowedMcpsJson: '{"phase5-server":["read_live"]}',
  });
});

test('post-m1-p5-c3e: profile skill policy is authored from the live exact-name catalog', async ({ page }) => {
  // Regression caught: Profiles offers seeded skills and never requests the live catalog;
  // the live name assertion fails before a non-canonical PATCH can be sent.
  const boundary = await openInterceptedLiveApp(page, '/#/profiles', {
    handleApi: async (route, request) => {
      if (request.pathname === '/opencode/skills' && request.method === 'GET') {
        await route.fulfill({ status: 200, json: [{ name: 'phase5-live-skill', description: 'Live only', location: '/managed/phase5-live-skill/SKILL.md', managed: true, source: 'managed' }] });
        return true;
      }
      if (request.pathname === `/agent-configs/${canonicalProfile.id}` && request.method === 'PATCH') {
        await route.fulfill({ status: 200, json: { ...canonicalProfile, allowedSkillsJson: '["phase5-live-skill"]' } });
        return true;
      }
      return false;
    },
  });
  await expect(page.getByText('phase5-live-skill', { exact: true })).toBeVisible();
  await page.getByLabel('phase5-live-skill').check();
  await page.getByTestId('profile-save').click();
  await expect.poll(() => boundary.requests.some((request) => request.method === 'PATCH' && request.pathname === `/agent-configs/${canonicalProfile.id}`)).toBe(true);
  expect(boundary.requests.find((request) => request.method === 'PATCH' && request.pathname === `/agent-configs/${canonicalProfile.id}`)?.body).toMatchObject({
    allowedSkillsJson: '["phase5-live-skill"]',
  });
});

test('post-m1-p5-c3g: live command discovery dispatches session.command instead of session.input', async ({ page }) => {
  // Regression caught: the composer keeps four hard-coded suggestions and sends selected slash
  // text as ordinary input; the live command assertion or frame assertion fails.
  const boundary = await openInterceptedLiveApp(page, '/#/agents', {
    handleApi: async (route, request) => {
      if (request.pathname === '/opencode/commands' && request.method === 'GET') {
        await route.fulfill({ status: 200, json: [{ name: 'phase5-command', description: 'Run the Phase 5 check', hints: ['<target>'], source: 'command', managed: true }] });
        return true;
      }
      return false;
    },
  });
  await page.getByTestId('composer-input').fill('/phase5');
  await expect(page.getByText('/phase5-command', { exact: true })).toBeVisible();
  await page.getByText('/phase5-command', { exact: true }).click();
  await page.getByTestId('composer-input').fill('/phase5-command target-a');
  await page.getByTestId('composer-send').click();
  await expect.poll(() => boundary.socketFrames.length).toBeGreaterThan(0);
  expect(boundary.socketFrames.at(-1)).toEqual({ v: 1, type: 'session.command', id: localSessionId, command: 'phase5-command', arguments: 'target-a' });
  expect(boundary.socketFrames).not.toContainEqual(expect.objectContaining({ type: 'session.input', text: expect.stringContaining('/phase5-command') }));
});
