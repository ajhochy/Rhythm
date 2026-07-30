import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const fakePort = process.env.RHYTHM_MOBILE_E2E_FAKE_PORT || '44096';
const fakeServer = `http://127.0.0.1:${fakePort}`;
const proofDir = path.resolve(process.cwd(), '../../.proof/i1238/ui');

async function resetScenario(request) {
  const response = await request.post(`${fakeServer}/__control/reset`, {
    data: { scenario: 'happy-path' },
  });
  expect(response.ok()).toBeTruthy();
}

async function openReadyChat(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Create chat' })).toBeEnabled({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Create chat' }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByPlaceholder('Ask anything...')).toBeVisible({
    timeout: 30_000,
  });
}

async function sendPrompt(page, prompt) {
  await page.getByPlaceholder('Ask anything...').fill(prompt);
  await page.getByTestId('chat-primary-button').click();
  await expect(page.getByText(`Finished: ${prompt}`, { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });
}

test.beforeAll(async () => {
  await mkdir(proofDir, { recursive: true });
});

test.beforeEach(async ({ page, request }) => {
  await resetScenario(request);
  await openReadyChat(page);
});

test('issue-1238-c2/c3: long multiline draft reaches its cap and scrolls internally', async ({ page }) => {
  await page.screenshot({ path: path.join(proofDir, 'default.png'), fullPage: true });
  const input = page.getByPlaceholder('Ask anything...');
  const draft = Array.from({ length: 18 }, (_, index) => `Draft line ${index + 1}`).join('\n');
  await input.fill(draft);

  const metrics = await input.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight,
      value: element.value,
    };
  });
  expect(metrics.value).toBe(draft);
  expect(metrics.clientHeight).toBeLessThanOrEqual(140);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(['auto', 'scroll']).toContain(metrics.overflowY);
  await expect(page.getByTestId('chat-primary-button')).toBeVisible();
  await page.getByRole('button', { name: 'Chat menu' }).click();
  await expect(page.getByRole('heading', { name: 'Session configuration' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Model, GPT-4\.1 mini/ })).toBeVisible();
  await expect(input).toHaveValue(draft);
  await page.screenshot({ path: path.join(proofDir, 'multiline-grown.png'), fullPage: true });
});

test('issue-1238-c5/c6: focused composer does not prevent reaching the full final assistant line', async ({ page }) => {
  for (let index = 1; index <= 8; index += 1) {
    await sendPrompt(page, `Long transcript turn ${index}`);
  }
  const input = page.getByPlaceholder('Ask anything...');
  await input.fill('Focused draft stays intact');
  await input.focus();
  await page.screenshot({ path: path.join(proofDir, 'keyboard-focused.png'), fullPage: true });

  const finalLine = page.getByText(
    /Finished: Long transcript turn 8\. Flow stayed stable against the fake OpenCode server\./,
  ).first();
  await finalLine.scrollIntoViewIfNeeded();
  await expect(finalLine).toBeVisible();
  await expect(input).toHaveValue('Focused draft stays intact');
  await page.screenshot({ path: path.join(proofDir, 'long-transcript-bottom.png'), fullPage: true });
});

test('issue-1238-c4: accessible dismiss control blurs the prompt', async ({ page }) => {
  const input = page.getByPlaceholder('Ask anything...');
  await input.fill('Dismiss me without losing this draft');
  await input.focus();
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: 'Dismiss keyboard' }).click();
  await expect(input).not.toBeFocused();
  await expect(input).toHaveValue('Dismiss me without losing this draft');
});

test('issue-1238-c7: reconnect keeps one complete transcript tail and the draft', async ({ page, request }) => {
  await request.post(`${fakeServer}/__control/reset`, {
    data: { scenario: 'stream-disconnect' },
  });
  await openReadyChat(page);
  await sendPrompt(page, 'Baseline transcript before reconnect');
  const input = page.getByPlaceholder('Ask anything...');
  await input.fill('Draft preserved across background and foreground');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect(input).toHaveValue('Draft preserved across background and foreground');
  await expect(page.getByText(/Finished: Baseline transcript before reconnect/)).toHaveCount(1);
});
