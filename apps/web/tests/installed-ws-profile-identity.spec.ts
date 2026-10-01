import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:4098';

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(API + path, { method, signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

test('rendered composer sends selected Rhythm profile ID separately from engine alias for text and image', async ({ page }) => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Requires the owned real API + engine sandbox');
  const sb = process.env.RHYTHM_SANDBOX_DIR ?? '';
  expect(process.env.RHYTHM_LIVE_E2E_ISOLATED).toBe('1');
  expect(sb).toMatch(/^\/private\/tmp\/rhythm-/);
  expect(realpathSync(sb)).toBe(sb);
  expect(resolve(process.env.DB_PATH ?? '')).toBe(join(sb, 'rhythm.db'));
  expect(await api('/opencode/health')).toMatchObject({ status: 'ready' });

  const marker = randomUUID();
  const baseProfileId = `synthetic-ws-base-${marker}`;
  const selectedProfileId = `synthetic-ws-selected-${marker}`;
  let sessionId = '';
  const frames: Array<Record<string, unknown>> = [];
  try {
    for (const [id, label] of [[baseProfileId, 'Base'], [selectedProfileId, 'Selected']]) {
      await api('/agent-configs', 'POST', { id, label: `${label} synthetic WS ${marker}`, enabled: true,
        isAgent: true, sessionSelectable: true, ocAgent: 'build', allowedMcpsJson: '[]',
        allowedSkillsJson: '[]', corePermissionsJson: '{"*":"deny"}' });
    }
    const session = await api<{ id: string }>('/agent-sessions', 'POST', {
      name: `Synthetic WS ${marker}`, profileId: baseProfileId, cwd: sb, isolateWorktree: false,
    });
    sessionId = session.id;

    // Intercept at the browser socket. The real API creates/reads the fixture,
    // while no frame reaches the provider during this sender-shape test.
    await page.routeWebSocket(/\/ws\/agents$/, ws => {
      ws.onMessage(data => {
        const frame = JSON.parse(String(data)) as Record<string, unknown>;
        if (frame.type !== 'session.input') return;
        frames.push(frame);
        ws.send(JSON.stringify({ v: 1, type: 'session.status', id: frame.id, working: false }));
      });
    });
    await page.goto(`/#/agents?sessionId=${sessionId}`);
    await expect(page.getByTestId('composer-profile')).toBeVisible();
    await page.getByTestId('composer-profile').selectOption(selectedProfileId);
    await page.getByTestId('agent-this-turn').click();
    await page.getByTestId('composer-input').fill(`Text ${marker}`);
    await page.getByTestId('composer-send').click();
    await expect.poll(() => frames.length).toBe(1);
    expect(frames[0]).toMatchObject({ id: sessionId, profileId: selectedProfileId, agent: 'build', data: `Text ${marker}` });

    await page.getByTestId('composer-profile').selectOption(selectedProfileId);
    await page.getByTestId('agent-this-turn').click();
    await page.getByTestId('composer-live-file-input').setInputFiles({
      name: 'synthetic.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9x0s8AAAAASUVORK5CYII=', 'base64'),
    });
    await page.getByTestId('composer-input').fill(`Image ${marker}`);
    await page.getByTestId('composer-send').click();
    await expect.poll(() => frames.length).toBe(2);
    expect(frames[1]).toMatchObject({ id: sessionId, profileId: selectedProfileId, agent: 'build',
      parts: [{ type: 'text', text: `Image ${marker}` }, expect.objectContaining({ type: 'file', mime: 'image/png' })] });
    expect((frames[1].parts as Array<{ url?: string }>)[1]?.url).toMatch(/^data:image\/png;base64,/);
  } finally {
    if (sessionId) await api(`/agent-sessions/${sessionId}/hard`, 'DELETE');
    await api(`/agent-configs/${selectedProfileId}`, 'DELETE').catch(() => undefined);
    await api(`/agent-configs/${baseProfileId}`, 'DELETE').catch(() => undefined);
  }
});
