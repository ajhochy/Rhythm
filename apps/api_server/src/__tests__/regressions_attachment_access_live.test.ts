/** A1: real API/WS/engine; only the external provider is synthetic. No account/vision recognition claim. */
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const API = process.env.RHYTHM_LIVE_URL ?? '';
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? '';
const sandbox = process.env.RHYTHM_SANDBOX_DIR ?? '';
const providerId = `a1-synthetic-${randomUUID().slice(0, 8)}`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const token = 'e02-synthetic-session-not-a-secret';
const sessions: Array<{ id: string; sdkSessionId: string }> = [];
const requests: any[] = [];
const memberToken = `a1-synthetic-member-${randomUUID()}`;
let provider: Server;
let profileId: string;
let workbook: Buffer;
let photos: Array<{ mime: string; filename: string; url: string }>;
let isolatedSandboxValidated = false;

async function api(path: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, { ...init, headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers,
  } });
}
async function json(path: string, init: RequestInit = {}) {
  const response = await api(path, init);
  expect(response.status, `A1 ${path} status`).toBeLessThan(300);
  return response.json() as Promise<any>;
}
async function poll<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('A1 real-runtime outcome did not arrive within 30s');
}
async function session() {
  const created = await json('/agent-sessions', { method: 'POST', body: JSON.stringify({
    agentId: profileId, cwd: sandbox, name: `A1 synthetic ${randomUUID()}`,
  }) });
  sessions.push(created);
  return created;
}
async function send(target: { id: string }, file: { mime: string; filename: string; url: string; artifactId?: string; artifactProject?: string }) {
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/agents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let inputError: string | undefined;
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame.type === 'error' && frame.id === target.id) inputError = String(frame.message);
  });
  try {
    ws.send(JSON.stringify({ v: 1, type: 'session.input', id: target.id,
      modelOverride: { providerId, modelId: 'vision' },
      parts: [{ type: 'text', text: `A1 ${file.filename}: report attachment outcome, do not use bash.` }, { type: 'file', ...file }],
    }));
    return await poll(async () => {
      if (inputError) throw new Error(`A1 input rejected: ${inputError}`);
      const snapshot = await json(`/agent-sessions/${target.id}`);
      return snapshot.messages?.some((m: any) => JSON.stringify(m.parts).includes(file.filename))
        ? snapshot : undefined;
    });
  } finally { ws.close(); }
}
async function rejected(target: { id: string }, file: Record<string, unknown>, bearer = token) {
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/agents`, { headers: { Authorization: `Bearer ${bearer}` } });
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let error: string | undefined;
  ws.on('message', (raw) => { const frame = JSON.parse(raw.toString()); if (frame.type === 'error' && frame.id === target.id) error = frame.message; });
  try {
    ws.send(JSON.stringify({ v: 1, type: 'session.input', id: target.id, modelOverride: { providerId, modelId: 'vision' },
      parts: [{ type: 'text', text: 'A1 reference outcome' }, { type: 'file', ...file }],
    }));
    return await poll(async () => error);
  } finally { ws.close(); }
}

describe.skipIf(!live)('A1 real attachment acceptance (synthetic external provider)', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    expect(sandbox).toMatch(/^\/private\/tmp\/rhythm-[a-z0-9-]*20261001(?:-[a-z0-9-]+)?$/);
    expect(realpathSync(sandbox)).toBe(sandbox);
    const sandboxDb = join(sandbox, 'rhythm.db');
    expect(process.env.DB_PATH).toBe(sandboxDb);
    expect(realpathSync(sandboxDb)).toBe(sandboxDb);
    expect(API).toBe('http://127.0.0.1:4098');
    expect(ENGINE).toBe('http://127.0.0.1:4097');
    expect(await json('/opencode/health')).toMatchObject({ status: 'ready' });
    // Guard ownership before any writes, never operate on an arbitrary caller-selected DB/HOME.
    const pid = Number(readFileSync(`${sandbox}/api_server.pid`, 'utf8').trim());
    expect(pid).toBeGreaterThan(1);
    expect(await (await fetch(`${ENGINE}/global/health`)).json()).toMatchObject({ healthy: true });
    const config = await (await fetch(`${ENGINE}/global/config`)).json() as any;
    expect(config.mcp.rhythm.command).toEqual(['node', resolve(__dirname, '../../../mcp_server/dist/index.js')]);
    isolatedSandboxValidated = true;
    // Fixture seeding only, in the proved owned synthetic runtime DB. Authorization remains real.
    const db = new Database(`${sandbox}/rhythm.db`);
    try {
      expect(db.prepare('SELECT email FROM users WHERE id = 2').get()).toEqual({ email: 'member@example.invalid' });
      db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, 2)').run(memberToken);
    } finally { db.close(); }

    const browserRequire = createRequire(resolve(__dirname, '../../../web/package.json'));
    const { chromium } = browserRequire('@playwright/test');
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
    try {
      const page = await browser.newPage();
      photos = await page.evaluate(() => ['image/jpeg', 'image/png'].map((mime) => {
        const canvas = (globalThis as any).document.createElement('canvas'); canvas.width = canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        let seed = 1729;
        const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; };
        for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
          ctx.fillStyle = `rgb(${next()},${next()},${next()})`;
          ctx.fillRect(x, y, 1, 1);
        }
        return { mime, filename: mime === 'image/jpeg' ? 'synthetic.jpg' : 'synthetic.png', url: canvas.toDataURL(mime) };
      }));
    } finally { await browser.close(); }
    const forkRequire = createRequire(resolve(__dirname, '../../../opencode_fork/packages/opencode/package.json'));
    const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } = forkRequire('@zip.js/zip.js');
    const writer = new ZipWriter(new Uint8ArrayWriter());
    const entries = {
      '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
      'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="A1-ordered" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><dimension ref="A1:C2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>A1_VALUE_17</t></is></c></row><row r="2"><c r="A2" t="n"><v>17</v></c><c r="B2"/><c r="C2"><f>A2*2</f><v>34</v></c></row></sheetData></worksheet>',
    };
    for (const [name, xml] of Object.entries(entries)) await writer.add(name, new Uint8ArrayReader(Buffer.from(xml)), { level: 0 });
    workbook = Buffer.from(await writer.close());
    provider = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        if (request.method !== 'POST') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ data: [{ id: 'vision' }] }));
          return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        requests.push(body);
        const toolPath = JSON.stringify(body.messages).match(/A1_TOOL_PATH:([^ "\\]+)/)?.[1];
        const toolResult = body.messages.some((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === 'tool_result'));
        const callRead = toolPath && !toolResult;
        const events = [
          { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: 'vision', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: callRead ? { type: 'tool_use', id: 'toolu_a1read', name: 'read', input: {} } : { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: callRead ? { type: 'input_json_delta', partial_json: JSON.stringify({ filePath: toolPath }) } : { type: 'text_delta', text: 'A1 synthetic provider received input.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: callRead ? 'tool_use' : 'end_turn' }, usage: { input_tokens: 5, output_tokens: 5 } },
          { type: 'message_stop' },
        ];
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end(events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n');
      });
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('A1 provider bind failed');
    const patch = await fetch(`${ENGINE}/global/config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      provider: { [providerId]: { npm: '@ai-sdk/anthropic', name: 'A1 synthetic transport, NOT account entitlement',
        options: { apiKey: 'a1-synthetic-only', baseURL: `http://127.0.0.1:${address.port}/v1` },
        models: {
          vision: { name: 'A1 synthetic vision transport', attachment: true, modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 200000, output: 4000 } },
          text: { name: 'A1 synthetic TEXT ONLY transport', attachment: false, modalities: { input: ['text'], output: ['text'] }, limit: { context: 200000, output: 4000 } },
        },
      } },
    }) });
    expect(patch.status).toBe(200);
    await json(`/opencode/auth/${providerId}`, { method: 'POST', body: JSON.stringify({ apiKey: 'a1-synthetic-only' }) });
    await json('/system/refresh', { method: 'POST' });
    const profile = await json('/agent-configs', { method: 'POST', body: JSON.stringify({
      label: `A1 synthetic ${providerId}`, isAgent: true, icon: 'paperclip', ocAgent: 'build', modelProvider: providerId, modelId: 'vision',
    }) });
    profileId = profile.id;
  }, 120000);

  afterAll(async () => {
    for (const target of sessions) await api(`/agent-sessions/${target.id}/hard`, { method: 'DELETE' });
    if (profileId) await api(`/agent-configs/${profileId}`, { method: 'DELETE' });
    if (isolatedSandboxValidated) {
      const db = new Database(`${sandbox}/rhythm.db`);
      try { db.prepare('DELETE FROM sessions WHERE token = ?').run(memberToken); } finally { db.close(); }
    }
    if (provider) await new Promise<void>((resolve) => provider.close(() => resolve()));
  });

  for (const mime of ['image/jpeg', 'image/png']) it(`${mime}: exact native provider bytes and replay without reupload`, async () => {
    const photo = photos.find((item) => item.mime === mime)!;
    expect(photo.url.length).toBeGreaterThan(8192); // Different from tiny-inline hosting exception.
    const target = await session();
    const before = requests.length;
    const snapshot = await send(target, photo);
    await poll(async () => requests.length > before ? true : undefined);
    const content = requests.slice(before).flatMap((body) => body.messages).flatMap((message: any) => message.content);
    const image = content.find((block: any) => block.type === 'image');
    expect(image?.source).toEqual({ type: 'base64', media_type: mime, data: photo.url.split(',')[1] });
    expect(JSON.stringify(content)).not.toMatch(/\/artifacts\/|a1-synthetic-only|Bearer|file:synthetic/);
    const part = snapshot.messages.flatMap((m: any) => m.parts ?? []).find((p: any) => p.type === 'file' && p.filename === photo.filename);
    expect(part.url).toMatch(/^\/artifacts\//);
    const response = await api(part.url, { headers: { 'X-Rhythm-Project': part.artifactProject } });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(photo.url.split(',')[1], 'base64'));
    const replay = await json(`/agent-sessions/${target.id}`); // Fresh read, no upload API invoked.
    expect(replay.messages.flatMap((m: any) => m.parts ?? []).find((p: any) => p.artifactId === part.artifactId)).toEqual(part);
    const db = new Database(`${sandbox}/rhythm.db`, { readonly: true });
    try { expect(db.prepare('SELECT count(*) AS n FROM media_artifacts WHERE session = ?').get(target.id)).toEqual({ n: 1 }); }
    finally { db.close(); }
    const referenceStart = requests.length;
    await send(target, { mime, filename: photo.filename, url: part.url, artifactId: part.artifactId, artifactProject: part.artifactProject });
    await poll(async () => requests.length > referenceStart ? true : undefined);
    const replayImages = requests.slice(referenceStart).flatMap((body) => body.messages).flatMap((m: any) => m.content).filter((p: any) => p.type === 'image');
    expect(replayImages.at(-1)?.source.data).toBe(photo.url.split(',')[1]);
    const afterReplayDb = new Database(`${sandbox}/rhythm.db`, { readonly: true });
    try { expect(afterReplayDb.prepare('SELECT count(*) AS n FROM media_artifacts WHERE session = ?').get(target.id)).toEqual({ n: 1 }); }
    finally { afterReplayDb.close(); }
  }, 45000);

  it('mobile owner replays an API-hosted image reference as exact engine bytes; another device owner cannot', async () => {
    const approval = process.env.RHYTHM_LIVE_HUMAN_CAPABILITY ?? '';
    expect(approval.length, 'A1 mobile live check requires the sandbox human capability').toBeGreaterThanOrEqual(24);
    const db = new Database(`${sandbox}/rhythm.db`);
    const projectId = randomUUID();
    const pairedDeviceIds: string[] = [];
    const pairingCodeIds: string[] = [];
    let target: { id: string; sdkSessionId: string } | null = null;
    const deviceHeaders = (deviceToken: string) => ({
      Authorization: `Device ${deviceToken}`, 'X-Rhythm-Project-ID': projectId,
      'Content-Type': 'application/json',
    });
    const pair = async (bearer: string) => {
      const codeResponse = await fetch(`${API}/mobile-gateway/pairing-codes`, {
        method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json',
          'X-Rhythm-Human-Approval': approval }, body: '{}',
      });
      expect(codeResponse.status).toBe(201);
      const code = await codeResponse.json() as { id: string; pairingCode: string; hostId: string };
      pairingCodeIds.push(code.id);
      const response = await fetch(`${API}/mobile-gateway/pair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode: code.pairingCode, hostId: code.hostId,
          deviceName: `A1 synthetic replay ${randomUUID()}` }),
      });
      expect(response.status).toBe(201);
      const device = await response.json() as { deviceId: string; deviceToken: string };
      pairedDeviceIds.push(device.deviceId);
      return device.deviceToken;
    };
    try {
      const owner = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as { user_id: number };
      expect(owner.user_id).toBeGreaterThan(0);
      db.prepare(`INSERT INTO projects
        (id, name, cwd, icon, vcs_root, vcs_branch, vcs_dirty, vcs_checked_at, created_at, archived_at)
        VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, ?, NULL)`)
        .run(projectId, 'A1 synthetic mobile replay', sandbox, new Date().toISOString());
      const created = await json('/agent-sessions', { method: 'POST', body: JSON.stringify({
        agentId: profileId, cwd: sandbox, projectId, name: `A1 mobile replay ${randomUUID()}`,
      }) }) as { id: string; sdkSessionId: string };
      target = created;
      sessions.push(created);
      const local = db.prepare('SELECT owner_user_id, project_id FROM agent_sessions WHERE id = ?')
        .get(created.id) as { owner_user_id: number; project_id: string };
      expect(local).toEqual({ owner_user_id: owner.user_id, project_id: projectId });
      const photo = photos.find((item) => item.mime === 'image/png')!;
      const snapshot = await send(created, photo);
      const part = snapshot.messages.flatMap((m: any) => m.parts ?? [])
        .find((item: any) => item.type === 'file' && item.filename === photo.filename);
      expect(part).toMatchObject({ artifactProject: projectId });
      expect(part.url).toMatch(/^\/artifacts\/[a-f0-9-]{36}$/i);

      const ownerDeviceToken = await pair(token);
      const memberDeviceToken = await pair(memberToken);
      const health = await fetch(`${API}/mobile-gateway/opencode/global/health`, {
        headers: deviceHeaders(ownerDeviceToken),
      });
      expect(health.status).toBe(200);
      // The real desktop session route already records durable mobile ownership.
      // Observe that binding instead of manufacturing a duplicate fixture row.
      expect(db.prepare(`SELECT owner_user_id, project_id FROM mobile_opencode_resource_owners
        WHERE resource_kind = 'session' AND resource_id = ?`).get(created.sdkSessionId))
        .toEqual({ owner_user_id: owner.user_id, project_id: projectId });

      const replayName = `mobile-replay-${randomUUID()}.png`;
      const requestBody = { noReply: true, parts: [
        { type: 'text', text: 'A1 mobile replay of already hosted bytes.' },
        { type: 'file', mime: photo.mime, filename: replayName, url: part.url,
          artifactId: part.artifactId, artifactProject: part.artifactProject },
      ] };
      const endpoint = `${API}/mobile-gateway/opencode/session/${encodeURIComponent(created.sdkSessionId)}/prompt_async`;
      const ownerResponse = await fetch(endpoint, { method: 'POST', headers: deviceHeaders(ownerDeviceToken),
        body: JSON.stringify(requestBody) });
      expect(ownerResponse.status, await ownerResponse.text()).toBe(204);
      const engineTranscript = await poll(async () => {
        const response = await fetch(`${ENGINE}/session/${encodeURIComponent(created.sdkSessionId)}/message?directory=${encodeURIComponent(sandbox)}`);
        if (!response.ok) return undefined;
        const messages = await response.json() as any[];
        return messages.some((message) => message.parts?.some((item: any) => item.filename === replayName))
          ? messages : undefined;
      });
      const replayPart = engineTranscript.flatMap((message: any) => message.parts ?? [])
        .find((item: any) => item.filename === replayName);
      expect(replayPart.url).toBe(photo.url);

      const deniedName = `mobile-denied-${randomUUID()}.png`;
      const denied = await fetch(endpoint, { method: 'POST', headers: deviceHeaders(memberDeviceToken),
        body: JSON.stringify({ ...requestBody, parts: [requestBody.parts[0],
          { ...requestBody.parts[1], filename: deniedName }] }) });
      expect([403, 404]).toContain(denied.status);
      const afterDenied = await (await fetch(`${ENGINE}/session/${encodeURIComponent(created.sdkSessionId)}/message?directory=${encodeURIComponent(sandbox)}`)).json() as any[];
      expect(afterDenied.flatMap((message: any) => message.parts ?? []).some((item: any) => item.filename === deniedName)).toBe(false);
    } finally {
      if (target) {
        await api(`/agent-sessions/${target.id}/hard`, { method: 'DELETE' });
        const index = sessions.findIndex((item) => item.id === target!.id);
        if (index >= 0) sessions.splice(index, 1);
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mobile_opencode_resource_owners'").get()) {
          db.prepare("DELETE FROM mobile_opencode_resource_owners WHERE resource_kind = 'session' AND resource_id = ?")
            .run(target.sdkSessionId);
        }
      }
      for (const deviceId of pairedDeviceIds) db.prepare('DELETE FROM mobile_devices WHERE id = ?').run(deviceId);
      for (const codeId of pairingCodeIds) db.prepare('DELETE FROM mobile_pairing_codes WHERE id = ?').run(codeId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      db.close();
    }
  }, 90000);

  it('missing and unauthorized reference errors are identical, with no provider fetch or credential disclosure', async () => {
    const photo = photos[0]; const target = await session();
    const snapshot = await send(target, photo);
    const part = snapshot.messages.flatMap((m: any) => m.parts ?? []).find((p: any) => p.artifactId);
    expect(part.artifactId).toBeTruthy();
    await poll(async () => requests.some((body) => JSON.stringify(body.messages).includes(photo.url.split(',')[1])) ? true : undefined);
    const before = requests.length;
    const missing = { mime: photo.mime, filename: 'reference.jpg', artifactId: randomUUID(), artifactProject: part.artifactProject };
    const denied = { mime: photo.mime, filename: 'reference.jpg', url: part.url, artifactId: part.artifactId, artifactProject: part.artifactProject };
    const missingError = await rejected(target, { ...missing, url: `/artifacts/${missing.artifactId}` });
    const deniedError = await rejected(target, denied, memberToken);
    expect(missingError).toBe('Attachment unavailable for this session. Select an accessible attachment or remove the reference.');
    expect(deniedError).toBe(missingError);
    expect(requests.length).toBe(before);
    expect(missingError + deniedError).not.toMatch(/Bearer|token|storage|checksum|\/private\/|\/artifacts\//);
    const missingDisplay = await api(`/artifacts/${missing.artifactId}`, { headers: { 'X-Rhythm-Project': part.artifactProject, Authorization: `Bearer ${memberToken}` } });
    const deniedDisplay = await api(part.url, { headers: { 'X-Rhythm-Project': part.artifactProject, Authorization: `Bearer ${memberToken}` } });
    expect(missingDisplay.status).toBe(404); expect(deniedDisplay.status).toBe(404);
    expect(await deniedDisplay.json()).toEqual(await missingDisplay.json());
    const remoteError = await rejected(target, { mime: photo.mime, filename: 'remote.jpg', url: 'https://example.invalid/private?token=not-a-real-token' });
    expect(remoteError).toBe('Unsupported attachment reference. Send selected file bytes, not a remote URL or client-local path.');
    expect(requests.length).toBe(before);
  }, 90000);

  it('XLSX: real staged Read delivers structured cell values to the provider, no binary/path fiction', async () => {
    const target = await session(); const before = requests.length;
    await send(target, { mime: XLSX, filename: 'selected.xlsx', url: `data:${XLSX};base64,${workbook.toString('base64')}` });
    await poll(async () => requests.length > before ? true : undefined);
    const content = JSON.stringify(requests.slice(before).map((body) => body.messages));
    expect(content).toContain('A1_VALUE_17');
    expect(content).toContain('A1-ordered');
    expect(content).toContain('A2*2'); expect(content).toContain('34');
    expect(content).not.toMatch(/Cannot read binary|reader discovery required|bash.*read|\/selected.xlsx/);
  }, 45000);

  it('real engine Read tool returns native PNG bytes; no bash file-reading substitute', async () => {
    const target = await session();
    const photo = photos.find((p) => p.mime === 'image/png')!;
    const filePath = `${sandbox}/tmp/a1-tool-${randomUUID()}.png`;
    writeFileSync(filePath, Buffer.from(photo.url.split(',')[1], 'base64'), { flag: 'wx', mode: 0o600 });
    const before = requests.length;
    const response = await fetch(`${ENGINE}/session/${target.sdkSessionId}/message?directory=${encodeURIComponent(sandbox)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        model: { providerID: providerId, modelID: 'vision' },
        parts: [{ type: 'text', text: `A1_TOOL_PATH:${filePath} Use Read on this actual synthetic file.` }],
      }),
    });
    expect(response.status).toBe(200);
    const transcript = await (await fetch(`${ENGINE}/session/${target.sdkSessionId}/message?directory=${encodeURIComponent(sandbox)}`)).json() as any[];
    const tools = transcript.flatMap((m) => m.parts).filter((p) => p.type === 'tool');
    expect(tools.map((p) => p.tool)).toEqual(['read']);
    expect(tools[0].state.status).toBe('completed');
    expect(tools[0].state.attachments[0].url).toBe(photo.url);
    const toolInputs = requests.slice(before).flatMap((body) => body.messages).flatMap((m: any) => m.content).filter((p: any) => p.type === 'tool_result');
    expect(JSON.stringify(toolInputs)).toContain(photo.url.split(',')[1]);
  }, 45000);

  it('non-vision model never receives native image bytes and reports actual capability limitation', async () => {
    const target = await session(); const before = requests.length;
    const photo = photos[0];
    const response = await fetch(`${ENGINE}/session/${target.sdkSessionId}/message?directory=${encodeURIComponent(sandbox)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        model: { providerID: providerId, modelID: 'text' }, parts: [{ type: 'text', text: 'A1 text-only capability' }, { type: 'file', ...photo }],
      }),
    });
    expect(response.status).toBe(200);
    const content = requests.slice(before).flatMap((body) => body.messages).flatMap((m: any) => m.content);
    expect(content.some((p: any) => p.type === 'image')).toBe(false);
    expect(JSON.stringify(content)).toMatch(/does not support.*image|cannot.*image/i);
    const catalog = await (await fetch(`${ENGINE}/provider?directory=${encodeURIComponent(sandbox)}`)).json() as any;
    expect(catalog.all.find((p: any) => p.id === providerId).models.text.capabilities.input.image).toBe(false);
    // This synthetic capability assertion does not qualify any account's Astra/Luna availability.
  }, 45000);

  it('owned binary staging persists through reads, then session deletion removes only its own temps', async () => {
    const target = await session(); const sibling = await session();
    await send(target, { mime: 'application/octet-stream', filename: 'lifetime.bin', url: 'data:application/octet-stream;base64,AP8B' });
    await send(sibling, { mime: 'application/octet-stream', filename: 'sibling.bin', url: 'data:application/octet-stream;base64,AP8C' });
    const root = `${sandbox}/tmp/opencode/attachments`;
    expect(existsSync(`${root}/${target.sdkSessionId}`)).toBe(true);
    expect(existsSync(`${root}/${sibling.sdkSessionId}`)).toBe(true);
    await json(`/agent-sessions/${target.id}`);
    expect(existsSync(`${root}/${target.sdkSessionId}`)).toBe(true);
    const removed = await api(`/agent-sessions/${target.id}/hard`, { method: 'DELETE' });
    expect(removed.status).toBeLessThan(300);
    expect(existsSync(`${root}/${target.sdkSessionId}`)).toBe(false);
    expect(existsSync(`${root}/${sibling.sdkSessionId}`)).toBe(true);
    sessions.splice(sessions.indexOf(target), 1);
  }, 45000);

  for (const [filename, mime, bytes, error] of [
    ['unsupported.bin', 'application/octet-stream', Buffer.from([0, 255, 1]), /Attachment reader discovery required\./],
    ['corrupt.xlsx', XLSX, Buffer.from('corrupt ZIP'), /XLSX_CORRUPT: Workbook is corrupt/],
  ] as const) it(`${filename}: accurate actionable error, no suggested bash recovery`, async () => {
    const target = await session(); const before = requests.length;
    const snapshot = await send(target, { mime, filename, url: `data:${mime};base64,${bytes.toString('base64')}` });
    const text = snapshot.messages.flatMap((m: any) => m.parts ?? []).filter((p: any) => p.type === 'text' && p.synthetic).map((p: any) => p.text).join('\n');
    expect(text).toMatch(error);
    expect(text).not.toMatch(/use.*bash|\/unsupported.bin|\/corrupt.xlsx/);
    if (filename === 'unsupported.bin') {
      // Preserve the existing format-reader fallback for selected bytes too.
      expect(text).toContain('which the built-in Read tool cannot parse');
      expect(text).toContain('do not guess at its binary contents');
      expect(text).toContain("inspect the session's available skills for a format-specific reader");
      expect(text).toContain(`${sandbox}/tmp/opencode/attachments/${target.sdkSessionId}/`);
    } else {
      expect(text).not.toMatch(/reader discovery required/);
    }
    await poll(async () => requests.length > before ? true : undefined);
  }, 45000);
});
