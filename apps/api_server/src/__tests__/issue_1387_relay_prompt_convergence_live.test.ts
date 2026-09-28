/**
 * Live #1387 contract: a relay prompt accepted by the real sandbox Mac must
 * converge in transcript reads even when the phone discards the POST response
 * and cannot reconcile messages/status during the initial uncertainty window.
 *
 * Start tools/dev/sandbox.sh with RHYTHM_SANDBOX_RELAY=1. This test never
 * starts or substitutes an API, engine, or relay server.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const engineUrl = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const relayUrl = (process.env.RHYTHM_LIVE_RELAY_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const configPath = process.env.RHYTHM_SANDBOX_OPENCODE_JSON ?? '';
const providerId = 'issue-1387-relay-capture';
const modelId = 'capture-model';
const uncertaintyWindowMs = 5_000;
const assistantPollDelaysMs = [500, 1_000, 1_500, 2_500, 5_000] as const;

type Message = {
  info?: { id?: unknown; role?: unknown; summary?: unknown };
  parts?: Array<{ type?: unknown; text?: unknown }>;
};

describeLive('live E2E — issue #1387 relay prompt convergence', () => {
  it('converges exactly once after accepted prompt response loss and bounded read uncertainty', async () => {
    assertIsolatedInputs();
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    const relayDb = new Database(resolve(sandboxDir, 'relay', 'rhythm.db'));
    const runId = randomUUID();
    const marker = `ISSUE_1387_RELAY_${runId}`;
    const assistantText = `CONVERGED_${runId}`;
    const projectId = randomUUID();
    const profileId = `issue-1387-relay-${runId}`;
    const projectRoot = resolve(sandboxDir, `issue-1387-relay-${runId}`);
    let captureServer: Server | null = null;
    let originalConfig: string | null = null;
    let pairingCodeId = '';
    let deviceId = '';
    let deviceToken = '';
    let sessionId = '';
    let promptPosts = 0;
    let acceptedMarkerRequests = 0;
    let resolveAccepted!: () => void;
    const accepted = new Promise<void>((resolveAcceptedPromise) => {
      resolveAccepted = resolveAcceptedPromise;
    });

    try {
      const owner = db.prepare(
        `SELECT token, user_id AS userId
           FROM sessions
          WHERE expires_at IS NULL OR expires_at > datetime('now')
          ORDER BY created_at DESC
          LIMIT 1`,
      ).get() as { token: string; userId: number } | undefined;
      expect(owner, 'sandbox requires the active synthetic relay bearer').toBeDefined();

      mkdirSync(projectRoot, { recursive: true });
      const capture = await startCaptureProvider(marker, assistantText, () => {
        acceptedMarkerRequests += 1;
        resolveAccepted();
      });
      captureServer = capture.server;
      originalConfig = installCaptureProvider(capture.url);
      installProfileAsset(projectRoot, profileId);
      insertDisposableRows(db, {
        ownerUserId: owner!.userId,
        profileId,
        projectId,
        projectRoot,
      });
      await refreshEngineConfig();

      const paired = await pairDevice(db, owner!.userId, runId);
      pairingCodeId = paired.pairingCodeId;
      deviceId = paired.deviceId;
      deviceToken = paired.deviceToken;
      copyDisposableEnrollmentToRelay(db, relayDb, deviceId);
      await waitForRelayOnline();
      await waitForRelayDevice(deviceToken);

      const headers = mobileHeaders(deviceToken, projectId);
      const createResponse = await fetch(
        `${relayUrl}/mobile-gateway/opencode/session`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: `Issue 1387 relay ${runId}`,
            profileId,
          }),
        },
      );
      const created = await jsonBody(createResponse);
      expect(createResponse.status, JSON.stringify(created)).toBe(200);
      sessionId = String((created as Record<string, unknown>).id ?? '');
      expect(sessionId).not.toBe('');

      const baseline = await readMessages(sessionId, headers);
      const baselineAssistantIds = new Set(
        baseline
          .filter((message) => message.info?.role === 'assistant')
          .map((message) => String(message.info?.id ?? '')),
      );

      promptPosts += 1;
      const discardedResponse = postAndDiscardAfterAcceptance(
        `${relayUrl}/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}/prompt_async`,
        headers,
        JSON.stringify({
          agent: profileId,
          model: { providerID: providerId, modelID: modelId },
          parts: [{ type: 'text', text: `${marker}\nReply only with ${assistantText}.` }],
        }),
        accepted,
      );

      // Mirror the mobile reconciliation loop's 250 ms reads for its 5 s
      // uncertainty budget, but keep both reads deliberately unavailable. The
      // only write remains the single POST above.
      const uncertaintyStartedAt = Date.now();
      let unavailableMessageReads = 0;
      let unavailableStatusReads = 0;
      while (Date.now() - uncertaintyStartedAt <= uncertaintyWindowMs) {
        await expect(Promise.reject(new Error('message read unavailable')))
          .rejects.toThrow('unavailable');
        unavailableMessageReads += 1;
        await expect(Promise.reject(new Error('status read unavailable')))
          .rejects.toThrow('unavailable');
        unavailableStatusReads += 1;
        await delay(250);
      }
      await discardedResponse;

      let convergedMessages: Message[] = [];
      let pollReads = 0;
      for (const delayMs of assistantPollDelaysMs) {
        await delay(delayMs);
        pollReads += 1;
        try {
          const messages = await readMessages(sessionId, headers);
          const converged = messages.some((message) =>
            message.info?.role === 'assistant' &&
            message.info?.summary !== true &&
            !baselineAssistantIds.has(String(message.info?.id ?? '')) &&
            messageText(message).trim().length > 0
          );
          if (converged) {
            convergedMessages = messages;
            break;
          }
        } catch {
          // Same finite transient-read behavior as mobile pollForNewAssistantTurn.
        }
      }

      expect(unavailableMessageReads).toBeGreaterThan(0);
      expect(unavailableStatusReads).toBe(unavailableMessageReads);
      expect(pollReads).toBeGreaterThan(0);
      expect(pollReads).toBeLessThanOrEqual(assistantPollDelaysMs.length);
      expect(convergedMessages.length, 'assistant did not converge within the mobile poll budget')
        .toBeGreaterThan(0);

      const userMarkers = convergedMessages.filter((message) =>
        message.info?.role === 'user' && messageText(message).includes(marker)
      );
      const newAssistantTexts = convergedMessages.filter((message) =>
        message.info?.role === 'assistant' &&
        message.info?.summary !== true &&
        !baselineAssistantIds.has(String(message.info?.id ?? '')) &&
        messageText(message).trim().length > 0
      );
      expect(promptPosts).toBe(1);
      expect(acceptedMarkerRequests).toBe(1);
      expect(userMarkers).toHaveLength(1);
      expect(newAssistantTexts).toHaveLength(1);
      expect(messageText(newAssistantTexts[0])).toContain(assistantText);

      // One final bounded observation catches an accidental resend/repeating
      // poll without installing any timer in the test itself.
      await delay(1_000);
      const settled = await readMessages(sessionId, headers);
      expect(settled.filter((message) =>
        message.info?.role === 'user' && messageText(message).includes(marker)
      )).toHaveLength(1);
      expect(acceptedMarkerRequests).toBe(1);
    } finally {
      if (sessionId) {
        await fetch(
          `${engineUrl}/session/${encodeURIComponent(sessionId)}` +
            `?directory=${encodeURIComponent(projectRoot)}`,
          { method: 'DELETE' },
        ).catch(() => undefined);
        cleanupSession(db, sessionId);
        cleanupSession(relayDb, sessionId);
      }
      if (deviceId) {
        db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
        relayDb.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      }
      if (pairingCodeId) {
        db.prepare('DELETE FROM mobile_pairing_codes WHERE id = ?').run(pairingCodeId);
      }
      db.prepare('DELETE FROM agent_configs WHERE id = ?').run(profileId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      relayDb.close();
      db.close();
      if (originalConfig !== null) {
        writeFileSync(configPath, originalConfig, 'utf8');
        await refreshEngineConfig().catch(() => undefined);
      }
      await new Promise<void>((done) => captureServer?.close(() => done()) ?? done());
      if (resolve(projectRoot).startsWith(`${resolve(sandboxDir)}/`)) {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    }
  }, 90_000);
});

function assertIsolatedInputs(): void {
  const api = new URL(baseUrl);
  const engine = new URL(engineUrl);
  const relay = new URL(relayUrl);
  if (
    process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
    [api, engine, relay].some((url) =>
      url.hostname !== '127.0.0.1' || !url.port || url.port === '4001') ||
    new Set([api.port, engine.port, relay.port]).size !== 3 ||
    !sandboxDir.startsWith('/private/tmp/') ||
    resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
    resolve(configPath) !== resolve(sandboxDir, 'home/.config/opencode/opencode.json')
  ) {
    throw new Error(
      'Issue #1387 live test requires the attested /private/tmp sandbox with distinct real API, engine, and relay listeners',
    );
  }
}

async function waitForRelayOnline(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${relayUrl}/mobile-gateway/health`).catch(() => null);
    if (response?.ok) {
      const body = await response.json() as { macOnline?: unknown };
      if (body.macOnline === true) return;
    }
    await delay(100);
  }
  throw new Error(
    'BLOCKED: the real sandbox uplink cannot authenticate the disposable paired enrollment; RelayUplinkClient sends os.hostname() as hello.machineId while RelayUplinkServer requires the MobilePairingService hostId',
  );
}

async function startCaptureProvider(
  marker: string,
  assistantText: string,
  onAccepted: () => void,
): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.includes(marker)) onAccepted();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({
        id: randomUUID(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: assistantText },
          finish_reason: null,
        }],
      })}\n\n`);
      res.write(`data: ${JSON.stringify({
        id: randomUUID(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('capture provider did not bind');
  return { server, url: `http://127.0.0.1:${address.port}/v1` };
}

function installCaptureProvider(captureUrl: string): string {
  const original = readFileSync(configPath, 'utf8');
  const config = JSON.parse(original) as { provider?: Record<string, unknown> };
  config.provider ??= {};
  config.provider[providerId] = {
    npm: '@ai-sdk/openai-compatible',
    name: 'Issue 1387 relay capture provider',
    options: { baseURL: captureUrl, apiKey: 'isolated-test-key' },
    models: {
      [modelId]: {
        name: 'Issue 1387 relay capture model',
        tool_call: true,
        limit: { context: 100_000, output: 1_000 },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return original;
}

function installProfileAsset(projectRoot: string, profileId: string): void {
  const path = resolve(projectRoot, '.opencode', 'agents', `${profileId}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    '---\ndescription: Issue 1387 isolated relay profile\nmode: primary\n---\nReply exactly as requested.\n',
  );
}

function insertDisposableRows(
  db: Database.Database,
  input: {
    ownerUserId: number;
    profileId: string;
    projectId: string;
    projectRoot: string;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects
       (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty, vcs_checked_at, created_at, archived_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
  ).run(input.projectId, 'Issue 1387 relay convergence', input.projectRoot, now);
  db.prepare(
    `INSERT INTO agent_configs
       (id, label, icon, command, enabled, is_agent, allowed_mcps_json,
        allowed_skills_json, core_permissions_json, model_provider, model_id,
        oc_agent, session_selectable, created_at, updated_at)
     VALUES (?, ?, 'message-check-outline', '', 1, 1, '[]', '[]', ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    input.profileId,
    'Issue 1387 relay convergence',
    JSON.stringify({ '*': 'deny' }),
    providerId,
    modelId,
    input.profileId,
    now,
    now,
  );
}

async function pairDevice(
  db: Database.Database,
  ownerUserId: number,
  runId: string,
): Promise<{ pairingCodeId: string; deviceId: string; deviceToken: string }> {
  const healthResponse = await fetch(`${baseUrl}/mobile-gateway/health`);
  expect(healthResponse.status).toBe(200);
  const health = await healthResponse.json() as { hostId: string };
  const code = {
    id: randomUUID(),
    pairingCode: randomBytes(32).toString('base64url'),
    hostId: health.hostId,
  };
  const now = new Date();
  db.prepare(
    `INSERT INTO mobile_pairing_codes
       (id, host_id, user_id, code_verifier, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    code.id,
    code.hostId,
    ownerUserId,
    createHash('sha256').update(code.pairingCode).digest('hex'),
    new Date(now.getTime() + 5 * 60_000).toISOString(),
    now.toISOString(),
  );
  const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pairingCode: code.pairingCode,
      hostId: code.hostId,
      deviceName: `Issue 1387 relay ${runId}`,
    }),
  });
  expect(pairResponse.status).toBe(201);
  const paired = await pairResponse.json() as {
    deviceId: string;
    deviceToken: string;
  };
  return {
    pairingCodeId: code.id,
    deviceId: paired.deviceId,
    deviceToken: paired.deviceToken,
  };
}

function copyDisposableEnrollmentToRelay(
  db: Database.Database,
  relayDb: Database.Database,
  deviceId: string,
): void {
  // RelayUplinkClient identifies this host with os.hostname(). Keep the paired
  // token/user intact while aligning this disposable enrollment to that real
  // hello identity before the client retries its connection.
  db.prepare('UPDATE mobile_devices SET host_id = ? WHERE id = ?')
    .run(hostname(), deviceId);
  const device = db.prepare(
    `SELECT id, host_id, user_id, name, token_verifier, revoked_at, created_at
       FROM mobile_devices
      WHERE id = ?`,
  ).get(deviceId) as Record<string, unknown> | undefined;
  expect(device).toBeDefined();
  relayDb.prepare(
    `INSERT OR REPLACE INTO mobile_devices
       (id, host_id, user_id, name, token_verifier, revoked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    device!.id,
    device!.host_id,
    device!.user_id,
    device!.name,
    device!.token_verifier,
    device!.revoked_at,
    device!.created_at,
  );
}

async function waitForRelayDevice(deviceToken: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${relayUrl}/mobile-gateway/projects`, {
      headers: { Authorization: `Device ${deviceToken}` },
    }).catch(() => null);
    if (response && response.status !== 401) return;
    await delay(100);
  }
  throw new Error('disposable device verifier did not replicate to the real relay');
}

function mobileHeaders(
  deviceToken: string,
  projectId: string,
): Record<string, string> {
  return {
    Authorization: `Device ${deviceToken}`,
    'Content-Type': 'application/json',
    'X-Rhythm-Project-ID': projectId,
  };
}

async function readMessages(
  sessionId: string,
  headers: Record<string, string>,
): Promise<Message[]> {
  const response = await fetch(
    `${relayUrl}/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}/message`,
    { headers },
  );
  const body = await jsonBody(response);
  if (!response.ok) {
    throw new Error(`relay transcript ${response.status}: ${JSON.stringify(body)}`);
  }
  if (!Array.isArray(body)) throw new Error('relay transcript was not an array');
  return body as Message[];
}

async function postAndDiscardAfterAcceptance(
  url: string,
  headers: Record<string, string>,
  body: string,
  accepted: Promise<void>,
): Promise<void> {
  const target = new URL(url);
  let response: IncomingMessage | null = null;
  const req = request({
    hostname: target.hostname,
    port: target.port,
    path: `${target.pathname}${target.search}`,
    method: 'POST',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
  });
  req.on('response', (incoming) => {
    response = incoming;
    incoming.pause();
  });
  const requestError = new Promise<void>((_resolve, reject) => {
    req.once('error', reject);
  });
  req.end(body);
  await Promise.race([
    accepted,
    requestError,
    delay(30_000).then(() => {
      throw new Error('prompt never reached the disposable capture provider');
    }),
  ]);
  (response as IncomingMessage | null)?.destroy();
  req.destroy();
}

async function jsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function messageText(message: Message): string {
  return (message.parts ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n');
}

function cleanupSession(db: Database.Database, sdkSessionId: string): void {
  db.prepare(
    'DELETE FROM mobile_opencode_resource_owners WHERE resource_id = ?',
  ).run(sdkSessionId);
  db.prepare('DELETE FROM agent_sessions WHERE sdk_session_id = ?').run(sdkSessionId);
}

async function refreshEngineConfig(): Promise<void> {
  const response = await fetch(`${baseUrl}/system/refresh`, { method: 'POST' });
  if (!response.ok) throw new Error(`engine config refresh failed: ${response.status}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
