import path from 'node:path';
import { test, expect } from './fixture';

// Catches token guards, wrong WS origin, lost stream frames, and non-durable browser transcripts.
test('A2: project session streams over same-origin WS and survives reload plus Node readback', async ({ page, api, apiBase }, testInfo) => {
  test.setTimeout(120_000);
  const cwd = path.resolve(import.meta.dirname, '../../../../');
  const providerId = 'web-scripted';
  const profiles = await api('/agent-configs');
  const profile = profiles.find((row: any) => row.id === 'local-lean') ?? profiles.find((row: any) => row.enabled && !row.locked && row.sessionSelectable !== false);
  expect(profile).toBeTruthy();
  // L1: both provider and profile are provisioned before up; config writes reload the engine.
  expect(profile).toMatchObject({ modelProvider: providerId, modelId: 's0-local' });
  await expect.poll(async () => { try { return (await api('/opencode/health')).status; } catch { return 'unreachable'; } }, { timeout: 30_000 }).toBe('ready');
  const project = await api('/projects', { method: 'POST', body: JSON.stringify({ name: 'Web acceptance project', cwd }) });
  const created = await api('/agent-sessions', { method: 'POST', body: JSON.stringify({ name: 'Web acceptance stream', cwd, projectId: project.id, profileId: profile.id, isolateWorktree: false }) });
  expect(created.id).toBeTruthy();
  const frames: string[] = [];
  const sockets: string[] = [];
  page.on('websocket', socket => {
    sockets.push(socket.url());
    socket.on('framereceived', event => frames.push(String(event.payload)));
  });
  await page.goto('/#/agents');
  await page.getByTestId(`session-${created.id}`).click();
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  await page.getByTestId('composer-input').fill('S0:plain browser acceptance');
  await page.getByTestId('composer-send').click();
  await expect(page.getByTestId('transcript')).toContainText('hello hello 🌱', { timeout: 40_000 });
  expect(sockets).toContain('ws://rhythm-web.test:4098/ws/agents');
  expect(sockets.every(url => url === 'ws://rhythm-web.test:4098/ws/agents')).toBe(true);
  expect(frames.some(frame => frame.includes('hello'))).toBe(true);
  // U2: text arriving is not proof of a finished turn. Save evidence even on failure.
  try {
    await expect(page.getByTestId('composer-send')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('composer-cancel')).toHaveCount(0);
    await expect(page.locator('.session-header .status-label')).toHaveText('Idle');
    await expect.poll(async () => (await api(`/agent-sessions/${created.id}`)).session.status).toBe('idle');
    expect(frames.map(frame => JSON.parse(frame)).some(event => event.type === 'session.status' && event.id === created.id && event.status === 'idle' && event.working === false)).toBe(true);
  } finally {
    const detail = await api(`/agent-sessions/${created.id}`);
    const provider = await fetch('http://127.0.0.1:6996/_s0/status').then(response => response.json());
    console.log('U2 readback', JSON.stringify({ status: detail.session.status, provider, statuses: frames.map(frame => JSON.parse(frame)).filter(event => event.type === 'session.status' && event.id === created.id) }));
    await testInfo.attach('turn-completion', { body: JSON.stringify({ frames, detail, provider }), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath('turn-completion.png'), fullPage: true });
  }
  await page.reload();
  await page.getByTestId(`session-${created.id}`).click();
  await expect(page.getByTestId('transcript')).toContainText('hello hello 🌱');
  await expect(page.getByTestId('composer-send')).toBeVisible();
  await expect(page.locator('.session-header .status-label')).toHaveText('Idle');
  await expect(page.getByTestId('environment-receipt')).toContainText('Environment: Live', { timeout: 20_000 });
  const detail = await api(`/agent-sessions/${created.id}?transcriptLimit=50`);
  expect(detail.session.id).toBe(created.id);
  expect(detail.session.projectId).toBe(project.id);
  expect(detail.session.status).toBe('idle');
  const messages = await api(`/agent-sessions/${created.id}/messages?limit=50`);
  expect(JSON.stringify(messages)).toContain('hello hello 🌱');
  await page.screenshot({ path: testInfo.outputPath('A2-persisted-transcript.png'), fullPage: true });
  await testInfo.attach('backend-readback', { body: JSON.stringify({ sessionId: created.id, projectId: project.id, messages }), contentType: 'application/json' });
});
