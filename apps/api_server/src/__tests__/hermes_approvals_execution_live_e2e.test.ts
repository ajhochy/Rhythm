import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { securityPayloadDigest } from '../services/external_content_security_service';

const live = process.env.RHYTHM_LIVE_E2E === '1';

// Only the upstream model response is synthetic. API, stdio MCP, engine,
// ephemeral engine signatures, authorization and SQLite are real/unmocked.
function stream(model: string, calls: Record<string, unknown>[]) {
  const events: unknown[] = [{type: 'message_start', message: {id: randomUUID(), type: 'message', role: 'assistant', model,
    content: [], stop_reason: null, stop_sequence: null, usage: {input_tokens: 5, output_tokens: 0}}}];
  if (calls.length) calls.forEach((input, index) => events.push(
    {type: 'content_block_start', index, content_block: {type: 'tool_use', id: `toolu_${randomUUID().replaceAll('-', '')}`, name: 'rhythm_rhythm_create_task', input: {}}},
    {type: 'content_block_delta', index, delta: {type: 'input_json_delta', partial_json: JSON.stringify(input)}},
    {type: 'content_block_stop', index}));
  else events.push({type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
    {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'Synthetic gate check finished.'}}, {type: 'content_block_stop', index: 0});
  events.push({type: 'message_delta', delta: {stop_reason: calls.length ? 'tool_use' : 'end_turn', stop_sequence: null}, usage: {input_tokens: 5, output_tokens: 5}}, {type: 'message_stop'});
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
}

