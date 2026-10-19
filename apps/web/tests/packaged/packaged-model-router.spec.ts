import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect, ENGINE, OwnedRecords, localRows, responseFor, assertResponse, type Row } from './feature-test';
import { routerCalibrationCases } from './router-calibration-cases';

// Observed response projections; keep the packaged runner independent of renderer-only workspace aliases.
type RouterConfig = { routing: { engine: string; scope: string }; features: { model_routing: string }; remoteDataConsent: boolean; openaiDecisions?: { hasApiKey: boolean } };
type RouterGridView = { invalidReason: string | null; classifier: { model: string }; routing: Record<string, Record<number, Array<{ model: string; effort: string }>>> };
type RouterGridDecision = { served: { requestModelId: string; servedModelId: string } | null };
type Attempt = { classification: { tier: number; category: string; source: string; reason: string }; result: { applied: boolean; model: string; accountId: string; effortRequested: string; effortApplied: string; tierUsed: number; trace: Array<{ action: string; reason?: string; model?: string }> } };

function routerAttempts(id: string): Attempt[] {
  return localRows('SELECT classification_json,result_json FROM agent_router_grid_attempts WHERE session_id=? ORDER BY id', id)
    .map(row => ({ classification: JSON.parse(String(row.classification_json)), result: JSON.parse(String(row.result_json)) }));
}

async function sendRouterPrompt(page: Page, records: OwnedRecords, row: Row, prompt: string, answer: string | RegExp) {
  await page.getByTestId('composer-input').fill(prompt);
  await page.getByTestId('composer-send').click();
  if (typeof answer === 'string') await expect(page.getByTestId('transcript').getByText(answer, { exact: true })).toBeVisible({ timeout: 120_000 });
  else await expect(page.getByTestId('transcript')).toContainText(answer, { timeout: 120_000 });
  await expect(page.getByTestId('composer-send')).toBeVisible({ timeout: 30_000 });
  const messages = async () => {
    const response = await fetch(`${ENGINE}/session/${row.sdkSessionId}/message?directory=${encodeURIComponent(records.directory!)}&limit=50`, { signal: AbortSignal.timeout(20_000) });
    expect(response.status).toBe(200);
    return await response.json() as Array<{ info: { role: string; providerID?: string; modelID?: string }; parts: Array<{ type: string; text?: string }> }>;
  };
  const matchesAnswer = (text: string) => typeof answer === 'string' ? text.trim() === answer : answer.test(text);
  await expect.poll(async () => (await messages()).some(message => message.info.role === 'assistant' && message.parts.some(part => part.type === 'text' && matchesAnswer(part.text ?? ''))), { timeout: 30_000 }).toBe(true);
  const result = await messages();
  expect(result.filter(message => message.info.role === 'user' && message.parts.some(part => part.text === prompt))).toHaveLength(1);
  const detail = await records.api!.json<{ messages: Array<{ rawText: string }> }>(`/agent-sessions/${row.id}`);
  expect(detail.messages.filter(message => message.rawText === prompt)).toHaveLength(1);
  return result.filter(message => message.info.role === 'assistant' && message.parts.some(part => matchesAnswer(part.text ?? ''))).at(-1)!;
}

