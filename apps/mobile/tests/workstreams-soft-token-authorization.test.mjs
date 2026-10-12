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

test('paired mobile exposes the exact read-only unknown-worker check from the current job', async () => {
  const panel = await readFile(resolve(root, 'components/agents/workstreams-panel.tsx'), 'utf8');
  const check = panel.match(/\{currentJob\.state === 'unknown' \? <View style=\{styles\.actions\}>([\s\S]*?)<\/View> : null\}/);
  assert.ok(check, 'the current owned job must control the unknown-worker check');
  assert.match(check[1], /disabled=\{busy\}/);
  assert.match(check[1], /reconcileWorkstreamUnknown\(projectId, selected\.workstream\.id, \{ expectedRevision: selected\.workstream\.revision, jobId: currentJob\.id \}\)/);
  assert.doesNotMatch(panel, /selected\.workstream\.state === 'unknown'[\s\S]{0,600}Check authoritative worker status/);
  assert.match(panel, /testID="mobile-workstreams-run-next"[\s\S]*?Run next/);
});
