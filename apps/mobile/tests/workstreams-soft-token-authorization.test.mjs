import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('paired mobile Run next projects the server-owned soft total-token acknowledgement without a separate coordinator', async () => {
  const service = await readFile(resolve(root, 'providers/services/workstreams-service.ts'), 'utf8');
  const panel = await readFile(resolve(root, 'components/agents/workstreams-panel.tsx'), 'utf8');
  assert.match(service, /softTokenBudgetAcknowledged: true;/);
  assert.match(service, /\/mobile-gateway\/workstreams/);
  assert.match(panel, /Soft total-token authorization/);
  assert.match(panel, /mobile-workstreams-soft-token-acknowledgement/);
  assert.match(panel, /input, output, reasoning, and cache[\s\S]*?Input overhead is unknown[\s\S]*?no output cap is enforced[\s\S]*?can overrun/);
  assert.match(panel, /softTokenBudgetAcknowledged: true,/);
  assert.doesNotMatch(panel, /maxOutputTokens/);
});