// Only these nonce-owned projects/sessions are mutated. The existing saved router/accounts stay untouched.
const test = base.extend<{ router: OwnedRecords }>({
  router: async ({ page }, use) => {
    const records = new OwnedRecords(page, 'sessions', 'model-router');
    let directory: string | undefined;
    let initialPreferences: string | null = null;
    try {
      await records.open();
      initialPreferences = await page.evaluate(() => localStorage.getItem('rhythm-agents-projects-open'));
      directory = await mkdtemp('/private/tmp/rhythm-router-');
      records.directory = directory;
      await page.getByRole('button', { name: 'View options', exact: true }).click();
      await page.getByTestId('rail-add-project').click();
      await page.getByTestId('project-name').fill(records.prefix);
      await page.getByTestId('project-cwd').fill(directory);
      const pending = responseFor(page, 'POST', '/projects');
      await page.getByTestId('add-project-dialog').getByRole('button', { name: 'Create', exact: true }).click();
      const response = await pending;
      await assertResponse(response, 'POST', '/projects', 201);
      expect(await response.json()).toMatchObject({ name: records.prefix, cwd: directory, archivedAt: null });
      await expect(page.getByTestId('selected-agent-project')).toContainText(directory);
      await use(records);
    } finally {
      const errors: unknown[] = [];
      try { await page.goto('rhythm://app/index.html#/tasks'); } catch (error) { errors.push(error); }
      // Session cleanup precedes project deletion and directory removal.
      records.directory = undefined;
      try { await records.cleanup(); } catch (error) { errors.push(error); }
      if (records.api && directory) {
        try {
          const projects = (await records.api.json<Array<{ id: string; name: string; cwd: string }>>('/projects?includeArchived=true'))
            .filter(row => row.name === records.prefix && row.cwd === directory);
          for (const project of projects) {
            expect(localRows('SELECT name,cwd FROM projects WHERE id=?', project.id)).toMatchObject([{ name: records.prefix, cwd: directory }]);
            expect((await records.api.fetch(`/projects/${project.id}`, { method: 'DELETE' })).status).toBe(204);
            expect(localRows('SELECT id FROM projects WHERE id=?', project.id)).toEqual([]);
          }
          expect(localRows('SELECT id FROM agent_sessions WHERE name LIKE ?', `${records.prefix}%`)).toEqual([]);
          expect(localRows('SELECT id FROM projects WHERE name=? AND cwd=?', records.prefix, directory)).toEqual([]);
          await page.evaluate(({ ids, absent }) => {
            const key = 'rhythm-agents-projects-open';
            const value = JSON.parse(localStorage.getItem(key) ?? '{}');
            ids.forEach(id => delete value[id]);
            if (absent && !Object.keys(value).length) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(value));
          }, { ids: projects.map(row => row.id), absent: initialPreferences === null });
        } catch (error) { errors.push(error); }
      }
      if (directory && errors.length === 0) await rm(directory, { recursive: true });
      if (errors.length) throw new AggregateError(errors, 'Owned router fixture cleanup failed');
    }
  },
});

test('[P0] model router: saved Grid/Luna/consent settings agree with the rendered controls', async ({ page, sessions }) => {
  await sessions.open();
  const config = await sessions.api!.json<RouterConfig>('/agent-decisions/config');
  const grid = await sessions.api!.json<RouterGridView>('/agent-decisions/grid');
  expect(config.routing).toMatchObject({ engine: 'grid', scope: 'first_prompt' });
  expect(config.features.model_routing).toBe('on');
  expect(config.remoteDataConsent).toBe(true);
  expect(config.openaiDecisions?.hasApiKey).toBe(true);
  expect(grid.invalidReason).toBeNull();
  expect(grid.classifier.model).toBe('gpt-6-luna');
  await page.goto('rhythm://app/index.html#/tools/agent-settings?settingsSection=model-routing');
  await page.getByTestId('router-group-grid-engine').click();
  await expect(page.getByTestId('grid-engine-grid')).toBeChecked();
  await expect(page.getByTestId('grid-engine-mode')).toHaveValue('on');
  await expect(page.getByTestId('grid-classifier-model')).toHaveValue(grid.classifier.model);
  await expect(page.getByTestId('grid-classifier-status')).toContainText('key saved · remote-data consent given');
  await page.reload();
  await expect(page.getByTestId('grid-classifier-model')).toHaveValue(grid.classifier.model);
});