describe.skipIf(!live)('Hermes approvals — real engine signed execution gate', () => {
  it('AC5 external stdio approval authorizes only unchanged payload once; reject/expiry/replay/changed cards never execute', async () => {
    assertLiveE2EIsolation();
    const requireMcp = createRequire(resolve('../mcp_server/package.json'));
    const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
    const base = process.env.RHYTHM_LIVE_URL!;
    const engine = process.env.RHYTHM_LIVE_ENGINE_URL!;
    const sb = realpathSync(process.env.RHYTHM_SANDBOX_DIR!);
    expect(sb.startsWith('/private/tmp/hermes-approvals-')).toBe(true);
    expect(realpathSync(process.env.DB_PATH!)).toBe(`${sb}/rhythm.db`);
    for (const address of [base, engine]) {
      const url = new URL(address); expect(url.hostname).toBe('127.0.0.1');
      expect(['4001', '4096', ''].includes(url.port)).toBe(false);
    }
    const db = new Database(process.env.DB_PATH!);
    const token = randomBytes(32).toString('hex');
    const providerId = `hermes-fixture-${randomUUID()}`;
    const model = 'hermes-safe-gate';
    const localId = randomUUID();
    const cards: string[] = [];
    const titles: string[] = [];
    let sdkId: string | undefined;
    let provider: Server | undefined;
    let nextCalls: Record<string, unknown>[] = [];
    let providerRequests = 0;
    let advertised = false;
    const originalConfig = JSON.parse(readFileSync(`${sb}/home/.config/opencode/opencode.json`, 'utf8'));
    const client = new Client({name: 'hermes-gate-acceptance', version: '1'});
    async function api(url: string, path: string, body?: unknown) {
      const response = await fetch(`${url}${path}`, {method: body === undefined ? 'GET' : 'POST',
        headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
      expect(response.ok, `safe fixture HTTP status ${response.status} at ${path}`).toBe(true);
      return response.json();
    }
    async function patchConfig(config: unknown) {
      expect((await fetch(`${engine}/global/config`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(config)})).status).toBe(200);
      expect((await fetch(`${base}/system/refresh`, {method: 'POST'})).status).toBe(200);
    }
    async function call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({name, arguments: args});
      expect(Boolean(result.isError), 'real external stdio approval must succeed').toBe(false);
      return JSON.parse(result.content[0].text);
    }
    function seed(label: string) {
      const id = randomUUID(); const title = `Hermes safe gate ${label} ${randomUUID()}`;
      cards.push(id); titles.push(title);
      const payload = {title};
      db.prepare(`INSERT INTO agent_approvals
        (id,session_id,agent_config_id,action,preview,consequence,status,security_action,payload_digest,
         taint_id,tainted_turn_id,bound_agent,expires_at,decision_nonce)
        VALUES (?,?,'manager','Authorize task.create',?,'Sandbox-only task','pending','task.create',?,
          'hermes-fixture-taint','hermes-fixture-turn','build',?,?)`).run(id, localId, JSON.stringify(payload),
        securityPayloadDigest('task.create', payload), new Date(Date.now()+600_000).toISOString(), randomBytes(32).toString('base64url'));
      return {id,title,payload};
    }
    async function decide(f: {id: string}, decision: string) {
      const c = await call('rhythm_get_pending_approval', {approvalId: f.id});
      return call('rhythm_decide_approval', {approvalId: f.id, revision: c.revision, cardHash: c.cardHash, decision, attestation: 'owner_chose_in_chat'});
    }
    async function prompt(calls: Record<string, unknown>[]) {
      nextCalls = calls;
      await api(engine, `/session/${sdkId}/message`, {agent: 'build', model: {providerID: providerId, modelID: model}, parts: [{type: 'text', text: 'Exercise only the supplied synthetic task gate.'}]});
    }
    const taskCount = (title: string) => (db.prepare('SELECT count(*) as n FROM tasks WHERE title = ?').get(title) as {n:number}).n;
    const consumed = (id: string) => (db.prepare('SELECT consumed_at FROM agent_approvals WHERE id = ?').get(id) as {consumed_at:string|null}).consumed_at;
    try {
      db.prepare('INSERT INTO sessions(token,user_id) VALUES (?,1)').run(token);
      await client.connect(new StdioClientTransport({command: process.execPath, args: [resolve('../mcp_server/dist/index.js')], stderr: 'pipe',
        env: {PATH: process.env.PATH!, HOME: `${sb}/home`, RHYTHM_API_URL: base, RHYTHM_AGENT_URL: base, RHYTHM_API_TOKEN: token}}));
      // First observable entry check is independent of the engine/provider fixture.
      await call('rhythm_list_pending_approvals', {});
      provider = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          advertised ||= (body.tools ?? []).some((tool: {name:string}) => tool.name === 'rhythm_rhythm_create_task');
          providerRequests++;
          const calls = nextCalls; nextCalls = [];
          response.writeHead(200, {'Content-Type':'text/event-stream'}); response.end(stream(model, calls));
        });
      });
      await new Promise<void>((done,reject) => {provider!.once('error',reject); provider!.listen(0,'127.0.0.1',done);});
      const port = (provider.address() as {port:number}).port;
      await api(base, '/opencode/mcp/rhythm/ensure', {apiToken: token, apiUrl: base});
      const config = JSON.parse(readFileSync(`${sb}/home/.config/opencode/opencode.json`, 'utf8'));
      config.mcp.rhythm.environment.RHYTHM_AGENT_URL = base;
      config.provider = {...config.provider, [providerId]: {npm:'@ai-sdk/anthropic', name:'Hermes safe fixture',
        options:{apiKey:randomBytes(32).toString('hex'),baseURL:`http://127.0.0.1:${port}/v1`},
        models:{[model]:{name:model,limit:{context:200000,output:4096}}}}};
      await patchConfig(config);
      const created = await fetch(`${engine}/session`, {method:'POST', headers:{'Content-Type':'application/json','X-OpenCode-Directory':sb},
        body:JSON.stringify({title:'Hermes synthetic execution gate',permission:[{permission:'*',pattern:'*',action:'allow'}]})});
      expect(created.status).toBe(200); sdkId = (await created.json() as {id: string}).id;
      db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,cwd,sdk_session_id,owner_user_id,permission_mode)
        VALUES (?,'Hermes synthetic execution','manager','completed',?,?,1,'default')`).run(localId,sb,sdkId);
      db.prepare(`INSERT INTO agent_external_taint_state(session_id,sdk_session_id,taint_id,latest_event_id,tainted_turn_id,tainted_agent,source,updated_at)
        VALUES (?,?,'hermes-fixture-taint',?,'hermes-fixture-turn','build','gmail.search',?)`).run(localId,sdkId,randomUUID(),new Date().toISOString());

      const approved = seed('concurrent'); await decide(approved,'approved');
      await prompt([{title:approved.title,approval_id:approved.id},{title:approved.title,approval_id:approved.id}]);
      expect(taskCount(approved.title), 'two real signed tool calls yield one task').toBe(1);
      expect(consumed(approved.id)).not.toBeNull();
      await prompt([{title:approved.title,approval_id:approved.id}]);
      expect(taskCount(approved.title), 'fresh signed proof cannot replay consumed approval').toBe(1);

      const rejected = seed('rejected'); await decide(rejected,'rejected');
      await prompt([{title:rejected.title,approval_id:rejected.id}]);
      expect(taskCount(rejected.title)).toBe(0); expect(consumed(rejected.id)).toBeNull();

      const changed = seed('changed'); await decide(changed,'approved');
      db.prepare('UPDATE agent_approvals SET preview = ?, payload_digest = ? WHERE id = ?')
        .run('Changed after approval',securityPayloadDigest('task.create',{title:`${changed.title} altered`}),changed.id);
      titles.push(`${changed.title} altered`);
      await prompt([{title:`${changed.title} altered`,approval_id:changed.id}]);
      expect(taskCount(`${changed.title} altered`)).toBe(0); expect(consumed(changed.id)).toBeNull();

      const mismatch = seed('mismatch'); await decide(mismatch,'approved'); titles.push(`${mismatch.title} altered`);
      await prompt([{title:`${mismatch.title} altered`,approval_id:mismatch.id}]);
      expect(taskCount(`${mismatch.title} altered`)).toBe(0); expect(consumed(mismatch.id)).toBeNull();

      const expired = seed('expired'); await decide(expired,'approved');
      db.prepare('UPDATE agent_approvals SET expires_at = ? WHERE id = ?').run(new Date(0).toISOString(),expired.id);
      await prompt([{title:expired.title,approval_id:expired.id}]);
      expect(taskCount(expired.title)).toBe(0); expect(consumed(expired.id)).toBeNull();
      expect(advertised).toBe(true); expect(providerRequests).toBeGreaterThanOrEqual(12);
      console.log('LIVE HERMES GATE: external SDK→built stdio→real API decisions; real fork signed task calls: one concurrent task/consumption, replay/reject/changed/hash-mismatch/expiry=0 tasks');
    } finally {
      await client.close();
      if (sdkId) await fetch(`${engine}/session/${sdkId}`, {method:'DELETE',headers:{'X-OpenCode-Directory':sb}});
      if (provider) await patchConfig(originalConfig);
      await new Promise<void>(done => provider?.close(() => done()) ?? done());
      for (const title of titles) db.prepare('DELETE FROM tasks WHERE title = ?').run(title);
      for (const id of cards) db.prepare('DELETE FROM agent_approvals WHERE id = ?').run(id);
      db.prepare('DELETE FROM agent_external_taint_state WHERE session_id = ?').run(localId);
      db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(localId);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token); db.close();
    }
  }, 120_000);
});
