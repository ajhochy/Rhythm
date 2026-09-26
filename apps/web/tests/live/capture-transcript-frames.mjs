// Run from the repository root: node apps/web/tests/live/capture-transcript-frames.mjs
// #1582 S0 only. Creates a fresh synthetic fixture; never copies operator data.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
assert(existsSync(resolve(root, 'tools/dev/sandbox.sh')), 'run from repo root');
const require = createRequire(resolve(root, 'apps/api_server/package.json'));
const WebSocket = require('ws');
const fixtureRoot = `/private/tmp/rhythm-1582-s0-${randomUUID()}`;
const sandbox = `${fixtureRoot}-runtime`;
const output = resolve(root, 'apps/web/tests/fixtures/transcript');
const base = 'http://127.0.0.1:6998';
const token = 'e02-synthetic-session-not-a-secret';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const ports = [6996, 6997, 6998, 6999];
const env = { ...process.env, RHYTHM_APPROVED_FIXTURE_ROOT: fixtureRoot,
  RHYTHM_LIVE_DB_PATH: `${fixtureRoot}/rhythm.db`, RHYTHM_SANDBOX_OPENCODE_CONFIG: `${fixtureRoot}/opencode.json`,
  RHYTHM_SANDBOX_DIR: sandbox, RHYTHM_SANDBOX_API_PORT: '6998', RHYTHM_SANDBOX_ENGINE_PORT: '6997',
  RHYTHM_SANDBOX_GATEWAY_PORT: '6999', RHYTHM_OPTIMIZER_MODE: 'shadow', DB_CLIENT: 'sqlite' };
