import { test, expect, request as http } from '@playwright/test';

test('E24-c11 safe real pending list and child read without a provider prompt', async ({ page }) => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Uses existing manager-owned sandbox4098/4097; never starts it');
  const api = await http.newContext({ baseURL: 'http://127.0.0.1:4098' });
  const engine = await http.newContext({ baseURL: 'http://127.0.0.1:4097' });
  try {
    const health = await api.get('/opencode/health');
    expect(health.status()).toBe(200); expect(await health.json()).toMatchObject({ status: 'ready' });
    const list = await api.get('/agent-sessions'); expect(list.status()).toBe(200);
    const body = await list.json(); const rows = Array.isArray(body) ? body : body.sessions;
    expect(Array.isArray(rows)).toBe(true);
    const selected = rows.find((row: { sdkSessionId?: string }) => row.sdkSessionId) ?? rows[0];
    expect(selected, 'Existing sandbox session required; this check never creates one').toBeTruthy();
    const permissions = await api.get(`/agent-sessions/${encodeURIComponent(selected.id)}/pending-permissions`);
    expect(permissions.status()).toBe(200); const pendingPermissions = await permissions.json(); expect(Array.isArray(pendingPermissions)).toBe(true);
    const questions = await engine.get(`/question?directory=${encodeURIComponent(selected.cwd)}`);
    expect(questions.status()).toBe(200); const pendingQuestions = await questions.json(); expect(Array.isArray(pendingQuestions)).toBe(true);
    const writes: string[] = []; const inputs: string[] = [];
    page.on('request', request => { if (/127\.0\.0\.1:(4098|4097)/.test(request.url()) && !['GET', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
    page.on('websocket', socket => socket.on('framesent', frame => { if (String(frame.payload).includes('session.input') || String(frame.payload).includes('session.command')) inputs.push(String(frame.payload)); }));
    await page.route('https://e24.invalid/**', route => route.fulfill({ json: [] }));
    await page.addInitScript(id => localStorage.setItem('rhythm-agents-live-selected-session', id), selected.id);
    const permissionRead = page.waitForResponse(response => response.url().endsWith(`/${selected.id}/pending-permissions`) && response.status() === 200);
    await page.goto('/tests/electron-e22-harness.html'); await permissionRead;
    await expect(page.getByTestId('state')).toContainText(`"id":"${selected.id}"`);
    await expect(page.getByTestId('permission-card')).toHaveCount(pendingPermissions.length);
    await expect(page.getByTestId('question-card')).toHaveCount(pendingQuestions.filter((row: { sessionID: string }) => row.sessionID === selected.sdkSessionId).length);
    let childRead = false;
    if (selected.sdkSessionId) {
      const children = await engine.get(`/session/${encodeURIComponent(selected.sdkSessionId)}/children?directory=${encodeURIComponent(selected.cwd)}`);
      expect(children.status()).toBe(200);
      const childrenRows = await children.json(); expect(Array.isArray(childrenRows)).toBe(true);
      if (childrenRows[0]) {
        const child = await api.get(`/agent-sessions/${encodeURIComponent(selected.id)}/children/${encodeURIComponent(childrenRows[0].id)}/messages`);
        expect(child.status()).toBe(200); expect(Array.isArray((await child.json()).messages)).toBe(true); childRead = true;
      }
    }
    expect(writes).toEqual([]); expect(inputs).toEqual([]);
    console.log(`E24 live: pending permissions=${pendingPermissions.length}, questions=${pendingQuestions.length}; real renderer selected existing session; child read=${childRead ? 'passed' : 'unavailable, list/read fallback only'}; no writes/prompts`);
  } finally { await api.dispose(); await engine.dispose(); }
});
