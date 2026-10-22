// Loopback scripted model for the approval/owner live contract. It never calls
// a real provider: each reply is chosen from the conversation the sandbox engine
// sends, so the engine itself signs every Rhythm MCP call it makes.
//
//   --prepare <new /private/tmp dir>  synthetic sandbox fixture (DB + config + test key)
//   (no args)                         serve /v1/chat/completions on the assigned port
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createECDH, createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const port = Number(process.env.RHYTHM_APPROVAL_OWNER_PROVIDER_PORT ?? '7496');
const apiPort = Number(process.env.RHYTHM_SANDBOX_API_PORT ?? '7493');
if (!Number.isInteger(port) || port < 7490 || port > 7499) {
  throw new Error('RHYTHM_APPROVAL_OWNER_PROVIDER_PORT must be in the assigned 7490-7499 block');
}
const apiKey = 'approval-owner-synthetic-only';
export const PROVIDER_ID = 'approvalowner';
export const MODEL_ID = 'approval-owner-scripted';
export const SYNTHETIC_TOKEN = 'e02-synthetic-session-not-a-secret';
export const OTHER_USER_TOKEN = 'approval-owner-other-user-not-a-secret';
// The exact live payload from the 2026-10-22 report, including U+2014 and an apostrophe.
export const TASK_ARGS = {
  title: 'Reply to Grace De Raadt — Christmas program ideas doc',
  notes: "Grace (Children's Ministry Co-Director) sent a Google Doc of Christmas program ideas on 2026-10-21. Work inbox (ajh@visaliacrc.com), message id 1a16028669f347f1. Review the doc and reply.",
  due_date: '2026-10-23',
};

