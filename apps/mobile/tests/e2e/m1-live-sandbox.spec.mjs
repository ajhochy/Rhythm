import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const api = process.env.RHYTHM_LIVE_URL;
const engine = process.env.RHYTHM_LIVE_ENGINE_URL;
const gateway = process.env.RHYTHM_LIVE_GATEWAY_URL;
const sandbox = process.env.RHYTHM_SANDBOX_DIR;
const dbPath = process.env.RHYTHM_LIVE_DB_PATH;
const fixtureRoot = process.env.RHYTHM_APPROVED_FIXTURE_ROOT;
const marker = `M1-LIVE-${randomUUID()}`;

test.skip(
  process.env.RHYTHM_LIVE_E2E !== '1' ||
    process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
    process.env.RHYTHM_M1_LIVE_BROWSER !== '1',
  'The real sandbox mobile browser gate requires explicit isolated opt-in.',
);

function listenerPid(port) {
  const output = execFileSync('/usr/sbin/lsof', [
    '-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN',
  ], { encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(output)) throw new Error(`Port ${port} has no unique listener`);
  return output;
}

function assertOwnedSandbox() {
  const expectedSandbox = '/private/tmp/rhythm-delivery-recovery-sandbox-20261001';
  const expectedFixture = '/private/tmp/rhythm-c1-gap-fixtures-recovery-20261001';
  if (sandbox !== expectedSandbox || fixtureRoot !== expectedFixture ||
    realpathSync(dbPath) !== realpathSync(path.join(sandbox, 'rhythm.db')) ||
    api !== 'http://127.0.0.1:4098' ||
    engine !== 'http://127.0.0.1:4097' ||
    gateway !== 'http://127.0.0.1:4099') {
    throw new Error('M1 live proof requires the exact approved sandbox and fixture paths');
  }
  const apiPid = readFileSync(path.join(sandbox, 'api_server.pid'), 'utf8').trim();
  const enginePid = readFileSync(path.join(sandbox, 'opencode_engine.pid'), 'utf8').trim();
  if (listenerPid(4098) !== apiPid || listenerPid(4099) !== apiPid ||
    listenerPid(4097) !== enginePid) {
    throw new Error('M1 live proof refuses unowned API, gateway, or engine listeners');
  }
  const apiCommand = execFileSync('/bin/ps', ['-o', 'command=', '-p', apiPid], { encoding: 'utf8' });
  const engineCommand = execFileSync('/bin/ps', ['-o', 'command=', '-p', enginePid], { encoding: 'utf8' });
  if (!apiCommand.includes(`--rhythm-sandbox=${sandbox}`) ||
    !apiCommand.includes('/apps/api_server/dist/server.js') ||
    !engineCommand.includes('opencode serve --hostname=127.0.0.1 --port=4097')) {
    throw new Error('M1 live proof refuses a process outside the owned sandbox');
  }
  const configPath = path.join(sandbox, 'home/.config/opencode/opencode.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!config.mcp || Object.keys(config.mcp).length === 0 ||
    !realpathSync(configPath).startsWith(`${realpathSync(sandbox)}/`)) {
    throw new Error('M1 live proof requires the sandbox-local safe OpenCode config');
  }
}

async function startSyntheticProvider(text) {
  let requests = 0;
  let firstRequestAt = null;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/messages') {
      response.writeHead(404).end();
      return;
    }
    requests += 1;
    firstRequestAt ??= Date.now();
    for await (const chunk of request) { void chunk; /* Drain the request. */ }
    const events = [
      { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: 'text', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 5, output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic provider bind failed');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    stats: () => ({ requests, firstRequestAt }),
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function deviceHeaders(token, projectId, json = false) {
  return {
    Authorization: `Device ${token}`,
    'X-Rhythm-Project-ID': projectId,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function readJson(response, label, expectedStatus = 200) {
  expect(response.status, `${label} status`).toBe(expectedStatus);
  return response.json();
}

function watchRelay(token, projectId, sessionId) {
  const controller = new AbortController();
  const events = [];
  let ready;
  let rejectReady;
  const connected = new Promise((resolve, reject) => { ready = resolve; rejectReady = reject; });
  const task = (async () => {
    const response = await fetch(`${gateway}/mobile-gateway/events`, {
      headers: deviceHeaders(token, projectId),
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    ready();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!data) continue;
        try {
          const event = JSON.parse(data);
          const payload = event.payload && typeof event.payload === 'object' ? event.payload : event;
          if (payload.properties?.sessionID === sessionId) {
            events.push({ type: payload.type, at: Date.now() });
          }
        } catch { /* Heartbeats and other non-JSON frames are not evidence. */ }
      }
    }
  })().catch((error) => {
    if (!controller.signal.aborted) rejectReady(error);
  });
  return { events, connected, stop: async () => { controller.abort(); await task.catch(() => undefined); } };
}

test('M1 real sandbox Device relay reaches the mobile transcript after authoritative persistence', async ({ page }) => {
  assertOwnedSandbox();
  const fixtures = JSON.parse(readFileSync(path.join(fixtureRoot, 'devices.json'), 'utf8'));
  const device = fixtures.find((entry) => entry.userId === 1);
  expect(device?.deviceToken).toMatch(/^[A-Za-z0-9_-]{40,128}$/);

  const projectRoot = path.join(sandbox, `m1-live-${randomUUID()}`);
  mkdirSync(projectRoot, { recursive: false });
  const providerName = `synthetic-m1-${randomUUID().slice(0, 8)}`;
  const provider = await startSyntheticProvider(marker);
  const globalConfigPath = path.join(sandbox, 'home/.config/opencode/opencode.json');
  const originalGlobalConfig = readFileSync(globalConfigPath);
  let globalProviderInstalled = false;
  let projectId;
  let sessionId;
  let relay;
  const cleanupEvidence = {};
  try {
    const project = await readJson(await fetch(`${api}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `M1 live ${marker}`, cwd: projectRoot }),
    }), 'project create', 201);
    projectId = project.id;

    await readJson(await fetch(`${engine}/global/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: { [providerName]: {
        npm: '@ai-sdk/anthropic',
        options: { apiKey: 'm1-synthetic-only', baseURL: `${provider.origin}/v1` },
        models: { text: { name: 'M1 synthetic text', attachment: false, modalities: { input: ['text'], output: ['text'] }, limit: { context: 200000, output: 4000 } } },
      } } }),
    }), 'sandbox-global model config');
    globalProviderInstalled = true;
    const providerCatalog = await readJson(await fetch(`${engine}/config/providers?directory=${encodeURIComponent(projectRoot)}`), 'project provider catalog');
    cleanupEvidence.syntheticProviderPresentBefore = providerCatalog.providers.some((entry) => entry.id === providerName);
    expect(cleanupEvidence.syntheticProviderPresentBefore).toBe(true);

    const health = await readJson(await fetch(`${gateway}/mobile-gateway/health`), 'gateway health');
    const session = await readJson(await fetch(`${gateway}/mobile-gateway/opencode/session`, {
      method: 'POST',
      headers: deviceHeaders(device.deviceToken, projectId, true),
      body: JSON.stringify({ title: `M1 live ${marker}` }),
    }), 'Device session create');
    sessionId = session.id;
    const projects = await readJson(await fetch(`${gateway}/mobile-gateway/projects`, {
      headers: deviceHeaders(device.deviceToken, projectId),
    }), 'Device project catalog');
    expect(projects.projects.map((entry) => entry.id)).toContain(projectId);

    const host = {
      rhythmUserId: 1,
      gatewayUrl: 'https://rhythm-m1-live.tail1234.ts.net',
      deviceId: device.deviceId,
      hostId: health.hostId,
      deviceName: 'M1 isolated browser fixture',
      gatewayVersion: health.gatewayVersion,
      rhythmVersion: health.rhythmVersion,
      opencodeVersion: health.opencodeVersion,
      contractFingerprint: health.contractFingerprint,
      minimumMobileVersion: health.minimumMobileVersion,
      features: health.features,
      pairedAt: new Date().toISOString(),
    };
    await page.addInitScript(({ bridge, hostMeta }) => {
      window.__RHYTHM_LIVE_M1_BRIDGE__ = bridge;
      localStorage.setItem('rhythm.paired.host.meta', JSON.stringify(hostMeta));
    }, {
      bridge: { userId: 1, deviceToken: device.deviceToken, gatewayBaseUrl: gateway },
      hostMeta: host,
    });
    const browserReads = [];
    const browserGatewayResponses = [];
    let browserRelayConnectedAt = null;
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/mobile-gateway/')) {
        browserGatewayResponses.push({ path: url.pathname, status: response.status() });
      }
      if (url.pathname === '/mobile-gateway/events' && response.status() === 200) {
        browserRelayConnectedAt ??= Date.now();
      }
      if (url.pathname === `/mobile-gateway/opencode/session/${sessionId}/message` && response.status() === 200) {
        const at = Date.now();
        void response.json().then((records) => {
          const assistant = records.find((record) => record.info?.role === 'assistant' &&
            record.parts?.some((part) => part.type === 'text' && part.text.includes(marker)));
          browserReads.push({ at, terminal: Boolean(assistant?.info?.time?.completed), createdAt: assistant?.info?.time?.created ?? null });
        }).catch(() => undefined);
      }
    });

    relay = watchRelay(device.deviceToken, projectId, sessionId);
    await relay.connected;
    await page.goto('/');
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByLabel('Paired Mac status: Connected').last()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'Chats' }).click();
    await page.getByRole('button', { name: 'Chats menu', exact: true }).locator('visible=true').click();
    await page.getByRole('menuitem', { name: 'All chat states', exact: true }).locator('visible=true').click();
    const collapsedGroup = page.getByRole('button', { name: /M1 live.*collapsed/ }).locator('visible=true');
    if (await collapsedGroup.count()) await collapsedGroup.click();
    await page.getByTestId(`chat-row-open-${sessionId}`).locator('visible=true').click();
    try {
      await expect(page.getByTestId('chat-transcript').locator('visible=true')).toBeVisible({ timeout: 30_000 });
    } catch (error) {
      console.log('M1 live browser gateway paths', JSON.stringify(browserGatewayResponses));
      throw error;
    }

    const submittedAt = Date.now();
    const promptResponse = await fetch(`${gateway}/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      method: 'POST',
      headers: deviceHeaders(device.deviceToken, projectId, true),
      body: JSON.stringify({
        agent: 'build',
        model: { providerID: providerName, modelID: 'text' },
        parts: [{ type: 'text', text: 'Return your configured fixed M1 proof text.' }],
      }),
    });
    expect(promptResponse.status).toBe(204);

    await expect(page.getByTestId('chat-transcript').locator('visible=true')).toContainText(marker, { timeout: 45_000 });
    const firstStreamedVisibleAt = Date.now();
    await expect.poll(() => browserReads.some((read) => read.terminal && read.createdAt != null), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => relay.events.some((event) => event.type === 'session.idle'), { timeout: 15_000 }).toBe(true);
    await expect(page.getByTestId('chat-transcript').locator('visible=true')).toContainText(marker);
    await expect(page.getByTestId('chat-transcript').locator('visible=true').getByText(marker, { exact: true })).toHaveCount(1);
    const postGetRenderedAt = Date.now();
    expect(browserRelayConnectedAt).not.toBeNull();
    expect(provider.stats().requests).toBe(1);

    const authoritative = await readJson(await fetch(`${gateway}/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}/message`, {
      headers: deviceHeaders(device.deviceToken, projectId),
    }), 'authoritative Device GET');
    const final = authoritative.find((record) => record.info?.role === 'assistant' &&
      record.parts?.some((part) => part.type === 'text' && part.text.includes(marker)));
    expect(final?.info?.time?.completed).toBeTruthy();
    const finalBrowserRead = browserReads.find((read) => read.terminal);
    expect(finalBrowserRead.at).toBeLessThanOrEqual(postGetRenderedAt);
    expect(finalBrowserRead.createdAt).toBeLessThanOrEqual(finalBrowserRead.at);

    // All values are synthetic timing evidence. `createdAt` is engine metadata,
    // not a storage-commit clock. The GET-to-UI-check interval is observed;
    // the cache commit itself is not instrumented and may follow an SSE update.
    console.log('M1 live chronology', JSON.stringify({
      submittedAt,
      providerRequestAt: provider.stats().firstRequestAt,
      browserRelayConnectedAt,
      relayEvents: relay.events,
      firstFinalBrowserGetAt: finalBrowserRead.at,
      engineCreatedAt: finalBrowserRead.createdAt,
      firstStreamedVisibleAt,
      postGetRenderedAt,
      observedGetToUiCheckInterval: [finalBrowserRead.at, postGetRenderedAt],
    }));
  } finally {
    if (relay) await relay.stop();
    const cleanupFailures = [];
    try {
      if (sessionId && projectId) {
        try {
          const removedSession = await fetch(`${gateway}/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE', headers: deviceHeaders(device.deviceToken, projectId),
          });
          cleanupEvidence.sessionDeleteStatus = removedSession.status;
          expect([200, 204]).toContain(removedSession.status);
          const absentSession = await fetch(`${engine}/session/${encodeURIComponent(sessionId)}?directory=${encodeURIComponent(projectRoot)}`);
          cleanupEvidence.sessionReadbackStatus = absentSession.status;
          expect(absentSession.status).toBe(404);
        } catch (error) { cleanupFailures.push(`session: ${error.message}`); }
      }
      if (projectId) {
        try {
          const removedProject = await fetch(`${api}/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
          cleanupEvidence.projectDeleteStatus = removedProject.status;
          expect(removedProject.status).toBe(204);
          const absentProject = await fetch(`${api}/projects/${encodeURIComponent(projectId)}`);
          cleanupEvidence.projectReadbackStatus = absentProject.status;
          expect(absentProject.status).toBe(404);
        } catch (error) { cleanupFailures.push(`project: ${error.message}`); }
      }
      if (globalProviderInstalled) {
        try {
          writeFileSync(globalConfigPath, originalGlobalConfig);
          cleanupEvidence.providerBytesRestored = readFileSync(globalConfigPath).equals(originalGlobalConfig);
          expect(cleanupEvidence.providerBytesRestored).toBe(true);
          // Global dispose releases instances but does not invalidate the
          // memoized config. Reload reads the restored sandbox file anew.
          const reloaded = await fetch(`${engine}/config/reload?directory=${encodeURIComponent(sandbox)}`, { method: 'POST' });
          expect(reloaded.status).toBe(200);
          const restoredConfig = await readJson(await fetch(`${engine}/global/config`), 'restored global config');
          cleanupEvidence.syntheticProviderAbsentAtRuntime = !Object.hasOwn(restoredConfig.provider ?? {}, providerName);
          expect(cleanupEvidence.syntheticProviderAbsentAtRuntime).toBe(true);
        } catch (error) { cleanupFailures.push(`provider: ${error.message}`); }
      }
    } finally {
      await provider.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
    console.log('M1 live cleanup', JSON.stringify(cleanupEvidence));
    if (cleanupFailures.length) throw new Error(`M1 live fixture cleanup failed: ${cleanupFailures.join('; ')}`);
  }
});
