import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const fakeBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_FAKE_PORT ?? '44096'}`;
const captureDir = process.env.RHYTHM_RESEARCH_CAPTURE_DIR;

test.use({ viewport: { width: 390, height: 844 } });

test('paired Research project workspace preserves budgets and gates report readiness', async ({ page, request }) => {
  // E2E Tools uses the direct fake transport; gateway auth is exercised by the
  // fake server self-test. Capture real browser requests to assert scope here.
  const researchRequests = [];
  page.on('request', (outgoing) => {
    const path = new URL(outgoing.url()).pathname;
    if (path.startsWith('/mobile-gateway/tools/agent-research/projects') && outgoing.method() !== 'OPTIONS') {
      researchRequests.push({ method: outgoing.method(), path, projectId: outgoing.headers()['x-rhythm-project-id'] });
    }
  });
  expect((await request.post(`${fakeBaseUrl}/__control/reset`, { data: { scenario: 'happy-path' } })).ok()).toBeTruthy();
  expect((await request.post(`${fakeBaseUrl}/__control/rhythm-tools-state`, { data: { state: 'data' } })).ok()).toBeTruthy();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Pair a Mac' }).click();
  await page.getByRole('button', { name: 'Scan test QR code' }).click();
  await expect(page.getByLabel('Paired Mac status: Connected').last()).toBeVisible();
  await page.getByRole('tab', { name: 'Tools' }).click();
  await page.getByRole('button', { name: /^Research\./ }).click();
  await expect(page.getByTestId('research-project-workspace')).toBeVisible();
  await page.getByTestId('research-project-card-research-project-demo').click();
  await expect(page.getByTestId('research-budget-summary')).toContainText('0');
  await page.getByTestId('research-run-research-run-stopped').click();
  await expect(page.getByTestId('research-budget-exhausted')).toBeVisible();
  const runDetail = page.getByTestId('research-run-detail');
  await expect(runDetail.getByRole('button', { name: 'View report', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Finish with current evidence', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Edit research settings' }).click();
  await expect(page.getByLabel('Researchers (passes)', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Spending limit (USD)', { exact: true })).toHaveValue('0.25');
  if (captureDir) {
    await mkdir(captureDir, { recursive: true });
    await expect.poll(() => page.getByTestId('research-settings-dialog-surface').evaluate((node) => {
      let opacity = 1;
      for (let element = node; element; element = element.parentElement) opacity *= Number(getComputedStyle(element).opacity);
      return opacity;
    })).toBe(1);
    await page.screenshot({ path: join(captureDir, 'research-stopped-settings-390x844.png') });
  }
  await page.getByRole('button', { name: 'Save research settings' }).click();
  await expect(page.getByTestId('research-settings-dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Finish with current evidence', exact: true }).click();
  await expect(runDetail.getByRole('button', { name: 'View report', exact: true })).toBeEnabled();
  await runDetail.getByRole('button', { name: 'View report', exact: true }).click();
  await expect(page.getByTestId('research-report')).toContainText('Guest follow-up evidence');
  await page.getByTestId('research-report').scrollIntoViewIfNeeded();
  if (captureDir) await page.screenshot({ path: join(captureDir, 'research-ready-report-390x844.png') });

  expect(researchRequests.length).toBeGreaterThan(0);
  expect(researchRequests.every((event) => event.projectId === 'project-demo')).toBeTruthy();
  expect(researchRequests).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: 'POST', path: '/mobile-gateway/tools/agent-research/projects/research-project-demo/runs/research-run-stopped/finish' }),
    expect.objectContaining({ method: 'GET', path: '/mobile-gateway/tools/agent-research/projects/research-project-demo/runs/research-run-stopped/export' }),
  ]));
});