test('[P0] model router: trivial Auto work stays cheap, applies the actual route, and reuses it after reload', async ({ page, router }) => {
  // A constant Sol pick used to satisfy routing plumbing checks. It must fail this semantic contract.
  test.setTimeout(300_000);
  expect(process.env.RHYTHM_FEATURE_MODEL, 'UNVERIFIED: real router turns require RHYTHM_FEATURE_MODEL=1').toBe('1');
  const row = await router.create(' auto');
  expect(row.modelMode).toBe('auto');
  const assistant = await sendRouterPrompt(page, router, row, 'Convert this text to lowercase and return only the result: HELLO WORLD', 'hello world');
  const attempts = routerAttempts(row.id);
  expect(attempts).toHaveLength(2); // pending intent + applied receipt, not two classifications
  expect(attempts[0].classification).toEqual(attempts[1].classification);
  expect(attempts[0].result.applied).toBe(false);
  const { classification, result } = attempts[1];
  expect(classification).toMatchObject({ source: 'decisions', reason: 'ok', category: 'knowledge', tier: 4 });
  expect(result.applied).toBe(true);
  // Account/model unavailability is visible as a failed cheap-routing expectation, never silently accepted as "working".
  expect(result.tierUsed, `trivial task escalated: ${JSON.stringify(result.trace)}`).toBe(4);
  expect(['anthropic/claude-haiku-5-5', 'openai/gpt-6-luna']).toContain(result.model);
  const [provider, model] = result.model.split('/');
  expect(assistant.info).toMatchObject({ providerID: provider, modelID: model });
  const stored = localRows('SELECT provider_id,model_id,model_mode,router_decided_at,router_variant,openai_account_id,openai_account_source,anthropic_account_id,anthropic_account_source FROM agent_sessions WHERE id=?', row.id)[0];
  expect(stored).toMatchObject({ provider_id: provider, model_id: model, model_mode: 'auto', router_variant: result.effortApplied });
  expect(stored.router_decided_at).toEqual(expect.any(String));
  expect(stored[`${provider}_account_id`]).toBe(result.accountId);
  expect(stored[`${provider}_account_source`]).toBe('router');
  const grid = await router.api!.json<RouterGridView>('/agent-decisions/grid');
  expect(grid.routing.knowledge[4]).toContainEqual(expect.objectContaining({ model: result.model, effort: result.effortRequested }));
  const decision = (await router.api!.json<{ decision: RouterGridDecision }>('/agent-decisions/grid/last-decision')).decision;
  expect(decision).toMatchObject({ sessionId: row.id, applied: true, mode: 'on', classifierSource: 'decisions', classifierReason: 'ok', model: result.model, tier: 4, tierUsed: 4, effortApplied: result.effortApplied, accountId: result.accountId });
  expect(decision.served).toMatchObject({ requestModelId: model, servedModelId: model });
  await page.getByTestId('session-actions').click();
  await expect(page.getByTestId('composer-model')).toHaveValue('__auto__');
  await expect(page.getByTestId('composer-router-pick')).toContainText(`Auto served ${model}`);
  await page.getByTestId('chat-configuration-dialog-close').click();
  await page.reload();
  await page.getByTestId(`session-${row.id}`).click();
  const second = await sendRouterPrompt(page, router, row, 'Convert this text to lowercase and return only the result: GOODBYE WORLD', 'goodbye world');
  expect(second.info).toMatchObject({ providerID: provider, modelID: model });
  expect(routerAttempts(row.id), 'follow-up must reuse the first classification across renderer reload').toEqual(attempts);
  expect(localRows('SELECT router_decided_at,router_variant FROM agent_sessions WHERE id=?', row.id)).toMatchObject([{ router_decided_at: stored.router_decided_at, router_variant: stored.router_variant }]);
  const provenance = await router.api!.json<{ dispatches: Array<Record<string, unknown>> }>(`/agent-sessions/${row.id}/model-provenance`);
  expect(provenance.dispatches).toHaveLength(2);
  for (const dispatch of provenance.dispatches) expect(dispatch).toMatchObject({ requestedSource: 'auto', finalProviderId: provider, finalModelId: model, outcome: 'accepted' });
  await page.goto('rhythm://app/index.html#/tools/agent-settings?settingsSection=model-routing');
  await page.getByTestId('router-group-grid-last').click();
  await page.getByTestId('grid-last-refresh').click();
  await expect(page.getByTestId('grid-last-requested')).toContainText(result.model);
  await expect(page.getByTestId('grid-last-served')).toContainText(model);
  await expect(page.getByTestId('grid-last-decision')).toContainText('OpenAI Decisions');
});

