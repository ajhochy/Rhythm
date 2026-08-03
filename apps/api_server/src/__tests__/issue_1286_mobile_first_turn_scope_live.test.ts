/**
 * Live #1286 contract: paired mobile create -> first prompt -> actual model
 * HTTP request captured downstream of the real fork's resolveTools path.
 *
 * Required isolated-sandbox variables:
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1
 * RHYTHM_LIVE_URL=http://127.0.0.1:<api>
 * RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:<engine>
 * RHYTHM_LIVE_DB_PATH=<sandbox>/rhythm.db RHYTHM_SANDBOX_DIR=<sandbox>
 * RHYTHM_SANDBOX_OPENCODE_JSON=<sandbox engine opencode.json>
 * RHYTHM_LIVE_SERVER_LOG=<sandbox api/engine log>
 * RHYTHM_LIVE_HUMAN_CAPABILITY=<throwaway capability>
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const engineUrl = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR ?? '';
const configPath = process.env.RHYTHM_SANDBOX_OPENCODE_JSON ?? '';
const serverLogPath = process.env.RHYTHM_LIVE_SERVER_LOG ?? '';
const humanCapability = process.env.RHYTHM_LIVE_HUMAN_CAPABILITY ?? '';
const providerId = 'issue-1286-capture';
const modelId = 'capture-model';

type CapturedRequest = {
  path: string;
  body: Record<string, unknown>;
};

let captureServer: Server | null = null;
let originalConfig: string | null = null;
let db: Database.Database | null = null;
let projectRoot = '';
let projectId = '';
let restrictedProfileId = '';
let controlProfileId = '';
let userId: number | null = null;
let deviceId: string | null = null;
let deviceToken = '';
let bearer = '';
let restrictedSessionId = '';
let controlSessionId = '';
let restrictedCreate: Record<string, unknown> = {};
let restrictedRequest: CapturedRequest | null = null;
let controlRequest: CapturedRequest | null = null;
const captures: CapturedRequest[] = [];

describeLive('live E2E — issue #1286 mobile scope applies before first turn', () => {
  beforeAll(async () => {
    assertIsolatedInputs();
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    const runId = randomUUID();
    projectId = randomUUID();
    restrictedProfileId = `issue-1286-restricted-${runId}`;
    controlProfileId = `issue-1286-control-${runId}`;
    projectRoot = resolve(sandboxDir, `issue-1286-${runId}`);
    bearer = randomUUID();
    mkdirSync(projectRoot, { recursive: true });

    const captureUrl = await startCaptureProvider();
    installCaptureProvider(captureUrl);
    installProfileAssets(restrictedProfileId);
    installProfileAssets(controlProfileId);
    insertSandboxRows();
    await refreshEngineConfig();
    await pairDevice();

    const restricted = await createThenPrompt(restrictedProfileId);
    restrictedSessionId = restricted.sessionId;
    restrictedCreate = restricted.created;
    restrictedRequest = restricted.request;
    const control = await createThenPrompt(controlProfileId);
    controlSessionId = control.sessionId;
    controlRequest = control.request;
  }, 90_000);

  afterAll(async () => {
    for (const sessionId of [restrictedSessionId, controlSessionId].filter(Boolean)) {
      await fetch(
        `${engineUrl}/session/${encodeURIComponent(sessionId)}` +
          `?directory=${encodeURIComponent(projectRoot)}`,
        { method: 'DELETE' },
      ).catch(() => undefined);
      db?.prepare(
        'DELETE FROM mobile_opencode_resource_owners WHERE resource_id = ?',
      ).run(sessionId);
      db?.prepare('DELETE FROM agent_sessions WHERE sdk_session_id = ?')
        .run(sessionId);
    }
    if (deviceId) db?.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
    if (userId !== null) {
      db?.prepare('DELETE FROM mobile_pairing_codes WHERE user_id = ?').run(userId);
    }
    if (bearer) db?.prepare('DELETE FROM sessions WHERE token = ?').run(bearer);
    for (const id of [restrictedProfileId, controlProfileId].filter(Boolean)) {
      db?.prepare('DELETE FROM agent_configs WHERE id = ?').run(id);
    }
    if (projectId) db?.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    if (userId !== null) db?.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db?.close();
    db = null;
    if (originalConfig !== null) {
      writeFileSync(configPath, originalConfig, 'utf8');
      await refreshEngineConfig().catch(() => undefined);
    }
    await new Promise<void>((done) => captureServer?.close(() => done()) ?? done());
    captureServer = null;
    if (projectRoot && resolve(projectRoot).startsWith(`${resolve(sandboxDir)}/`)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('issue-1286-c2: the captured first model request contains only profile-authorized tools and skills', () => {
    // Regression caught: create stores metadata, but first prompt assembled and
    // cached an unrestricted tool/skill surface before reading that metadata.
    const restricted = requiredCapture(restrictedRequest);
    const control = requiredCapture(controlRequest);
    const restrictedTools = toolNames(restricted.body);
    const controlTools = toolNames(control.body);
    const restrictedContext = JSON.stringify(restricted.body.messages ?? []);

    expect(restrictedTools).not.toContain('bash');
    expect(restrictedTools).not.toContain('edit');
    expect(restrictedTools).not.toContain('write');
    expect(restrictedContext).toContain('issue-1286-allowed-skill');
    expect(restrictedContext).not.toContain('issue-1286-denied-skill');
    expect(controlTools.filter((name) => !restrictedTools.includes(name)).length)
      .toBeGreaterThan(0);
  });

  it('issue-1286-c4: paired create then prompt reaches the capture provider through the real API and fork', () => {
    // The evidence is the downstream model HTTP body with its concrete tools
    // array; reading GET /session allowlist metadata cannot satisfy this test.
    const capture = requiredCapture(restrictedRequest);
    expect(capture.path).toMatch(/\/chat\/completions|\/responses/);
    expect(Array.isArray(capture.body.tools)).toBe(true);
    expect(capture.body.messages ?? capture.body.input).toBeDefined();
    expect(captures).toContain(capture);
  });

  it('issue-1286-c5: restricted first-turn payload is materially smaller than the unrestricted control', () => {
    // Ratio and relative difference are derived from this isolated control;
    // no private production token count or absolute customer payload is used.
    const restrictedBytes = Buffer.byteLength(
      JSON.stringify(requiredCapture(restrictedRequest).body),
    );
    const controlBytes = Buffer.byteLength(
      JSON.stringify(requiredCapture(controlRequest).body),
    );
    expect(restrictedBytes).toBeLessThan(controlBytes);
    expect(restrictedBytes / controlBytes).toBeLessThanOrEqual(0.8);
    expect(toolNames(requiredCapture(restrictedRequest).body).length)
      .toBeLessThan(toolNames(requiredCapture(controlRequest).body).length);
  });

  it('issue-1286-c6: created session reports the selected profile and emits no scope fallback warning', () => {
    expect(
      (restrictedCreate.rhythm as { profileId?: unknown } | undefined)?.profileId,
    ).toBe(restrictedProfileId);
    const log = readFileSync(serverLogPath, 'utf8');
    const related = log
      .split('\n')
      .filter((line) =>
        [restrictedProfileId, restrictedSessionId].some((id) => id && line.includes(id)))
      .join('\n');
    expect(related).not.toMatch(
      /scope fallback|unrestricted fallback|omitting mcpAllowlist|profile not found/i,
    );
  });
});

function assertIsolatedInputs(): void {
  const api = new URL(baseUrl);
  const engine = new URL(engineUrl);
  if (
    process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
    api.hostname !== '127.0.0.1' ||
    engine.hostname !== '127.0.0.1' ||
    !api.port || !engine.port || api.port === engine.port || api.port === '4001' ||
    !sandboxDir.startsWith('/') ||
    resolve(dbPath) !== resolve(sandboxDir, 'rhythm.db') ||
    !configPath.startsWith(resolve(sandboxDir)) ||
    !serverLogPath.startsWith(resolve(sandboxDir)) ||
    humanCapability.length < 24
  ) {
    throw new Error('Issue #1286 live test requires the attested isolated sandbox inputs');
  }
}

async function startCaptureProvider(): Promise<string> {
  captureServer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      } catch {
        // The provider contract below will fail if no parseable request arrives.
      }
      captures.push({ path: req.url ?? '', body });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({
        id: randomUUID(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }],
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
  await new Promise<void>((done) => captureServer!.listen(0, '127.0.0.1', done));
  const address = captureServer.address();
  if (!address || typeof address === 'string') throw new Error('capture server did not bind');
  return `http://127.0.0.1:${address.port}/v1`;
}

function installCaptureProvider(captureUrl: string): void {
  originalConfig = readFileSync(configPath, 'utf8');
  const config = JSON.parse(originalConfig) as { provider?: Record<string, unknown> };
  config.provider ??= {};
  config.provider[providerId] = {
    npm: '@ai-sdk/openai-compatible',
    name: 'Issue 1286 capture provider',
    options: { baseURL: captureUrl, apiKey: 'isolated-test-key' },
    models: {
      [modelId]: {
        name: 'Issue 1286 capture model',
        tool_call: true,
        limit: { context: 100000, output: 1000 },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function installProfileAssets(agentId: string): void {
  const agentPath = resolve(projectRoot, '.opencode', 'agents', `${agentId}.md`);
  mkdirSync(dirname(agentPath), { recursive: true });
  writeFileSync(
    agentPath,
    `---\ndescription: Issue 1286 isolated profile\nmode: primary\n---\nOnly use authorized tools.\n`,
  );
  for (const skill of ['issue-1286-allowed-skill', 'issue-1286-denied-skill']) {
    const skillPath = resolve(projectRoot, '.opencode', 'skills', skill, 'SKILL.md');
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(
      skillPath,
      `---\nname: ${skill}\ndescription: isolated ${skill}\n---\n${skill}\n`,
    );
  }
}

function insertSandboxRows(): void {
  if (!db) throw new Error('database unavailable');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects
      (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty, vcs_checked_at, created_at, archived_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
  ).run(projectId, 'Issue 1286 project', projectRoot, now);
  const insertProfile = db.prepare(
    `INSERT INTO agent_configs
      (id, label, icon, command, enabled, is_agent, allowed_mcps_json,
       allowed_skills_json, core_permissions_json, model_provider, model_id,
       oc_agent, session_selectable, created_at, updated_at)
     VALUES (?, ?, 'shield-lock-outline', '', 1, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  insertProfile.run(
    restrictedProfileId,
    'Issue 1286 restricted',
    '[]',
    JSON.stringify(['issue-1286-allowed-skill']),
    JSON.stringify({ '*': 'deny', read: 'allow' }),
    providerId,
    modelId,
    restrictedProfileId,
    now,
    now,
  );
  insertProfile.run(
    controlProfileId,
    'Issue 1286 unrestricted control',
    null,
    null,
    null,
    providerId,
    modelId,
    controlProfileId,
    now,
    now,
  );
  userId = Number(db.prepare(
    'INSERT INTO users (name, email, google_sub) VALUES (?, ?, ?)',
  ).run(
    'Issue 1286 owner',
    `issue-1286-${randomUUID()}@example.test`,
    `issue-1286-${randomUUID()}`,
  ).lastInsertRowid);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(bearer, userId, new Date(Date.now() + 10 * 60_000).toISOString());
}

async function refreshEngineConfig(): Promise<void> {
  const response = await fetch(`${baseUrl}/system/refresh`, { method: 'POST' });
  expect(response.ok).toBe(true);
}

async function pairDevice(): Promise<void> {
  const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      'X-Rhythm-Human-Approval': humanCapability,
    },
    body: '{}',
  });
  expect(codeResponse.status).toBe(201);
  const code = await codeResponse.json() as { pairingCode: string; hostId: string };
  const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pairingCode: code.pairingCode,
      hostId: code.hostId,
      deviceName: 'Issue 1286 iPhone',
    }),
  });
  expect(pairResponse.status).toBe(201);
  const paired = await pairResponse.json() as { deviceId: string; deviceToken: string };
  deviceId = paired.deviceId;
  deviceToken = paired.deviceToken;
}

async function createThenPrompt(profileId: string): Promise<{
  sessionId: string;
  created: Record<string, unknown>;
  request: CapturedRequest;
}> {
  const headers = {
    Authorization: `Device ${deviceToken}`,
    'Content-Type': 'application/json',
    'X-Rhythm-Project-ID': projectId,
  };
  const createResponse = await fetch(`${baseUrl}/mobile-gateway/opencode/session`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: `Issue 1286 ${profileId}`, profileId }),
  });
  expect(createResponse.status).toBe(200);
  const created = await createResponse.json() as Record<string, unknown>;
  const sessionId = String(created.id ?? '');
  expect(sessionId).not.toBe('');
  const captureOffset = captures.length;
  const promptResponse = await fetch(
    `${baseUrl}/mobile-gateway/opencode/session/${encodeURIComponent(sessionId)}/prompt_async`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent: profileId,
        model: { providerID: providerId, modelID: modelId },
        parts: [{ type: 'text', text: 'Reply only with done.' }],
      }),
    },
  );
  expect([200, 204]).toContain(promptResponse.status);
  const request = await waitForSubstantiveCapture(captureOffset);
  return { sessionId, created, request };
}

async function waitForSubstantiveCapture(offset: number): Promise<CapturedRequest> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const capture = captures.slice(offset).find((entry) =>
      Array.isArray(entry.body.tools) && entry.body.tools.length > 0);
    if (capture) return capture;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('capture provider did not receive a substantive first model request');
}

function requiredCapture(value: CapturedRequest | null): CapturedRequest {
  expect(value).not.toBeNull();
  return value!;
}

function toolNames(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.tools)) return [];
  return body.tools.flatMap((tool) => {
    if (!tool || typeof tool !== 'object') return [];
    const record = tool as Record<string, unknown>;
    const fn = record.function;
    const name = fn && typeof fn === 'object'
      ? (fn as Record<string, unknown>).name
      : record.name;
    return typeof name === 'string' ? [name] : [];
  }).sort();
}
