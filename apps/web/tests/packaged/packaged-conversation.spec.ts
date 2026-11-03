import { test, expect, API, ENGINE, responseFor, assertResponse, type Row } from './feature-test';
import { test as gap } from '@playwright/test';

function modelOptIn() {
  expect(process.env.RHYTHM_FEATURE_MODEL, 'UNVERIFIED: real-model conversation checks require RHYTHM_FEATURE_MODEL=1').toBe('1');
}

async function engineMessages(row: Row, directory: string) {
  expect(row.sdkSessionId, 'UNVERIFIED: new session has no real engine identity').toEqual(expect.any(String));
  const response = await fetch(`${ENGINE}/session/${row.sdkSessionId}/message?directory=${encodeURIComponent(directory)}&limit=50`, { signal: AbortSignal.timeout(20_000) });
  expect(response.status).toBe(200);
  return await response.json() as Array<{ info: { role: string; providerID?: string; modelID?: string }; parts: Array<{ type: string; text?: string }> }>;
}

test('[P0] conversation: real answer, canonical transcript and reload agree without duplicate user messages', async ({ page, sessions }) => {
  // Catches optimistic success without provider execution and confirmed user messages reappearing below the reply (#1582/721b56d5).
  test.setTimeout(240_000); modelOptIn();
  await sessions.open();
  const row = await sessions.create(' model');
  await page.getByTestId(`session-${row.id}`).click();
  const prompt = `${sessions.prefix}: Compute 37 + 54. Reply with only the result as digits. Do not use tools.`;
  await page.getByTestId('composer-input').fill(prompt);
  await page.getByTestId('composer-send').click();
  await expect(page.getByTestId('transcript').getByText('91', { exact: true })).toBeVisible({ timeout: 180_000 });
  // A streamed UI token can arrive before the engine's durable part update.
  await expect.poll(async () => (await engineMessages(row, sessions.directory!)).some(message => message.info.role === 'assistant' && message.parts.some(part => part.type === 'text' && part.text?.trim() === '91')), { timeout: 30_000 }).toBe(true);
  const messages = await engineMessages(row, sessions.directory!);
  const user = messages.filter(message => message.info.role === 'user' && message.parts.some(part => part.text === prompt));
  expect(user, 'engine must store exactly one copy of this prompt').toHaveLength(1);
  expect(messages.some(message => message.info.role === 'assistant' && message.parts.some(part => part.type === 'text' && part.text?.trim() === '91'))).toBe(true);
  expect(messages.find(message => message.info.role === 'assistant')?.info).toMatchObject({ providerID: expect.any(String), modelID: expect.any(String) });
  await expect.poll(async () => {
    const body = await sessions.api!.json<{ messages: Array<{ rawText: string }> }>(`/agent-sessions/${row.id}`);
    return body.messages.some(message => message.rawText.trim() === '91');
  }, { timeout: 30_000 }).toBe(true);
  const detail = await sessions.api!.json<{ session: Row; messages: Array<{ role: string; rawText: string }> }>(`/agent-sessions/${row.id}`);
  expect(detail.session).toMatchObject({ id: row.id, name: row.name });
  expect(detail.messages.filter(message => message.rawText === prompt)).toHaveLength(1);
  expect(detail.messages.some(message => message.rawText.trim() === '91')).toBe(true);
  await page.reload();
  await page.getByTestId(`session-${row.id}`).click();
  await expect(page.getByTestId('transcript').getByText(prompt, { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('transcript').getByText('91', { exact: true })).toBeVisible();
  const order = await page.getByTestId('transcript').innerText();
  expect(order.indexOf(prompt)).toBeLessThan(order.lastIndexOf('91'));
});

gap('[P0] conversation: UNVERIFIED reconnect and paged older history preserve one canonical transcript', () => {
  // Would catch lost deltas or duplicate/reordered rows after disconnect and older-page reconciliation.
  throw new Error('UNVERIFIED: arithmetic/reload does not exercise event loss or an older-history cursor — requires a nonce-owned long transcript and controlled stream disconnect/reconnect with API/engine/UI order and page-boundary assertions');
});

test('[P0] conversation: blank send and discarded draft leave the backend transcript unchanged', async ({ page, sessions }) => {
  // Catches empty sends allocating turns and reload persisting an unsent draft as if the model had received it.
  await sessions.open();
  const row = await sessions.create(' empty composer');
  await page.getByTestId(`session-${row.id}`).click();
  const before = await sessions.api!.json<{ messages: unknown[] }>(`/agent-sessions/${row.id}`);
  await page.getByTestId('composer-input').fill('   ');
  await page.getByTestId('composer-send').click();
  await page.getByTestId('composer-input').fill(`${sessions.prefix} unsent`);
  await page.reload();
  await page.getByTestId(`session-${row.id}`).click();
  await expect(page.getByTestId('empty-state')).toContainText('Start this conversation');
  await expect(page.getByText(`${sessions.prefix} unsent`, { exact: true })).toHaveCount(0);
  const after = await sessions.api!.json<{ messages: unknown[] }>(`/agent-sessions/${row.id}`);
  expect(after.messages).toEqual(before.messages);
  const health = await fetch(`${API}/health`); expect(await health.json()).toMatchObject({ status: 'ok' });
});

test('[P0] conversation: two owned sessions retain independent answers across switching and reload', async ({ page, sessions }) => {
  // Catches one session's in-flight events or cached transcript being applied to a different selected session.
  test.setTimeout(360_000); modelOptIn();
  await sessions.open();
  const first = await sessions.create(' first');
  const firstPrompt = `${sessions.prefix} first: Compute 101 + 202. Reply only with digits. Do not use tools.`;
  await page.getByTestId('composer-input').fill(firstPrompt);
  await page.getByTestId('composer-send').click();
  const second = await sessions.create(' second');
  const secondPrompt = `${sessions.prefix} second: Compute 17 + 25. Reply only with digits. Do not use tools.`;
  await page.getByTestId('composer-input').fill(secondPrompt);
  await page.getByTestId('composer-send').click();
  await expect(page.getByTestId('transcript').getByText('42', { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('transcript').getByText(firstPrompt, { exact: true })).toHaveCount(0);
  await page.getByTestId(`session-${first.id}`).click();
  await expect(page.getByTestId('transcript').getByText('303', { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('transcript').getByText(secondPrompt, { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByTestId(`session-${second.id}`).click();
  await expect(page.getByTestId('transcript').getByText('42', { exact: true })).toBeVisible();
  for (const [row, own, foreign, answer] of [[first, firstPrompt, secondPrompt, '303'], [second, secondPrompt, firstPrompt, '42']] as const) {
    const messages = await engineMessages(row, sessions.directory!);
    const text = messages.flatMap(message => message.parts.map(part => part.text ?? ''));
    expect(text).toContain(own); expect(text).not.toContain(foreign);
    expect(text.some(value => value.trim() === answer)).toBe(true);
  }
});

test('[P0] conversation: cancel stops an observed real engine turn and restores sending', async ({ page, sessions }) => {
  // Catches a cosmetic Cancel that leaves the provider running or a stale busy flag that permanently disables the composer.
  test.setTimeout(180_000); modelOptIn();
  await sessions.open();
  const row = await sessions.create(' cancellation');
  await page.getByTestId(`session-${row.id}`).click();
  const prompt = `${sessions.prefix}: Write every integer from 1 through 10000 separated by commas. Start immediately and do not use tools.`;
  await page.getByTestId('composer-input').fill(prompt);
  await page.getByTestId('composer-send').click();
  const state = async () => {
    const response = await fetch(`${ENGINE}/session/status?directory=${encodeURIComponent(sessions.directory!)}`, { signal: AbortSignal.timeout(20_000) });
    expect(response.status).toBe(200);
    const statuses = await response.json() as Record<string, { type: string }>;
    return statuses[String(row.sdkSessionId)]?.type ?? 'idle';
  };
  await expect.poll(state, { timeout: 30_000, message: 'the real engine must observe this turn as busy before Cancel is exercised' }).toBe('busy');
  await expect(page.getByTestId('transcript')).toContainText(/1,\s*2,\s*3/, { timeout: 30_000 });
  expect(await state(), 'rendered output must arrive while the real engine is still busy').toBe('busy');
  const cancelled = responseFor(page, 'POST', `/agent-sessions/${row.id}/cancel`);
  await page.getByTestId('composer-cancel').click();
  await assertResponse(await cancelled, 'POST', `/agent-sessions/${row.id}/cancel`, 204);
  await expect.poll(state, { timeout: 30_000 }).toBe('idle');
  await expect(page.getByTestId('composer-send')).toBeVisible();
  const messages = await engineMessages(row, sessions.directory!);
  expect(messages.filter(message => message.info.role === 'user' && message.parts.some(part => part.text === prompt))).toHaveLength(1);
  await expect(page.getByTestId('transcript')).toContainText(prompt);
});
