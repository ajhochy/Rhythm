// Accepted scripted substitutions for exact inventory titles 88–90 and 95.
// These are browser/real-engine transport checks, not paid model or Grid quality evidence.
import { test, expect, responseFor, assertResponse } from './parity-fixture';
import { prepareScriptedModel, scriptedAnswer, scriptedModel, engineMessages, completed, sendScriptedTurn } from './scripted-parity-fixture';

test('[web-parity-088] [P0] conversation: real answer, canonical transcript and reload agree without duplicate user messages', async ({ page, parity, sessions }) => {
  test.setTimeout(150_000);
  await prepareScriptedModel(parity);
  await sessions.open();
  const row = await sessions.create(' canonical scripted turn');
  await page.getByTestId(`session-${row.id}`).click();
  const prompt = `${sessions.prefix}: S0:plain canonical transcript`;
  const result = await sendScriptedTurn(page, parity, row, prompt);
  expect(result.detail.session).toMatchObject({ id: row.id, name: row.name });
  expect(result.detail.messages.filter(message => message.rawText === prompt)).toHaveLength(1);
  expect(result.detail.messages.filter(message => message.rawText.trim() === scriptedAnswer)).toHaveLength(1);
  await page.reload();
  await page.getByTestId(`session-${row.id}`).click();
  await expect(page.getByTestId('transcript').getByText(prompt, { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('transcript').getByText(scriptedAnswer, { exact: true })).toHaveCount(1);
  const text = await page.getByTestId('transcript').innerText();
  expect(text.indexOf(prompt)).toBeLessThan(text.lastIndexOf(scriptedAnswer));
  await expect(page.getByTestId('composer-send')).toBeVisible();
  expect(parity.rows('SELECT provider_id,model_id FROM agent_sessions WHERE id=?', row.id)).toEqual([{ provider_id: scriptedModel.providerID, model_id: scriptedModel.modelID }]);
});

test('[web-parity-089] [P0] conversation: two owned sessions retain independent answers across switching and reload', async ({ page, parity, sessions }) => {
  test.setTimeout(150_000);
  await prepareScriptedModel(parity);
  await sessions.open();
  const first = await sessions.create(' first scripted');
  // Existing S0 reasoning/plain scenarios yield distinct answers, preserving
  // the original cross-session answer-contamination check without a new provider.
  const firstPrompt = `${sessions.prefix} first: S0:reasoning independent first session`;
  const firstAnswer = 'repeat repeat é✓';
  await page.getByTestId('composer-input').fill(firstPrompt);
  await page.getByTestId('composer-send').click();
  const second = await sessions.create(' second scripted');
  const secondPrompt = `${sessions.prefix} second: S0:plain independent second session`;
  await sendScriptedTurn(page, parity, second, secondPrompt);
  await expect(page.getByTestId('transcript').getByText(firstPrompt, { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('transcript')).not.toContainText(firstAnswer);
  await page.getByTestId(`session-${first.id}`).click();
  await expect(page.getByTestId('transcript').getByText(firstAnswer, { exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('transcript').getByText(secondPrompt, { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('transcript')).not.toContainText(scriptedAnswer);
  await page.reload();
  await page.getByTestId(`session-${second.id}`).click();
  await expect(page.getByTestId('transcript').getByText(scriptedAnswer, { exact: true })).toBeVisible();
  await expect(page.getByTestId('transcript')).not.toContainText(firstAnswer);
  for (const [row, own, foreign, answer] of [[first, firstPrompt, secondPrompt, firstAnswer], [second, secondPrompt, firstPrompt, scriptedAnswer]] as const) {
    // A complete visible delta can precede the engine's terminal message write.
    // Keep both sessions concurrent; wait for the exact durable answer only after reload.
    await expect.poll(async () => {
      const current = await engineMessages(parity, String(row.sdkSessionId));
      const user = current.find(message => message.info.role === 'user' && message.parts.some(part => part.text === own));
      return completed(current).filter(message => message.info.parentID === user?.info.id && message.parts.some(part => part.type === 'text' && part.text?.trim() === answer)).length;
    }, { timeout: 30_000 }).toBe(1);
    const messages = await engineMessages(parity, String(row.sdkSessionId));
    const users = messages.filter(message => message.info.role === 'user' && message.parts.some(part => part.text === own));
    expect(users).toHaveLength(1);
    expect(messages.flatMap(message => message.parts.map(part => part.text))).not.toContain(foreign);
    const answers = completed(messages).filter(message => message.info.parentID === users[0].info.id && message.parts.some(part => part.text?.trim() === answer));
    expect(answers).toHaveLength(1);
    expect(answers[0].info).toMatchObject(scriptedModel);
  }
});

test('[web-parity-090] [P0] conversation: cancel stops an observed real engine turn and restores sending', async ({ page, parity, sessions }) => {
  test.setTimeout(100_000);
  await prepareScriptedModel(parity);
  await sessions.open();
  const row = await sessions.create(' cancellation scripted');
  await page.getByTestId(`session-${row.id}`).click();
  const prompt = `${sessions.prefix}: S0:cancel observed streaming cancellation`;
  const providerStatus = async () => (await fetch('http://127.0.0.1:6996/_s0/status', { signal: AbortSignal.timeout(10_000) })).json() as Promise<{ disconnects: number }>;
  const before = await providerStatus();
  await page.getByTestId('composer-input').fill(prompt);
  await page.getByTestId('composer-send').click();
  const state = async () => {
    const response = await parity.engineFetch('/session/status');
    expect(response.status).toBe(200);
    return (await response.json() as Record<string, { type: string }>)[String(row.sdkSessionId)]?.type ?? 'idle';
  };
  await expect.poll(state, { timeout: 30_000 }).toBe('busy');
  await expect(page.getByTestId('transcript')).toContainText('partial-', { timeout: 30_000 });
  expect(await state()).toBe('busy');
  const cancelled = responseFor(page, 'POST', `/agent-sessions/${row.id}/cancel`);
  await page.getByTestId('composer-cancel').click();
  await assertResponse(await cancelled, 'POST', `/agent-sessions/${row.id}/cancel`, 204);
  await expect.poll(state, { timeout: 30_000 }).toBe('idle');
  await expect.poll(async () => (await providerStatus()).disconnects).toBeGreaterThan(before.disconnects);
  await expect(page.getByTestId('composer-send')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  await expect(page.getByTestId('transcript')).not.toContainText('unexpected-completion');
  const messages = await engineMessages(parity, String(row.sdkSessionId));
  expect(messages.filter(message => message.info.role === 'user' && message.parts.some(part => part.text === prompt))).toHaveLength(1);
  await expect(page.getByTestId('transcript')).toContainText(prompt);
});

test('[web-parity-095] [P0] model router: explicit session model pin serves Luna without a Grid attempt', async ({ page, parity, sessions }) => {
  test.setTimeout(150_000);
  await prepareScriptedModel(parity);
  await sessions.open();
  const row = await sessions.create(' pinned scripted');
  await page.getByTestId('session-actions').click();
  await page.getByTestId('composer-model').selectOption('web-scripted/s0-local');
  const pending = responseFor(page, 'PATCH', `/agent-sessions/${row.id}`);
  await page.getByTestId('model-session-default').click();
  await assertResponse(await pending, 'PATCH', `/agent-sessions/${row.id}`, 200);
  const result = await sendScriptedTurn(page, parity, row, `${sessions.prefix}: S0:plain explicit fixed model`);
  expect(result.answer.info).toMatchObject(scriptedModel);
  expect(parity.rows('SELECT provider_id,model_id,model_mode FROM agent_sessions WHERE id=?', row.id)).toEqual([{ provider_id: 'web-scripted', model_id: 's0-local', model_mode: 'fixed' }]);
  expect(parity.rows('SELECT id FROM agent_router_grid_attempts WHERE session_id=?', row.id), 'explicit fixed model must bypass Grid classification and route application').toEqual([]);
  await page.reload();
  await page.getByTestId(`session-${row.id}`).click();
  await page.getByTestId('session-actions').click();
  await expect(page.getByTestId('composer-model')).toHaveValue('web-scripted/s0-local');
  await expect(page.getByTestId('composer-router-pick')).toHaveCount(0);
  await page.getByTestId('chat-configuration-dialog-close').click();
});
