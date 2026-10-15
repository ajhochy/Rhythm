import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../../..');
const fixture = '/private/tmp/hermes-shipping-approval-engine-20261014-fixture';
const sb = '/private/tmp/hermes-shipping-approval-engine-20261014-sandbox';
const base = 'http://127.0.0.1:5198', engine = 'http://127.0.0.1:5197';
const runtime = `${root}/tools/dev/.hermes-shipping-runtime`;
const node = `${runtime}/node/bin/node`;
const bin = `${runtime}/dist/opencode-darwin-arm64/bin/opencode`;
const digest = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const requireApi = createRequire(`${root}/apps/api_server/package.json`);
const requireMcp = createRequire(`${root}/apps/mcp_server/package.json`);
const Database = requireApi('better-sqlite3');
const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
const files = ['apps/mcp_server/src/index.ts', 'apps/mcp_server/src/tools/relayApprovals.ts',
  'apps/mcp_server/src/tools/tasks.ts', 'apps/mcp_server/src/security/security_context.ts',
  'apps/mcp_server/src/security/external_content_boundary.ts', 'apps/api_server/src/controllers/relay_approvals_controller.ts',
  'apps/api_server/src/security/relay_approval_security.ts', 'apps/api_server/src/security/trusted_mcp_call.ts',
  'apps/api_server/src/controllers/external_content_security_controller.ts', 'apps/api_server/src/services/external_content_security_service.ts',
  'apps/api_server/src/repositories/agent_approvals_repository.ts', 'apps/api_server/src/routes/agent_approvals_routes.ts',
  'apps/api_server/src/services/agent_approval_continuation_service.ts', 'apps/api_server/src/routes/agents_models_routes.ts',
  'apps/api_server/src/app.ts', 'tools/dev/sandbox.sh', 'tools/dev/sandbox_fixture.mjs',
  'apps/opencode_fork/packages/opencode/src/mcp/index.ts'];
const compiled = ['apps/mcp_server/dist/index.js', 'apps/mcp_server/dist/tools/tasks.js', 'apps/mcp_server/dist/tools/relayApprovals.js',
  'apps/api_server/dist/controllers/relay_approvals_controller.js', 'apps/api_server/dist/security/relay_approval_security.js',
  'apps/api_server/dist/security/trusted_mcp_call.js', 'apps/api_server/dist/services/external_content_security_service.js',
  'apps/api_server/dist/controllers/external_content_security_controller.js', 'apps/api_server/dist/routes/agent_approvals_routes.js'];