if (process.argv[2] === '--prepare') {
  const fixture = resolve(process.argv[3] ?? '/');
  if (!fixture.startsWith('/private/tmp/')) throw new Error('fixture must be a new /private/tmp directory');
  // Synthetic users 1-2 and the user-1 bearer come from the shared sandbox fixture.
  const base = spawnSync(process.execPath, [resolve(root, 'tools/dev/sandbox_fixture.mjs'), fixture], { stdio: 'inherit' });
  if (base.status !== 0) process.exit(base.status ?? 1);
  const require = createRequire(resolve(root, 'apps/api_server/package.json'));
  const seed = spawnSync(process.execPath, ['--import', require.resolve('tsx'), fileURLToPath(import.meta.url), '--seed', fixture], { stdio: 'inherit' });
  if (seed.status !== 0) process.exit(seed.status ?? 1);
  mkdirSync(`${fixture}/opencode`, { mode: 0o700 });
  writeFileSync(`${fixture}/opencode/opencode.json`, `${JSON.stringify({
    mcp: { rhythm: { type: 'local', command: ['node', resolve(root, 'apps/mcp_server/dist/index.js')],
      environment: { RHYTHM_API_URL: `http://127.0.0.1:${apiPort}`, RHYTHM_API_TOKEN: SYNTHETIC_TOKEN } } },
    provider: { [PROVIDER_ID]: { npm: '@ai-sdk/openai-compatible', name: 'Approval/owner loopback scripted provider',
      options: { apiKey, baseURL: `http://127.0.0.1:${port}/v1` },
      models: { [MODEL_ID]: { name: 'Approval/owner scripted', limit: { context: 40_000, output: 2_000 } } } } },
  }, null, 2)}\n`, { flag: 'wx', mode: 0o400 });
  // Throwaway desktop-human signer. The sandbox gets only the public half.
  const capability = randomBytes(32).toString('base64url');
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  writeFileSync(`${fixture}/human-approval.json`, JSON.stringify({
    capability, privateKey: ecdh.getPrivateKey('base64'), publicKey: ecdh.getPublicKey('base64', 'uncompressed'),
    capabilitySha256: createHash('sha256').update(capability).digest('hex'),
  }), { flag: 'wx', mode: 0o600 });
  console.log(`Approval/owner fixture: ${fixture}`);
  process.exit(0);
}

if (process.argv[2] === '--seed') {
  const fixture = process.argv[3];
  const Database = createRequire(resolve(root, 'apps/api_server/package.json'))('better-sqlite3');
  const { initializeMobilePairingSchema } = await import(resolve(root, 'apps/api_server/src/repositories/mobile_devices_repository.ts'));
  // The shared fixture leaves its source DB read-only; only this seed reopens it.
  chmodSync(`${fixture}/rhythm.db`, 0o600);
  const db = new Database(`${fixture}/rhythm.db`);
  initializeMobilePairingSchema(db);
  db.exec(`
    -- Older than the user-1 bearer: the sandbox registers its MCP server with the newest one.
    INSERT INTO sessions (token, user_id, created_at) VALUES ('${OTHER_USER_TOKEN}', 2, '2026-01-01 00:00:00');
    INSERT INTO mobile_devices (id, host_id, user_id, name, token_verifier, created_at)
      VALUES ('approval-owner-phone', 'sandbox', 1, 'Synthetic phone', 'synthetic-verifier', '2026-10-22T00:00:00Z');
    INSERT INTO agent_scheduled_tasks (id, name, prompt, enabled) VALUES ('legacy-briefing', 'legacy briefing', '[S] legacy', 0);
    INSERT INTO agent_sessions (id, agent_kind, cwd, name, status, scheduled_task_id, is_system, category, created_at, updated_at)
      VALUES ('legacy-ownerless-run', 'claude-code', '/tmp', 'Scheduled: legacy briefing', 'idle', 'legacy-briefing', 1, 'scheduled', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
  `);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  db.close();
  chmodSync(`${fixture}/rhythm.db`, 0o400);
  process.exit(0);
}

const log = [];
function chunk(delta = {}, finishReason = null) {
  return { id: 'chatcmpl-approval-owner', object: 'chat.completion.chunk', created: 1, model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }] };
}
function text(message) {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content.map((part) => typeof part === 'string' ? part : part?.text ?? part?.output?.value ?? '').join('');
}
function say(response, content) {
  response.write(`data: ${JSON.stringify(chunk({ role: 'assistant' }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({ content }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
  response.end('data: [DONE]\n\n');
}
// Calls the Rhythm MCP tool directly when the engine exposes it, or through the
// deferred dispatcher when it does not.
function call(response, tools, tool, args, id) {
  const names = (tools ?? []).map((item) => item?.function?.name).filter(Boolean);
  const direct = names.find((name) => name === `rhythm_${tool}` || name.endsWith(`_${tool}`));
  const [name, argumentsJson] = direct
    ? [direct, JSON.stringify(args)]
    : ['mcp_dispatch', JSON.stringify({ name: `rhythm_${tool}`, arguments: args })];
  response.write(`data: ${JSON.stringify(chunk({ role: 'assistant' }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({ tool_calls: [{ index: 0, function: { arguments: argumentsJson } }] }))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\n`);
  response.end('data: [DONE]\n\n');
}

function reply(body, response) {
  const messages = body.messages ?? [];
  const lastUser = messages.map((message, index) => ({ message, index })).filter(({ message }) => message.role === 'user').at(-1);
  const prompt = text(lastUser?.message);
  const results = messages.slice((lastUser?.index ?? 0) + 1).filter((message) => message.role === 'tool').map(text);
  const approvalId = /approval_id: ([0-9a-f-]{36})/.exec(prompt)?.[1];
  log.push({ prompt: prompt.slice(0, 120), results: results.map((result) => result.slice(0, 200)) });

  if (prompt.includes('[CHILD]')) return say(response, 'CHILD_OK delegated run finished');
  if (prompt.includes('[S]')) return say(response, 'BRIEFING_DONE');
  if (prompt.includes('[A1]')) {
    if (results.length === 0) return call(response, body.tools, 'request_approval', {
      action: 'Create the Grace follow-up task', consequence: 'Adds one task to Rhythm.',
      security_action: 'task.create', security_payload: TASK_ARGS,
    }, 'call-a1-request');
    return say(response, 'AWAITING_APPROVAL');
  }
  if (prompt.includes('[B1]')) {
    if (results.length === 0) return call(response, body.tools, 'request_approval', {
      action: 'Delegate the follow-up', consequence: 'Starts one specialist run.',
      security_action: 'delegation.start',
      security_payload: { targetAgentConfigId: process.env.RHYTHM_APPROVAL_OWNER_SPECIALIST ?? '', prompt: '[CHILD] confirm the follow-up' },
    }, 'call-b1-request');
    return say(response, 'AWAITING_APPROVAL');
  }
  if (approvalId && prompt.includes('[Rhythm human approval decision]')) {
    const delegation = messages.some((message) => text(message).includes('[B1]'));
    if (delegation) {
      if (results.length === 0) return call(response, body.tools, 'delegate', {
        targetAgentConfigId: process.env.RHYTHM_APPROVAL_OWNER_SPECIALIST ?? '', prompt: '[CHILD] confirm the follow-up',
        approval_id: approvalId,
      }, 'call-b2-delegate');
      return say(response, `DELEGATION_RESULT ${results.at(-1)}`);
    }
    // First an altered payload, which must stay blocked without burning the
    // token, then the exact approved one.
    if (results.length === 0) return call(response, body.tools, 'create_task', { ...TASK_ARGS, title: `${TASK_ARGS.title} (edited)`, approval_id: approvalId }, 'call-a2-altered');
    if (results.length === 1) return call(response, body.tools, 'create_task', { ...TASK_ARGS, approval_id: approvalId }, 'call-a2-exact');
    return say(response, `TASK_RESULT ${results.at(-1)}`);
  }
  return say(response, 'IDLE');
}

const server = http.createServer(async (request, response) => {
  if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::1') return response.writeHead(403).end();
  if (request.url === '/_approval_owner/log') {
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify(log));
  }
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST' || request.headers.authorization !== `Bearer ${apiKey}`) {
    return response.writeHead(403).end();
  }
  const parts = [];
  for await (const part of request) parts.push(part);
  let body;
  try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return response.writeHead(400).end(); }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  reply(body, response);
});
server.on('error', (error) => { process.stderr.write(`${error?.stack ?? error}\n`); process.exitCode = 1; });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
server.listen(port, '127.0.0.1');
