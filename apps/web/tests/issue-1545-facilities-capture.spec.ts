import { mkdir } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const outputRoot = '/private/tmp/rhythm-issue-1545-facilities-captures';
const facility = { id: 7, name: 'Sanctuary with a long production room name', description: null, capacity: 500, location: null, building: 'Main', createdAt: '', updatedAt: '' };
const reservation = { id: 9, facilityId: 7, seriesId: null, groupId: null, title: 'Sunday service with rehearsal and volunteer setup', requesterName: 'AJ', requesterUserId: 1, createdByName: 'AJ', createdByUserId: 1, startTime: '2026-09-13T09:00:00', endTime: '2026-09-13T10:00:00', notes: 'Open the room before rehearsal.', externalEventId: null, externalSource: null, createdByRhythm: false, isConflicted: false, conflictReason: null, createdAt: '', updatedAt: '' };
const schedule = { id: 'weekly-planning', name: 'Monday planning digest with a deliberately long title', description: null, scheduleType: 'weekly', scheduledTime: '09:00', scheduledDay: 1, cronExpression: null, runAt: null, timezone: 'America/Los_Angeles', nextRunAt: null, prompt: 'Summarize open work and unresolved owners.', agentKind: 'general', agentConfigId: null, modelProvider: null, modelId: null, allowedMcpsJson: null, allowedSkillsJson: null, enabled: true, lastRunAt: '2026-09-21T16:00:00Z', lastRunStatus: 'completed', lastError: null, createdByUserId: 1, createdAt: '', updatedAt: '' };

async function mockLiveGateway(page: Page) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (['http://127.0.0.1:4180', 'http://127.0.0.1:7240'].includes(url.origin)) return route.continue();
    const headers = { 'access-control-allow-origin': page.url().startsWith('http://127.0.0.1:7240') ? 'http://127.0.0.1:7240' : 'http://127.0.0.1:4180', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
    const reply = (body: unknown) => route.fulfill({ headers, json: body });
    if (!['http://127.0.0.1:4098', 'http://127.0.0.1:4097', 'https://api.vcrcapps.com'].includes(url.origin)) return route.abort('blockedbyclient');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.method() !== 'GET') return route.abort('blockedbyclient');
    if (url.pathname === '/health') return reply({ status: 'ok', healthy: true });
    if (['/message-threads', '/agent-configs', '/agent-sessions', '/agent-approvals', '/notifications'].includes(url.pathname)) return reply([]);
    if (url.pathname === '/facilities') return reply([facility]);
    if (url.pathname === '/facilities/reservations') return reply(url.searchParams.get('grouped') === 'true' ? [] : [reservation]);
    if (url.pathname === '/facilities/7/reservation-series') return reply([]);
    if (url.pathname === '/agent-schedules') return reply([schedule]);
    if (url.pathname === '/agent-schedules/weekly-planning/runs') return reply([]);
    return route.abort('blockedbyclient');
  });
}

async function attach(page: Page, testInfo: TestInfo, name: string) {
  await mkdir(outputRoot, { recursive: true });
  const path = `${outputRoot}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const viewport of [{ label: '1440', width: 1440, height: 900 }, { label: '1100', width: 1100, height: 800 }, { label: '390', width: 390, height: 844 }]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`1545:facilities-ui-proposal:1 captures Facilities and Agents Tasks at ${viewport.label}px in ${colorScheme}`, async ({ page }, testInfo) => {
      await mockLiveGateway(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ colorScheme });

      await page.goto('/#/facilities');
      await expect(page.getByTestId('page-facilities')).toBeVisible();
      await attach(page, testInfo, `facilities-${viewport.label}-${colorScheme}`);

      await page.goto('/#/tools/tasks');
      await expect(page.getByRole('heading', { name: 'Agent Schedules' })).toBeVisible();
      await attach(page, testInfo, `agents-tasks-${viewport.label}-${colorScheme}`);
    });
  }
}