export async function setup() {
  assert.equal(process.env.RHYTHM_LIVE_E2E, '1');
  assert.equal(root, '/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014');
  assert.equal(process.execPath, node);
  assert.equal(process.version, 'v22.23.0');
  assert.equal(digest(bin), 'd60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072');
  const evidence = { sourceBefore: Object.fromEntries(files.map(p => [p, digest(`${root}/${p}`)])), engineSha256: digest(bin), providerRequests: 0, emittedCalls: 0, prompts: [] };
  const fixtures = new Map(), clients = [];
  let db, up = false, nextCalls = [];
  const providerId = 'hermes-approval-fixture', model = 'safe-task-gate';
  const provider = createServer(async (request, response) => {
    // No forwarding, no callback into the SUT, no real provider/credential.
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model', owned_by: 'synthetic' }] })); return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    evidence.providerRequests++;
    evidence.advertisedTools = (body.tools ?? []).map(t => t.function.name);
    // ponytail: one queued turn, consumed once; tests are deliberately serial.
    const calls = nextCalls; nextCalls = [];
    const id = `chatcmpl-${randomUUID()}`, created = Math.floor(Date.now() / 1000);
    const event = (delta, finish_reason = null) => ({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason }] });
    const events = [event({ role: 'assistant', content: '' })];
    if (calls.length) {
      events.push(event({ tool_calls: calls.map((args, index) => ({ index, id: `call_${randomUUID()}`, type: 'function', function: { name: 'rhythm_rhythm_create_task', arguments: JSON.stringify(args) } })) }));
      evidence.emittedCalls += calls.length;
    } else events.push(event({ content: 'Synthetic safe gate finished.' }));
    events.push(event({}, calls.length ? 'tool_calls' : 'stop'));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n');
  });
  await new Promise((done, fail) => { provider.once('error', fail); provider.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${provider.address().port}`;
  const env = { PATH: `${resolve(node, '..')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: fixture,
    RHYTHM_APPROVED_FIXTURE_ROOT: fixture, RHYTHM_LIVE_DB_PATH: `${fixture}/rhythm.db`,
    RHYTHM_SANDBOX_OPENCODE_CONFIG: `${fixture}/approval-opencode-${randomUUID()}.json`, RHYTHM_SANDBOX_DIR: sb,
    RHYTHM_SANDBOX_API_PORT: '5198', RHYTHM_SANDBOX_ENGINE_PORT: '5197', RHYTHM_SANDBOX_GATEWAY_PORT: '5199',
    RHYTHM_SANDBOX_NODE_BIN: node, RHYTHM_SANDBOX_ENGINE_DIR: runtime, RHYTHM_SANDBOX_SKIP_ENGINE_BUILD: '1',
    DB_CLIENT: 'sqlite', RHYTHM_OPTIMIZER_MODE: 'shadow', OPENCODE_PURE: '1', OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', RHYTHM_NUMBAT_MONITORING_DISABLED: '1' };
  async function command(file, args) {
    const result = await exec(file, args, { cwd: root, env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    // Build/lifecycle output is synthetic; never print child environment or tokens.
    console.log(result.stdout.trim()); return result;
  }
  async function http(url, path, body, token, method) {
    const response = await fetch(`${url}${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', ...(url === engine && { 'X-OpenCode-Directory': sb }), ...(token && { Authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    assert.ok(response.ok, `HTTP ${response.status} at ${path}`); return response.json();
  }
  async function close() {
    for (const client of clients) await client.close();
    if (existsSync(`${sb}/api_server.log`)) {
      // Actual HTTP handler outcomes, not a mocked function-call counter. These
      // seven specific refusals occur AFTER real Ed25519 verification succeeds.
      evidence.consumeHttpDenials = readFileSync(`${sb}/api_server.log`, 'utf8').split('\n')
        .filter(line => line.includes('POST /agent-approvals/consume — '))
        .map(line => line.split('POST /agent-approvals/consume — ')[1].split(' { authUserId:')[0]);
    }
    const effect = db ? db.prepare('SELECT count(*) n FROM tasks').get().n : 0;
    evidence.totalTasks = effect;
    db?.close();
    try { if (up || existsSync(`${sb}/api_server.pid`)) await command('/bin/bash', ['tools/dev/sandbox.sh', 'down']); }
    finally {
      provider.closeAllConnections(); await new Promise(done => provider.close(done));
      evidence.sourceAfter = Object.fromEntries(files.map(p => [p, digest(`${root}/${p}`)]));
      evidence.engineAfter = digest(bin);
      if (evidence.compiledBefore) evidence.compiledAfter = Object.fromEntries(compiled.map(p => [p, digest(`${root}/${p}`)]));
      writeFileSync(`${fixture}/receipt-${randomUUID()}.json`, JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o400 });
      assert.deepEqual(evidence.sourceAfter, evidence.sourceBefore, 'relevant source changed concurrently: parent must requalify');
      assert.equal(evidence.engineAfter, evidence.engineSha256);
      if (evidence.compiledBefore) assert.deepEqual(evidence.compiledAfter, evidence.compiledBefore, 'compiled approval payload changed: requalify');
      if (evidence.approved && evidence.negatives && evidence.external && evidence.rejected) {
        assert.equal(effect, 1, 'whole isolated task table has exactly one safe effect');
        assert.equal(evidence.consumeHttpDenials.length, 7, 'seven actual signed HTTP consume refusals');
        assert.ok(evidence.consumeHttpDenials.every(reason => !/trusted MCP|signature|engine key/.test(reason)), 'no negative case may pass by failing signature verification');
      }
      console.log(JSON.stringify({ teardown: 'stock sandbox down', providerRequests: evidence.providerRequests, emittedCalls: evidence.emittedCalls, sourceUnchanged: true, engineUnchanged: true }));
    }
  }
  try {
    assert.ok(!existsSync(sb), 'refuse existing sandbox');
    for (const port of [5198, 5197, 5199]) {
      const result = await exec('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).catch(e => { assert.equal(e.code, 1); return { stdout: '' }; });
      assert.equal(result.stdout, '', `owned port ${port} must be free`);
    }
    if (!existsSync(fixture)) await command(node, ['tools/dev/sandbox_fixture.mjs', fixture]);
    assert.equal(realpathSync(fixture), fixture);
    assert.equal(lstatSync(`${fixture}/rhythm.db`).mode & 0o222, 0);
    const fixtureDb = new Database(`${fixture}/rhythm.db`, { readonly: true });
    assert.deepEqual(fixtureDb.prepare('SELECT email FROM users ORDER BY id').all().map(r => r.email), ['admin@example.invalid', 'member@example.invalid']); fixtureDb.close();
    const token = readFileSync(`${fixture}/opencode.json`, 'utf8');
    const config = JSON.parse(token);
    config.mcp.rhythm.command = [node, `${root}/apps/mcp_server/dist/index.js`];
    config.mcp.rhythm.environment.RHYTHM_API_URL = base;
    config.mcp.rhythm.environment.RHYTHM_AGENT_URL = base;
    config.provider = { [providerId]: { npm: '@ai-sdk/openai-compatible', name: 'Synthetic safe task gate',
      options: { apiKey: randomBytes(32).toString('hex'), baseURL: `${origin}/v1` },
      models: { [model]: { name: model, tool_call: true, attachment: false, modalities: { input: ['text'], output: ['text'] }, limit: { context: 200000, output: 4096 } } } } };
    config.model = `${providerId}/${model}`;
    config.small_model = `${providerId}/${model}`;
    writeFileSync(env.RHYTHM_SANDBOX_OPENCODE_CONFIG, JSON.stringify(config), { flag: 'wx', mode: 0o400 });
    await command('/bin/bash', ['tools/dev/sandbox.sh', 'up']); up = true;
    await command('/bin/bash', ['tools/dev/sandbox.sh', 'status']);
    evidence.compiledBefore = Object.fromEntries(compiled.map(p => [p, digest(`${root}/${p}`)]));
    evidence.nodeSha256 = digest(node);
    // Confirm actual runtime cloud fallback cannot contact production, before bad-token calls.
    const pid = readFileSync(`${sb}/api_server.pid`, 'utf8').trim();
    const ps = await exec('/bin/ps', ['eww', '-p', pid, '-o', 'command=']);
    assert.ok(ps.stdout.includes(`PROD_API_URL=${base}`));
    assert.ok(!ps.stdout.includes('RHYTHM_CLOUD_API_URL='));
    evidence.cloudBoundary = 'PROD_API_URL=loopback5198; relay routes use requireAuth (no cloud fallback)';
    db = new Database(`${sb}/rhythm.db`);
    const credentials = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
    db.prepare('INSERT INTO sessions(token,user_id) VALUES (?,1),(?,2)').run(credentials[0], credentials[1]);
    const credentialFile = `${fixture}/client-credentials-${randomUUID()}.json`;
    writeFileSync(credentialFile, JSON.stringify(credentials), { flag: 'wx', mode: 0o400 });
    const protectedCredentials = JSON.parse(readFileSync(credentialFile, 'utf8'));
    async function connect(index) {
      const client = new Client({ name: 'shipping-hermes-approval-acceptance', version: '1' });
      clients.push(client);
      await client.connect(new StdioClientTransport({ command: node, args: [`${root}/apps/mcp_server/dist/index.js`], stderr: 'pipe',
        env: { PATH: env.PATH, HOME: `${sb}/home`, RHYTHM_API_URL: base, RHYTHM_AGENT_URL: base, RHYTHM_API_TOKEN: protectedCredentials[index] } }));
      return client;
    }
    const owner = await connect(0), other = await connect(1), bad = await connect(2);
    const me = await http(base, '/auth/me', undefined, protectedCredentials[0]);
    assert.equal(me.user.id, 1); assert.equal(me.user.name, 'Synthetic Admin');
    const loaded = await http(engine, '/global/config');
    assert.equal(loaded.provider[providerId].options.baseURL, `${origin}/v1`);
    assert.equal(loaded.mcp.rhythm.environment.RHYTHM_AGENT_URL, base);
    const catalog = await http(base, '/agents/models/catalog');
    const declared = catalog.find(r => r.provider === providerId && r.modelId === model);
    assert.ok(declared, 'current C74 API must expose declared synthetic provider model');
    assert.equal(declared.available, true, 'synthetic GET /models inventory must verify configured model');
    evidence.catalog = declared;
    const sdk = await http(engine, '/session', { title: 'Synthetic shipping approval gate',
      mcpAllowlist: { servers: [], tools: ['rhythm_rhythm_create_task'], deferred: false }, permission: [
      { permission: '*', pattern: '*', action: 'deny' }, { permission: 'rhythm_rhythm_create_task', pattern: '*', action: 'allow' }] });
    const localId = randomUUID();
    db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,sdk_session_id,owner_user_id,permission_mode)
      VALUES (?,'Synthetic shipping approval gate','manager','completed',?,?,1,'default')`).run(localId, sb, sdk.id);
    const taint = randomUUID(), turn = randomUUID();
    db.prepare(`INSERT INTO agent_external_taint_state(session_id,sdk_session_id,taint_id,latest_event_id,tainted_turn_id,tainted_agent,source,updated_at)
      VALUES (?,?,?,?,?,'build','gmail.search',?)`).run(localId, sdk.id, taint, randomUUID(), turn, new Date().toISOString());
    function seed(label, ownerId = 1) {
      let sessionId = localId;
      if (ownerId !== 1) {
        sessionId = randomUUID();
        db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,sdk_session_id,owner_user_id,permission_mode)
          VALUES (?,'Synthetic ownership negative','manager','completed',?,?,?,'default')`).run(sessionId, sb, `synthetic-negative-${randomUUID()}`, ownerId);
        db.prepare(`INSERT INTO agent_external_taint_state(session_id,sdk_session_id,taint_id,latest_event_id,tainted_turn_id,tainted_agent,source,updated_at)
          VALUES (?,? ,?,?,?,'build','gmail.search',?)`).run(sessionId, `synthetic-negative-${randomUUID()}`, taint, randomUUID(), turn, new Date().toISOString());
      }
      const id = randomUUID(), title = `Synthetic safe shipping task ${label} ${randomUUID()}`;
      const payload = { title, notes: 'Local synthetic acceptance only; no external systems' };
      // Canonical task payload has only sorted notes/title keys, matching C74 digest.
      const payloadDigest = createHash('sha256').update(`task.create\n${JSON.stringify({ notes: payload.notes, title })}`).digest('hex');
      db.prepare(`INSERT INTO agent_approvals(id,session_id,agent_config_id,action,preview,consequence,status,security_action,payload_digest,taint_id,tainted_turn_id,bound_agent,expires_at,decision_nonce)
        VALUES (?,?,'manager','Authorize task.create',?,'Only one safe task in the isolated synthetic database','pending','task.create',?,?,?,'build',?,?)`)
        .run(id, sessionId, JSON.stringify(payload), payloadDigest, taint, turn, new Date(Date.now() + 600_000).toISOString(), randomBytes(32).toString('base64url'));
      const f = { id, title, payload }; fixtures.set(id, f); return f;
    }
    async function call(client, name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, `external SDK ${name} must succeed`);
      return JSON.parse(result.content[0].text);
    }
    const get = f => call(owner, 'rhythm_get_pending_approval', { approvalId: f.id });
    const rawDecision = (client, card, decision, patch = {}) => client.callTool({ name: 'rhythm_decide_approval', arguments: {
      approvalId: card.id, revision: card.revision, cardHash: card.cardHash, decision, attestation: 'owner_chose_in_chat', ...patch } });
    async function decide(f, decision, card) {
      const result = await rawDecision(owner, card ?? await get(f), decision);
      assert.ok(!result.isError, 'exact explicit owner decision must succeed'); return JSON.parse(result.content[0].text);
    }
    async function prompt(calls) {
      const start = evidence.emittedCalls;
      nextCalls = calls;
      const result = await http(engine, `/session/${sdk.id}/message`, { agent: 'build', model: { providerID: providerId, modelID: model },
        parts: [{ type: 'text', text: `Synthetic approval gate ${randomUUID()}: only emit supplied safe task arguments; no other tools.` }] });
      const transcript = await http(engine, `/session/${sdk.id}/message`);
      const expected = new Set(calls.map(c => c.approval_id));
      const prior = new Set(evidence.prompts.flatMap(p => p.results.map(r => r.callID)));
      const results = transcript.flatMap(m => m.parts ?? []).filter(p => p.type === 'tool' && p.tool === 'rhythm_rhythm_create_task' && !prior.has(p.callID) && expected.has(p.state?.input?.approval_id))
        .map(p => ({ callID: p.callID, tool: p.tool, status: p.state.status, output: p.state.output ?? p.state.error ?? '', success: p.state.status === 'completed' && !String(p.state.output).startsWith('Blocked:') && String(p.state.output).includes('"id"') }));
      evidence.prompts.push({ emitted: evidence.emittedCalls - start, messageId: result.info?.id, results });
      assert.equal(evidence.emittedCalls - start, calls.length, 'actual upstream must emit every supplied call');
      assert.equal(results.length, calls.length, 'actual engine transcript must contain every emitted call');
      assert.ok(evidence.advertisedTools.includes('rhythm_rhythm_create_task'), 'actual model request must advertise the selected task tool');
      return results;
    }
    return { db, owner, other, bad, evidence, fixtures, seed, call, get, decide, rawDecision, prompt, close,
      args: f => ({ ...f.payload, approval_id: f.id }), row: f => db.prepare('SELECT * FROM agent_approvals WHERE id=?').get(f.id),
      count: f => db.prepare('SELECT count(*) n FROM tasks WHERE title=?').get(f.title).n,
      countTitle: title => db.prepare('SELECT count(*) n FROM tasks WHERE title=?').get(title).n };
  } catch (error) { await close(); throw error; }
}
