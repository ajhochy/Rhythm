import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('manual workstreams desktop controls stay in Runtime and saving is an inert next-owned-launch preference', async () => {
  const settings = await readFile(resolve(root, 'src/components/tools/AgentSettingsTool.tsx'), 'utf8');
  assert.match(settings, /Enable manual workstreams/);
  assert.match(settings, /rhythm:agent-server:manual-workstreams:set/);
  assert.match(settings, /Saving never starts or restarts the runtime, creates a workstream, dispatches a worker, resumes work, or wakes a model\./);
  assert.match(settings, /Work remains Explicit Run next only\. A selected read-only profile, budget authorization, and Pause controls are still required\./);
  assert.match(settings, /Effective state[\s\S]*?Enabled[\s\S]*?Off[\s\S]*?Unavailable/);
  assert.doesNotMatch(settings, /RHYTHM_WORKSTREAMS_ENABLED=/);
  const save = settings.match(/const saveManualWorkstreams = async \(enabled: boolean\) => \{([\s\S]*?)\n  \};/);
  assert.ok(save, 'the explicit settings save handler must remain inspectable');
  assert.doesNotMatch(save[1], /restartLocalRuntime|restartEngine|runNext|dispatch|resume/i);
});

test('a live default-off 404 with no views renders the existing Runtime discovery control without changing coordinator state', async () => {
  const panel = await readFile(resolve(root, 'src/components/WorkstreamsPanel.tsx'), 'utf8');
  assert.match(panel, /navigate\('\/tools\/agent-settings\?settingsSection=runtime'\)/);
  assert.match(panel, /workstreams-open-runtime-settings/);
  assert.match(panel, /Boolean\(error\) && !loading && views\.length === 0/);
  assert.match(panel, /emptyUnavailable[\s\S]*?workstreams-runtime-settings-unavailable[\s\S]*?<OpenManualWorkstreamsRuntimeSettings/);
  assert.match(panel, /!selected\.readiness\.available[\s\S]*?<OpenManualWorkstreamsRuntimeSettings/);
  assert.doesNotMatch(panel.match(/function OpenManualWorkstreamsRuntimeSettings\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '', /api\.|runNext|create|pause|resume|cancel/);
});

test('desktop Run next labels and sends an explicit soft total-token acknowledgement', async () => {
  const panel = await readFile(resolve(root, 'src/components/WorkstreamsPanel.tsx'), 'utf8');
  const gateway = await readFile(resolve(root, 'src/gateway/workstreams.ts'), 'utf8');
  assert.match(gateway, /softTokenBudgetAcknowledged: true;/);
  assert.match(panel, /Soft total-token authorization/);
  assert.match(panel, /workstreams-soft-token-acknowledgement/);
  assert.match(panel, /input, output, reasoning, and cache[\s\S]*?input overhead is unknown[\s\S]*?no output-cap enforcement[\s\S]*?can overrun/);
  assert.match(panel, /softTokenBudgetAcknowledged: true,/);
  assert.doesNotMatch(panel, /maxOutputTokens/);
});

test('desktop exposes a read-only unknown-worker check from the current job, even while the workstream is paused', async () => {
  const panel = await readFile(resolve(root, 'src/components/WorkstreamsPanel.tsx'), 'utf8');
  const check = panel.match(/\{currentJob\.state === 'unknown' && <div className="workstreams-ack">([\s\S]*?)<\/div>\}/);
  assert.ok(check, 'the current owned job must control the unknown-worker check');
  assert.match(check[1], /disabled=\{busy\}/);
  assert.match(check[1], /api\.reconcileUnknown\(projectId, selected\.workstream\.id, \{ expectedRevision: selected\.workstream\.revision, jobId: currentJob\.id \}\)/);
  assert.doesNotMatch(panel, /selected\.workstream\.state === 'unknown'[\s\S]{0,600}Check authoritative worker status/);
  assert.match(panel, /data-testid="workstreams-run-next"[\s\S]*?Run next/);
});