test('[P0] model router qualification: routine arithmetic retains an eligible tier 3 or 4 route', async ({ page, router }) => {
  // Exposes the user's symptom even when the classifier is correct but unavailable candidates force Sol.
  test.setTimeout(240_000);
  expect(process.env.RHYTHM_FEATURE_MODEL, 'UNVERIFIED: real router turns require RHYTHM_FEATURE_MODEL=1').toBe('1');
  const row = await router.create(' routine');
  const assistant = await sendRouterPrompt(page, router, row, 'Compute 23 + 44. Reply only with digits. Do not use tools.', '67');
  const attempts = routerAttempts(row.id);
  expect(attempts).toHaveLength(2);
  const { classification, result } = attempts[1];
  expect(classification).toMatchObject({ source: 'decisions', reason: 'ok', category: 'knowledge' });
  expect(result.applied).toBe(true);
  const [provider, model] = result.model.split('/');
  expect(assistant.info).toMatchObject({ providerID: provider, modelID: model });
  await page.goto('rhythm://app/index.html#/tools/agent-settings?settingsSection=model-routing');
  await page.getByTestId('router-group-grid-last').click();
  await expect(page.getByTestId('grid-last-requested')).toContainText(result.model);
  await expect(page.getByTestId('grid-last-served')).toContainText(model);
  const explanation = `classifier tier=${classification.tier}, served tier=${result.tierUsed}, model=${result.model}, trace=${JSON.stringify(result.trace)}`;
  expect([3, 4], `routine arithmetic over-classified: ${explanation}`).toContain(classification.tier);
  expect([3, 4], `cheap-route qualification failed (availability step-up is not a classifier failure): ${explanation}`).toContain(result.tierUsed);
});

