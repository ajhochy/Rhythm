import { test, expect, request as http } from '@playwright/test';

test('E25A-c8 safe real sandbox detail and event read without provider input', async ({ page }) => {
  test.skip(process.env.RHYTHM_LIVE_E2E !== '1', 'Read-only manager-owned sandbox');
  const api = await http.newContext({ baseURL: 'http://127.0.0.1:4098' });
  try {
    const health = await api.get('/opencode/health');
    expect(health.status()).toBe(200); expect(await health.json()).toMatchObject({ status: 'ready' });
    const list = await api.get('/agent-sessions'); expect(list.status()).toBe(200);
    const rows = (await list.json()).sessions;
    expect(Array.isArray(rows)).toBe(true);
    let detail: { session: { id: string }; messages: unknown[] } | undefined;
    for (const row of rows.slice(0, 10)) {
      const response = await api.get(`/agent-sessions/${encodeURIComponent(row.id)}?transcriptLimit=50`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body.messages)).toBe(true);
      detail = body;
      if (body.messages.length) break;
    }
    expect(detail, 'Existing manager-owned session required; never create one').toBeTruthy();
    const writes: string[] = []; const sent: string[] = []; const received: string[] = [];
    page.on('request', request => { if (/127\.0\.0\.1:(4098|4097)/.test(request.url()) && !['GET', 'OPTIONS'].includes(request.method())) writes.push(request.method()); });
    page.on('websocket', socket => { socket.on('framesent', frame => sent.push(String(frame.payload))); socket.on('framereceived', frame => { try { received.push(JSON.parse(String(frame.payload)).type); } catch { /* no payload logging */ } }); });
    await page.route('https://e25a.invalid/**', route => route.fulfill({ json: [] }));
    await page.addInitScript(id => localStorage.setItem('rhythm-agents-live-selected-session', id), detail!.session.id);
    const read = page.waitForResponse(response => response.url().includes(`/${detail!.session.id}?transcriptLimit=50`) && response.status() === 200);
    await page.goto('/tests/electron-e22-harness.html'); await read;
    await expect(page.getByTestId('state')).toContainText(`"id":"${detail!.session.id}"`);
    const state = JSON.parse(await page.getByTestId('state').innerText());
    expect(state.selected.messages.length).toBe(detail!.messages.length);
    // Initial hydration need not emit session.subscribe. Read the real event
    // surface directly; never manufacture model output or alter the sandbox.
    const eventRead = await page.evaluate(async () => {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch('http://127.0.0.1:4097/event', { signal: controller.signal });
        const reader = response.body!.getReader(); const first = await reader.read();
        await reader.cancel();
        return { status: response.status, contentType: response.headers.get('content-type'), text: new TextDecoder().decode(first.value) };
      } finally { clearTimeout(timer); controller.abort(); }
    });
    expect(eventRead.status).toBe(200); expect(eventRead.contentType).toContain('text/event-stream');
    expect(eventRead.text).toContain('server.connected');
    expect(writes).toEqual([]);
    expect(sent.filter(frame => ['session.input', 'session.command'].includes(JSON.parse(frame).type))).toEqual([]);
    console.log(`E25A live: ready; detail messages=${detail!.messages.length}; rendered messages=${state.selected.messages.length}; real SSE server.connected; socket frame types=${[...new Set(received)].join(',') || 'none during bounded read'}; no writes/provider prompts`);
  } finally { await api.dispose(); }
});
