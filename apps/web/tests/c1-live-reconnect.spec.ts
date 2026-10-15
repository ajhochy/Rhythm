import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { startC1Provider } from '../../api_server/src/__tests__/_c1_synthetic_provider';

const API = 'http://127.0.0.1:4098';
const ENGINE = 'http://127.0.0.1:4097';
type Task = { id: string; enabled: boolean; lastRunStatus: string | null };
type Run = { id: string; status: string; rootSessionId: string };

async function api<T>(path: string, method = 'GET', body?: unknown, base = API): Promise<T> {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

test('C1 real browser reconnect preserves one manual run, disabled recurrence, and its assistant reply', async ({ page, context }) => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires the owned real API + engine sandbox');
  const sb = process.env.RHYTHM_SANDBOX_DIR ?? '';
  expect(process.env.RHYTHM_LIVE_E2E_ISOLATED).toBe('1');
  expect(sb).toMatch(/^\/private\/tmp\/rhythm-/);
  expect(realpathSync(sb)).toBe(sb);
  expect(resolve(process.env.DB_PATH ?? '')).toBe(join(sb, 'rhythm.db'));
  expect(await api('/opencode/health')).toMatchObject({ status: 'ready' });
  const marker = `C1-${randomUUID()}`;
  const profile = `synthetic-browser-${randomUUID()}`;
  const provider = await startC1Provider();
  let task: Task | undefined;
  let root: string | undefined;
  try {
    await api('/global/config', 'PATCH', { provider: { [profile]: {
      npm: '@ai-sdk/anthropic', options: { apiKey: 'synthetic-only', baseURL: `${provider.origin}/v1` },
      models: { text: { name: 'Synthetic browser text', limit: { context: 200000, output: 1000 } } },
    } } }, ENGINE);
    await api(`/opencode/auth/${profile}`, 'POST', { apiKey: 'synthetic-only' });
    await api('/system/refresh', 'POST');
    await api('/agent-configs', 'POST', { id: profile, label: 'Synthetic browser verification', isAgent: true,
      enabled: true, ocAgent: 'build', modelProvider: profile, modelId: 'text', schedulable: true,
      allowedMcpsJson: '[]', allowedSkillsJson: '[]', allowedDelegatesJson: '[]',
      corePermissionsJson: '{"*":"deny"}', systemPrompt: 'Return only the requested marker. Never use tools.' });
    task = await api<Task>('/agent-schedules', 'POST', { name: `Browser reconnect ${marker}`,
      scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z', agentConfigId: profile,
      prompt: `Reply exactly ${marker}. Never use tools or delegate.` });
    await api(`/agent-schedules/${task.id}`, 'PATCH', { enabled: false });
    // All browser requests go to the real sandbox; there are no route interceptors.
    await page.goto('/#/tools/tasks');
    await page.getByRole('option', { name: new RegExp(marker) }).click();
    await expect(page.getByTestId('schedule-toggle')).toHaveText('Enable');
    await page.getByTestId('schedule-trigger').click();
    await expect(page.getByTestId('schedule-trigger')).toBeDisabled();
    await expect.poll(() => provider.holds.get(marker)?.state, { timeout: 90_000 }).toBe('held');
    await expect(page.getByTestId('schedule-progress')).toContainText('running');
    await context.setOffline(true);
    await expect(page.getByTestId('schedule-refresh-error')).toBeVisible();
    await expect(page.getByTestId('schedule-progress')).toContainText('running');
    await context.setOffline(false);
    await page.getByTestId('schedules-refresh').click();
    await expect(page.getByTestId('schedule-refresh-error')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('schedule-progress')).toContainText('running');
    await fetch(`${provider.origin}/c1/holds/${marker}/release`, { method: 'POST' });
    await expect(page.getByTestId('schedule-progress')).toContainText('completed_no_op', { timeout: 30_000 });
    const runs = await api<Run[]>(`/agent-schedules/${task.id}/runs`);
    expect(runs).toHaveLength(1);
    expect(provider.holds.get(marker)?.requests).toBe(1);
    expect(await api<Task>(`/agent-schedules/${task.id}`)).toMatchObject({ enabled: false, lastRunStatus: 'completed_no_op' });
    root = runs[0].rootSessionId;
    await page.getByTestId(`schedule-run-${runs[0].id}`).click();
    await expect(page.getByTestId('transcript').locator('article.message.assistant')).toContainText(marker);
    await page.reload();
    await expect(page.getByTestId('transcript').locator('article.message.assistant')).toContainText(marker);
    expect(await api<Run[]>(`/agent-schedules/${task.id}/runs`)).toEqual(runs);
  } finally {
    await context.setOffline(false);
    if (task) await api(`/agent-schedules/${task.id}`, 'DELETE');
    if (root) await api(`/agent-sessions/${root}/hard`, 'DELETE');
    await api(`/agent-configs/${profile}`, 'DELETE').catch(() => undefined);
    await provider.close();
  }
});