test('[P0] model router: a one-literal edit is served by a routine-tier model', async ({ page, router }) => {
  test.setTimeout(240_000);
  expect(process.env.RHYTHM_FEATURE_MODEL, 'UNVERIFIED: real router turns require RHYTHM_FEATURE_MODEL=1').toBe('1');
  const row = await router.create(' literal edit');
  const sample = routerCalibrationCases.find(value => value.name === 'one literal edit does not become tier 2')!;
  const assistant = await sendRouterPrompt(page, router, row, sample.prompt, /function\s+greet\s*\(\s*\)\s*\{\s*return\s+["']Hello["'];?\s*\}/);
  const attempts = routerAttempts(row.id);
  expect(attempts).toHaveLength(2);
  const { classification, result } = attempts[1];
  expect(classification).toMatchObject({ source: 'decisions', reason: 'ok', category: 'coding' });
  expect([3, 4], `literal edit over-classified: ${JSON.stringify(classification)}`).toContain(classification.tier);
  expect([3, 4], `literal edit escalated: ${JSON.stringify(result.trace)}`).toContain(result.tierUsed);
  expect(result.applied).toBe(true);
  const [provider, model] = result.model.split('/');
  expect(assistant.info).toMatchObject({ providerID: provider, modelID: model });
  expect(localRows('SELECT provider_id,model_id,model_mode FROM agent_sessions WHERE id=?', row.id)).toMatchObject([{ provider_id: provider, model_id: model, model_mode: 'auto' }]);
  await page.reload();
  await page.getByTestId(`session-${row.id}`).click();
  await expect(page.getByTestId('transcript')).toContainText(/Hello/);
  expect(routerAttempts(row.id)).toEqual(attempts);
});

test('[P0] model router: explicit session model pin serves Luna without a Grid attempt', async ({ page, router }) => {
  test.setTimeout(240_000);
  expect(process.env.RHYTHM_FEATURE_MODEL, 'UNVERIFIED: real router turns require RHYTHM_FEATURE_MODEL=1').toBe('1');
  const row = await router.create(' pinned');
  await page.getByTestId('session-actions').click();
  await page.getByTestId('composer-model').selectOption('openai/gpt-6-luna');
  const pending = responseFor(page, 'PATCH', `/agent-sessions/${row.id}`);
  await page.getByTestId('model-session-default').click();
  await assertResponse(await pending, 'PATCH', `/agent-sessions/${row.id}`, 200);
  const assistant = await sendRouterPrompt(page, router, row, 'Compute 31 + 18. Reply only with digits. Do not use tools.', '49');
  expect(assistant.info).toMatchObject({ providerID: 'openai', modelID: 'gpt-6-luna' });
  expect(localRows('SELECT provider_id,model_id,model_mode FROM agent_sessions WHERE id=?', row.id)).toMatchObject([{ provider_id: 'openai', model_id: 'gpt-6-luna', model_mode: 'fixed' }]);
  expect(routerAttempts(row.id), 'fixed model must bypass classification and automatic route application').toEqual([]);
  await page.reload();
  await page.getByTestId(`session-${row.id}`).click();
  await page.getByTestId('session-actions').click();
  await expect(page.getByTestId('composer-model')).toHaveValue('openai/gpt-6-luna');
  await expect(page.getByTestId('composer-router-pick')).toHaveCount(0);
  await page.getByTestId('chat-configuration-dialog-close').click();
});

// Deliberately semantic expectations derived from the router's published tier descriptions.
// These calls use the built mega transport/questions, not a mock or a second interpretation of the classifier.
for (const sample of routerCalibrationCases) {
  test(`[P0] model router classifier: ${sample.name}`, async ({ packaged }) => {
    expect(process.env.RHYTHM_FEATURE_MODEL, 'UNVERIFIED: live Decisions classifier requires RHYTHM_FEATURE_MODEL=1').toBe('1');
    const root = path.join(packaged.appPath, 'Contents/Resources/api_server/dist');
    const require = createRequire(path.join(root, 'server.js'));
    const { OpenAIDecisionsClient } = require(path.join(root, 'services/decision/openai_decisions_client.js'));
    const { GRID_CLASSIFIER_QUESTIONS, gridTierFromScore } = require(path.join(root, 'services/decision/router_grid_classifier.js'));
    const { loadRouterGridConfig } = require(path.join(root, 'services/decision/router_grid_config.js'));
    // The real saved API key is kept in memory and never attached to reports or assertion output.
    const settings = JSON.parse(readFileSync(path.join(homedir(), 'Library/Application Support/Rhythm/decision-router.json'), 'utf8'));
    const grid = loadRouterGridConfig(path.join(homedir(), 'Library/Application Support/Rhythm/router-grid.json'));
    const client = new OpenAIDecisionsClient({ baseUrl: settings.openaiDecisions.baseUrl, model: grid.classifier.model, apiKey: settings.openaiDecisions.apiKey, consent: settings.remoteDataConsent, timeoutMs: 1000 });
    const result = await client.decide(sample.prompt, GRID_CLASSIFIER_QUESTIONS, grid.classifier.model);
    expect(result.status, `classifier unavailable: ${result.reason ?? ''}`).toBe('ok');
    const score = result.answers[0].score;
    const tier = gridTierFromScore(score, grid.classifier.tier_thresholds);
    expect(sample.tiers, `Luna score=${score}, thresholds=${JSON.stringify(grid.classifier.tier_thresholds)}, mapped tier=${tier}`).toContain(tier);
  });
}
