import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'requires the approved isolated sandbox');

test('slice-2-c7-live: receipt probes the real sandbox API and engine separately', async ({ page }) => {
  // Regression caught: mocked health can pass while the real :4098/:4097 services are unreachable.
  const responses: string[] = [];
  page.on('response', (response) => {
    if (/127\.0\.0\.1:409[78]/.test(response.url())) responses.push(`${response.request().method()} ${response.url()} ${response.status()}`);
  });
  await page.goto('/#/agents');
  const receipt = page.getByRole('status', { name: 'Environment receipt' });
  await expect(receipt).toContainText('Live');
  await expect(receipt).toContainText('API :4098 healthy');
  await expect(receipt).toContainText('Engine :4097 healthy');
  expect(responses).toEqual(expect.arrayContaining([
    'GET http://127.0.0.1:4098/health 200',
    'GET http://127.0.0.1:4097/global/health 200',
  ]));

  const evidence = path.resolve(import.meta.dirname, '../../../../docs/ai/runs/evidence/electron-m1-gateway-live.png');
  await receipt.screenshot({ path: evidence });
  const bytes = await readFile(evidence);
  console.log(`receipt screenshot sha256=${createHash('sha256').update(bytes).digest('hex')} bytes=${bytes.length}`);
});