const names = ['plain', 'reasoning', 'tool', 'permission', 'question', 'cancel', 'error'];
const results = {};
let provider;
let started = false;
function command(bin, args, opts = {}) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: 'utf8', timeout: 900_000, ...opts });
  if (result.status !== 0) throw new Error(`${bin} ${args.join(' ')}: ${result.error ?? result.stderr?.slice(-2000) ?? result.status}`);
  return result.stdout;
}
async function http(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
async function until(check, label, ms = 45_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(120);
  }
  throw new Error(`${label}: timeout ${ms}ms`);
}
function listen(id) {
  return new Promise((resolveSocket, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:6998/ws/agents', { headers: { Authorization: `Bearer ${token}` } });
    const frames = [];
    ws.on('message', (data) => {
      try { const frame = JSON.parse(String(data)); if (frame.id === id || frame.sessionId === id) frames.push(frame); }
      catch (error) { reject(error); }
    });
    ws.once('open', () => resolveSocket({ ws, frames }));
    ws.once('error', reject);
  });
}
function assertWire(frames, id, sdkId) {
  const messages = new Map();
  for (const frame of frames) {
    if (!['message.part.updated', 'message.part.delta', 'message.updated'].includes(frame.type)) continue;
    assert.equal(frame.id, id);
    assert.equal(frame.v, 1);
    if (frame.type === 'message.part.updated') {
      assert.equal(typeof frame.part?.id, 'string');
      assert.equal(typeof frame.part?.messageID, 'string');
      assert.equal(frame.part.sessionID, sdkId);
      messages.set(frame.part.id, frame.part.messageID);
    } else if (frame.type === 'message.part.delta') {
      assert.equal(typeof frame.messageId, 'string');
      assert.equal(typeof frame.partId, 'string');
      assert.equal(typeof frame.field, 'string');
      assert.equal(typeof frame.delta, 'string');
    } else { assert.equal(typeof frame.info?.id, 'string'); assert.equal(frame.info?.sessionID, sdkId); }
  }
  for (const frame of frames.filter((f) => f.type === 'message.part.delta')) {
    assert.equal(messages.get(frame.partId), frame.messageId, 'delta must resolve to its canonical part/message');
  }
}
function verifySaved() {
  const verdicts = JSON.parse(readFileSync(resolve(output, 'capture-results.json'), 'utf8'));
  for (const name of names) {
    assert.equal(verdicts[name]?.status, 'PASS', `unqualified ${name}`);
    const lines = readFileSync(resolve(output, `${name}.jsonl`), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, `one captured record for ${name}`);
    const evidence = JSON.parse(lines[0]);
    assert.equal(evidence.kind, 'captured');
    assert.equal(evidence.scenario, name);
    assertWire(evidence.frames, evidence.ids.local, evidence.ids.sdk);
    assert.deepEqual(evidence.counts, { ws: evidence.frames.length,
      mid: evidence.mid.messages.length, final: evidence.final.messages.length });
    const serialized = JSON.stringify(evidence);
    assert(!/Bearer |sk-[A-Za-z0-9]{12}|https?:\/\/(?!127\.0\.0\.1|localhost)/i.test(serialized), `${name}: sensitive/external traffic in evidence`);
    assert(evidence.mid.messages.length && evidence.final.messages.length, `${name}: REST snapshots`);
    if (['plain', 'reasoning', 'cancel'].includes(name)) {
      assert.notDeepEqual(evidence.mid.messages, evidence.final.messages, `${name}: mid-turn REST must differ from final`);
    }
    if (['tool', 'permission', 'question'].includes(name)) {
      assert.equal(evidence.provider.hits.filter((hit) => !hit.afterTool).length, 1);
      assert(evidence.frames.some((f) => f.type === 'message.part.updated' && f.part.type === 'tool' && f.part.state?.status === 'completed'));
    }
    if (name === 'tool') {
      const states = new Set(evidence.frames.filter((f) => f.type === 'message.part.updated' && f.part.type === 'tool')
        .map((f) => f.part.state?.status));
      assert(states.has('pending') && states.has('running') && states.has('completed'), 'tool start/progress/final');
    }
    if (name === 'permission') assert(['permission.asked', 'permission.replied'].every((type) =>
      evidence.frames.some((f) => f.type === type)));
    if (name === 'question') assert(['question.asked', 'question.resolved'].every((type) =>
      evidence.frames.some((f) => f.type === type)));
    if (name === 'error') assert(evidence.provider.hits.length > 1, 'retry count');
    if (name === 'reasoning') {
      const text = evidence.frames.filter((f) => f.type === 'message.part.delta' && f.field === 'text');
      assert(text.some((f) => f.delta.includes('🌱')) && text.some((f) => f.delta.includes('é✓')), 'Unicode deltas');
      assert(text.some((f, i) => text.slice(0, i).some((previous) => previous.delta === f.delta)), 'identical repeated delta');
      const firstDelta = evidence.frames.findIndex((f) => f.type === 'message.part.delta');
      assert(evidence.frames.slice(0, firstDelta).some((f) => f.type === 'message.part.updated'), 'snapshot before delta');
      assert(evidence.frames.slice(firstDelta + 1).some((f) => f.type === 'message.part.updated'), 'snapshot after delta');
    }
    console.log(`verified ${name}: ${evidence.frames.length} WS / ${evidence.mid.messages.length} mid / ${evidence.final.messages.length} final / ${evidence.provider.hits.length} provider calls / ${evidence.provider.disconnects} disconnects`);
  }
}
if (process.argv.includes('--verify')) {
  verifySaved();
  if (process.argv.includes('--require-all')) {
    assert.fail('UNVERIFIED: compaction and attachment-only/mixed input are not captured — requires a bounded local compaction trigger and approved synthetic attachment entry-point fixture');
  }
  process.exit(0);
}
async function capture(name) {
  const session = await http('/agent-sessions', 'POST', {
    cwd: fixtureRoot, name: `S0 ${name}`, isolateWorktree: false,
    permissionMode: name === 'tool' ? 'bypassPermissions' : 'default',
  });
  const id = session.id;
  assert(session.sdkSessionId && id !== session.sdkSessionId);
  const { ws, frames } = await listen(id);
  let mid;
  try {
    ws.send(JSON.stringify({ v: 1, type: 'session.input', id,
      data: `S0:${name} — synthetic deterministic capture`, modelOverride: { providerId: 's0', modelId: 's0-local' },
      agent: 'build' }));
    await until(async () => {
      if (frames.some((f) => f.type === 'message.part.delta' ||
        (name === 'permission' && f.type === 'permission.asked') ||
        (name === 'question' && f.type === 'question.asked') ||
        (name === 'error' && f.type === 'session.status' && f.working === false))) return true;
      if (frames.some((f) => f.type === 'error')) throw new Error(JSON.stringify(frames.find((f) => f.type === 'error')));
      return false;
    }, `${name} first observable state`, 60_000);
    mid = await http(`/agent-sessions/${id}/messages?limit=50`);
    if (name === 'cancel') await http(`/agent-sessions/${id}/cancel`, 'POST');
    if (name === 'permission') {
      const asked = await until(() => frames.find((f) => f.type === 'permission.asked'), 'permission.asked', 30_000);
      await http(`/agent-sessions/${id}/permissions/${encodeURIComponent(asked.permissionID)}/reply`, 'POST', { reply: 'once' });
      await until(() => frames.find((f) => f.type === 'permission.replied' && f.permissionID === asked.permissionID), 'permission.replied');
    }
    if (name === 'question') {
      const asked = await until(() => frames.find((f) => f.type === 'question.asked'), 'question.asked', 30_000);
      await http(`/agent-sessions/${id}/question/${encodeURIComponent(asked.callId)}/reply`, 'POST', { answers: [['Blue']] });
      await until(() => frames.find((f) => f.type === 'question.resolved'), 'question.resolved');
    }
    await until(async () => {
      const detail = await http(`/agent-sessions/${id}`);
      return detail.session?.status === 'idle' || detail.session?.status === 'error' ? detail : false;
    }, `${name} terminal`, 75_000);
    await delay(400);
    const final = await http(`/agent-sessions/${id}/messages?limit=50`);
    assertWire(frames, id, session.sdkSessionId);
    const providerStatus = await fetch('http://127.0.0.1:6996/_s0/status').then((r) => r.json());
    const hits = providerStatus.hits.filter((h) => h.scenario === name);
    const parts = frames.filter((f) => f.type === 'message.part.updated').map((f) => f.part);
    const finalParts = final.messages?.flatMap((m) => m.parts ?? []) ?? [];
    const expected = name === 'reasoning' ? 'repeat repeat é✓' : ['tool', 'permission', 'question'].includes(name)
      ? 'tool resolved' : name === 'plain' ? 'hello hello 🌱' : null;
    if (expected) assert(finalParts.some((p) => p.type === 'text' && p.text === expected), `${name}: expected final text`);
    if (name === 'reasoning') assert(finalParts.some((p) => p.type === 'reasoning' && p.text === 'Plan Plan 🌱'), 'final reasoning');
    if (['tool', 'permission', 'question'].includes(name)) {
      assert.equal(hits.filter((h) => !h.afterTool).length, 1, `${name}: one tool request`);
      assert.equal(new Set(parts.filter((p) => p.type === 'tool' && p.state?.status === 'completed').map((p) => p.id)).size, 1,
        `${name}: exactly one completed tool`);
    }
    if (name === 'cancel') {
      assert(providerStatus.disconnects > 0, 'provider connection must disconnect on cancellation');
      assert(finalParts.some((p) => p.type === 'text' && p.text?.includes('partial-')), 'partial text persisted');
      assert(!finalParts.some((p) => p.text?.includes('unexpected-completion')), 'cancel did not complete');
    }
    if (name === 'error') {
      assert(hits.length > 1, 'retry must reach provider again');
      assert(final.messages?.some((m) => JSON.stringify(m).includes('S0 synthetic provider failure')), 'final provider error persisted');
    }
    const evidence = { kind: 'captured', sourceCommit: command('git', ['rev-parse', 'HEAD']).trim(), scenario: name,
      captureCommand: 'node apps/web/tests/live/capture-transcript-frames.mjs',
      sanitization: { 'session.id': 'preserved synthetic runtime ID', bearer: 'omitted at source',
        prompt: 'generated S0 marker only', urls: 'loopback only' },
      ids: { local: id, sdk: session.sdkSessionId }, frames, mid, final,
      expectedFinal: expected ?? (name === 'cancel' ? 'partial-' : 'S0 synthetic provider failure'),
      counts: { ws: frames.length, mid: mid.messages?.length, final: final.messages?.length },
      provider: { hits, disconnects: providerStatus.disconnects } };
    writeFileSync(resolve(output, `${name}.jsonl`), `${JSON.stringify(evidence)}\n`);
    results[name] = { status: 'PASS', ws: frames.length, mid: mid.messages?.length, final: final.messages?.length };
  } finally {
    ws.close();
    await http(`/agent-sessions/${id}/hard`, 'DELETE').catch(() => {});
  }
}
try {
  for (const port of ports) {
    const check = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    assert.equal(check.stdout.trim(), '', `refusing occupied port ${port}`);
  }
  assert(!existsSync(sandbox) && !existsSync(fixtureRoot), 'refusing existing fixture/runtime');
  command('node', ['tools/dev/sandbox_fixture.mjs', fixtureRoot]);
  const config = JSON.parse(readFileSync(`${fixtureRoot}/opencode.json`, 'utf8'));
  config.mcp.rhythm.environment.RHYTHM_API_URL = base;
  config.provider = { s0: { npm: '@ai-sdk/openai-compatible', name: 'S0 local', models: {
    's0-local': { id: 's0-local', name: 'S0 local', attachment: false, reasoning: true,
      temperature: false, tool_call: true, release_date: '2025-01-01', limit: { context: 100000, output: 10000 },
      cost: { input: 0, output: 0 }, capabilities: { reasoning: true, toolcall: true,
        interleaved: { field: 'reasoning_content' } } },
  }, options: { apiKey: 's0-local-synthetic-key', baseURL: 'http://127.0.0.1:6996/v1' } } };
  config.permission = { '*': 'allow', bash: 'ask', question: 'allow' };
  chmodSync(`${fixtureRoot}/opencode.json`, 0o600);
  writeFileSync(`${fixtureRoot}/opencode.json`, JSON.stringify(config, null, 2));
  chmodSync(`${fixtureRoot}/opencode.json`, 0o400);
  provider = spawn(process.execPath, [resolve(root, 'apps/web/tests/live/scripted-openai-provider.mjs')], {
    cwd: fixtureRoot, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  provider.stderr.on('data', (data) => { stderr += data.toString(); });
  await until(async () => fetch('http://127.0.0.1:6996/_s0/status').then((r) => r.ok).catch(() => false), 'local provider');
  command('tools/dev/sandbox.sh', ['up']); started = true;
  mkdirSync(output, { recursive: true });
  for (const name of names) {
    try { await capture(name); }
    catch (error) { results[name] = { status: 'BLOCKED', reason: String(error) }; }
    console.log(`${name}: ${JSON.stringify(results[name])}`);
  }
  results.compaction = { status: 'BLOCKED', reason: 'No bounded scripted compaction trigger without product changes' };
  results.attachments = { status: 'BLOCKED', reason: 'No approved synthetic attachment fixture or entry-point qualification' };
  writeFileSync(resolve(output, 'capture-results.json'), `${JSON.stringify(results, null, 2)}\n`);
  verifySaved();
  if (stderr) console.error(`Provider stderr: ${stderr.slice(0, 500)}`);
} finally {
  if (started) {
    try { console.log(command('tools/dev/sandbox.sh', ['down'])); }
    catch (error) { console.error(`sandbox teardown failed: ${error}`); }
  }
  if (provider) { provider.kill('SIGTERM'); await new Promise((resolveExit) => provider.once('exit', resolveExit)); }
  if (existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true });
  for (const port of ports) {
    const check = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    console.log(`port ${port}: ${check.stdout.trim() ? 'OCCUPIED' : 'clear'}`);
  }
}
