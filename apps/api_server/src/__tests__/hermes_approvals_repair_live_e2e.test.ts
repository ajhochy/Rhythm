import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { canonicalHumanApprovalDecision } from '../security/human_approval_security';

const live = process.env.RHYTHM_LIVE_E2E === '1';
const root = resolve('../..');
const sb = '/private/tmp/hermes-approvals-20261012-sandbox';
const base = 'http://127.0.0.1:4198';
const engine = 'http://127.0.0.1:4197';
type Card = { id: string; revision: string; cardHash: string };

describe.skipIf(!live)('Hermes repair — isolated real SDK expiry and mixed desktop race', () => {
  let db: Database.Database;
  let client: any;
  let launched = false;
  const token = randomBytes(32).toString('hex');
  const capability = randomBytes(32).toString('base64url');
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = keys.publicKey.export({ format: 'jwk' });
  const rawPublic = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64');
  const sessionIds: string[] = [];
  const cardIds: string[] = [];
  const launcherEnv = { ...process.env,
    RHYTHM_APPROVED_FIXTURE_ROOT: '/private/tmp/hermes-approvals-20261012-fixture',
    RHYTHM_LIVE_DB_PATH: '/private/tmp/hermes-approvals-20261012-fixture/rhythm.db',
    RHYTHM_SANDBOX_OPENCODE_CONFIG: '/private/tmp/hermes-approvals-20261012-fixture/opencode.json',
    RHYTHM_SANDBOX_DIR: sb, RHYTHM_SANDBOX_API_PORT: '4198', RHYTHM_SANDBOX_ENGINE_PORT: '4197', RHYTHM_SANDBOX_GATEWAY_PORT: '4199',
    DB_CLIENT: 'sqlite', RHYTHM_OPTIMIZER_MODE: 'shadow', RHYTHM_SANDBOX_SKIP_ENGINE_BUILD: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_PURE: '1', RHYTHM_NUMBAT_MONITORING_DISABLED: '1',
    HERMES_TEST_CAPABILITY_SHA256: createHash('sha256').update(capability).digest('hex'), HERMES_TEST_PUBLIC_KEY: rawPublic };
  function launcher(action: 'up' | 'status' | 'down') {
    // Source the canonical launcher's documented harness seam. Only generated
    // verification inputs are added; capability/signature middleware is real.
    const result = spawnSync('/bin/bash', ['-c', `source tools/dev/sandbox.sh; runtime_env+=("HUMAN_APPROVAL_CAPABILITY_SHA256=$HERMES_TEST_CAPABILITY_SHA256" "HUMAN_APPROVAL_PUBLIC_KEY=$HERMES_TEST_PUBLIC_KEY"); ${action}`],
      { cwd: root, env: launcherEnv, encoding: 'utf8', timeout: 180_000 });
    console.log(result.stdout, result.stderr);
    expect(result.status, `owned sandbox ${action} must succeed`).toBe(0);
  }
  async function call(name: string, args: Record<string, unknown> = {}) { return client.callTool({ name, arguments: args }); }
  function data(result: any): any {
    expect(Boolean(result.isError), 'synthetic SDK call must succeed').toBe(false);
    return JSON.parse(result.content[0].text);
  }
  const get = async (id: string): Promise<Card> => data(await call('rhythm_get_pending_approval', { approvalId: id }));
  const decision = (card: Card, status = 'approved') => ({ approvalId: card.id, revision: card.revision, cardHash: card.cardHash,
    decision: status, attestation: 'owner_chose_in_chat' });
  function seed(expiry: string | null = new Date(Date.now() + 600_000).toISOString(), old = false) {
    const sessionId = randomUUID(); const id = randomUUID();
    sessionIds.push(sessionId); cardIds.push(id);
    db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,owner_user_id,cwd)
      VALUES (?,'Hermes synthetic repair','manager','completed',1,?)`).run(sessionId, sb);
    db.prepare(`INSERT INTO agent_approvals(id,session_id,agent_config_id,action,preview,consequence,status,expires_at,decision_nonce,created_at)
      VALUES (?,?,'manager','Synthetic generic approval','No external action','Sandbox only','pending',?,?,?)`)
      .run(id, sessionId, expiry, randomBytes(32).toString('base64url'), new Date(Date.now() - (old ? 660_000 : 0)).toISOString());
    return { id, sessionId };
  }
  function row(id: string) { return db.prepare('SELECT * FROM agent_approvals WHERE id = ?').get(id) as Record<string, any>; }
  function exactCard(id: string, revision: string): Card {
    const r = row(id);
    // Independent wire hash, including malformed explicit expiry: rejection
    // must be freshness, not a stale hash accidentally hiding this defect.
    const tuple = ['rhythm-relay-card-v1', revision, 1, r.id, r.session_id, r.agent_config_id, r.action, r.preview,
      r.consequence, r.security_action, r.payload_digest, r.taint_id, r.tainted_turn_id, r.bound_agent, r.expires_at, r.created_at];
    return { id, revision, cardHash: createHash('sha256').update(JSON.stringify(tuple)).digest('hex') };
  }
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const requireMcp = createRequire(resolve('../mcp_server/package.json'));
    const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
    expect(process.env.RHYTHM_SANDBOX_DIR).toBe(sb);
    expect(process.env.DB_PATH).toBe(`${sb}/rhythm.db`);
    expect(process.env.RHYTHM_LIVE_URL).toBe(base);
    expect(existsSync(sb), 'refuse to reuse or stop someone else\'s sandbox').toBe(false);
    launcher('up'); launched = true; launcher('status');
    expect(realpathSync(process.env.DB_PATH!)).toBe(`${realpathSync(sb)}/rhythm.db`);
    db = new Database(process.env.DB_PATH!);
    db.prepare('INSERT INTO sessions(token,user_id) VALUES (?,1)').run(token);
    client = new Client({ name: 'hermes-repair-regression', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('../mcp_server/dist/index.js')], stderr: 'pipe',
      env: { PATH: process.env.PATH!, HOME: `${sb}/home`, RHYTHM_API_URL: base, RHYTHM_AGENT_URL: base, RHYTHM_API_TOKEN: token } }));
  }, 180_000);
  afterAll(async () => {
    await client?.close();
    if (db) {
      for (const id of cardIds) db.prepare('DELETE FROM agent_approvals WHERE id = ?').run(id);
      for (const id of sessionIds) db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token); db.close();
    }
    if (launched) launcher('down');
  }, 30_000);

  it.each([['empty', ''], ['malformed', 'not-a-date'], ['whitespace', ' '], ['expired', new Date(0).toISOString()]])(
    'R1 %s explicit expiry refuses read/list/exact-hash decision and preserves pending nonce', async (_label, expiry) => {
      const f = seed(); const card = await get(f.id);
      db.prepare('UPDATE agent_approvals SET expires_at = ? WHERE id = ?').run(expiry, f.id);
      const before = row(f.id);
      const read = await call('rhythm_get_pending_approval', { approvalId: f.id });
      const listed = data(await call('rhythm_list_pending_approvals')) as Card[];
      const decided = await call('rhythm_decide_approval', decision(exactCard(f.id, card.revision)));
      const after = row(f.id);
      expect({ readRefused: Boolean(read.isError), listOmitted: !listed.some(c => c.id === f.id), decisionRefused: Boolean(decided.isError),
        status: after.status, actor: after.actor, noncePreserved: after.decision_nonce === before.decision_nonce,
        continuation: after.continuation_state }).toEqual({ readRefused: true, listOmitted: true, decisionRefused: true,
        status: 'pending', actor: null, noncePreserved: true, continuation: null });
    });
  it.each([['missing generic', null], ['valid explicit', new Date(Date.now() + 600_000).toISOString()]])(
    'R1 %s expiry permits read/list/decision', async (_label, expiry) => {
      const f = seed(expiry); const card = await get(f.id);
      expect((data(await call('rhythm_list_pending_approvals')) as Card[]).some(c => c.id === f.id)).toBe(true);
      expect(data(await call('rhythm_decide_approval', decision(card))).status).toBe('approved');
      expect(row(f.id).decision_nonce).toBeNull();
    });
  it('R1 missing generic expiry still expires after ten minutes', async () => {
    const f = seed(null, true);
    expect((await call('rhythm_get_pending_approval', { approvalId: f.id })).isError).toBe(true);
    expect((data(await call('rhythm_list_pending_approvals')) as Card[]).some(c => c.id === f.id)).toBe(false);
    const r = row(f.id);
    const revision = createHash('sha256').update(JSON.stringify(['rhythm-relay-revision-v1', f.id, r.decision_nonce])).digest('hex');
    expect((await call('rhythm_decide_approval', decision(exactCard(f.id, revision)))).isError).toBe(true);
    expect(row(f.id).status).toBe('pending');
  });

  it.each(['approved', 'rejected'] as const)('R1 simultaneous signed desktop %s vs opposite SDK relay has one immutable winner and one real continuation', async desktopStatus => {
    const relayStatus = desktopStatus === 'approved' ? 'rejected' : 'approved';
    const profile = `hermes-race-${randomUUID()}`;
    const model = 'hermes-safe-race';
    const original = JSON.parse(readFileSync(`${sb}/home/.config/opencode/opencode.json`, 'utf8'));
    let sdkId: string | undefined;
    let f: { id: string; sessionId: string } | undefined;
    let requests = 0;
    // Synthetic upstream INPUT only: actual engine/API/MCP/continuation are
    // untouched. Text-only output cannot perform any provider/external action.
    const provider = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        requests++;
        const events = [
          { type: 'message_start', message: { id: randomUUID(), type: 'message', role: 'assistant', model,
            content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Synthetic continuation observed. No action taken.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 5, output_tokens: 5 } },
          { type: 'message_stop' },
        ];
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
      });
    });
    async function config(value: unknown) {
      expect((await fetch(`${engine}/global/config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })).status).toBe(200);
      expect((await fetch(`${base}/system/refresh`, { method: 'POST' })).status).toBe(200);
    }
    try {
      await new Promise<void>((done, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', done); });
      const port = (provider.address() as { port: number }).port;
      await config({ ...original, provider: { ...original.provider, [profile]: { npm: '@ai-sdk/anthropic', name: 'Hermes synthetic race',
        options: { apiKey: randomBytes(32).toString('hex'), baseURL: `http://127.0.0.1:${port}/v1` },
        models: { [model]: { name: model, limit: { context: 200000, output: 4096 } } } } } });
      db.prepare(`INSERT INTO agent_configs(id,label,icon,command,model_provider,model_id,oc_agent,allowed_mcps_json,allowed_skills_json)
        VALUES (?,'Synthetic race profile','test','opencode',?,?,'build','[]','[]')`).run(profile, profile, model);
      const created = await fetch(`${engine}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OpenCode-Directory': sb },
        body: JSON.stringify({ title: 'Hermes synthetic mixed approval race' }) });
      expect(created.status).toBe(200); sdkId = (await created.json() as { id: string }).id;
      f = seed();
      db.prepare("UPDATE agent_sessions SET status='idle',sdk_session_id=?,agent_kind=?,mcp_role=? WHERE id=?").run(sdkId, profile, profile, f.sessionId);
      const card = await get(f.id); const before = row(f.id);
      const signature = sign('sha256', Buffer.from(canonicalHumanApprovalDecision({ approvalId: f.id, status: desktopStatus,
        decisionNonce: before.decision_nonce, payloadDigest: before.payload_digest })), keys.privateKey).toString('base64');
      const patch = () => fetch(`${base}/agent-approvals/${f!.id}`, { method: 'PATCH', headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Rhythm-Human-Approval': capability },
        body: JSON.stringify({ status: desktopStatus, signature }) });
      // Prove both real desktop guards still apply before racing valid inputs.
      expect((await fetch(`${base}/agent-approvals/${f.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: desktopStatus, signature }) })).status).toBe(403);
      expect((await fetch(`${base}/agent-approvals/${f.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'X-Rhythm-Human-Approval': capability }, body: JSON.stringify({ status: desktopStatus, signature: 'forged' }) })).status).toBe(403);
      const [desktop, relay] = await Promise.all([patch(), call('rhythm_decide_approval', decision(card, relayStatus))]);
      expect(Number(desktop.ok) + Number(!relay.isError), 'exactly one transport wins').toBe(1);
      if (!desktop.ok) expect([404, 409]).toContain(desktop.status);
      const winner = row(f.id);
      expect(winner.status).toBe(desktop.ok ? desktopStatus : relayStatus);
      expect(winner.decision_nonce).toBeNull();
      if (desktop.ok) {
        expect(winner.actor).toBe('user:1');
        expect((await desktop.json() as { status: string }).status).toBe(winner.status);
      } else {
        expect(JSON.parse(winner.actor)).toEqual(data(relay).audit);
        expect(JSON.parse(winner.actor)).toMatchObject({ ownerUserId: 1, decision: relayStatus, source: 'hermes', assurance: 'relay-attested' });
      }
      const marker = `<!-- rhythm-approval-continuation:${f.id} -->`;
      async function messages(): Promise<any[]> {
        const response = await fetch(`${engine}/session/${sdkId}/message`, { headers: { 'X-OpenCode-Directory': sb } });
        expect(response.ok).toBe(true); return response.json() as Promise<any[]>;
      }
      const deadline = Date.now() + 20_000;
      while ((requests < 1 || row(f.id).continuation_state !== 'delivered') && Date.now() < deadline) await new Promise(done => setTimeout(done, 100));
      expect(row(f.id).continuation_state, 'actual engine accepts durable continuation').toBe('delivered');
      let transcript = await messages();
      expect(transcript.filter(m => m.info?.role === 'user' && JSON.stringify(m.parts).includes(marker))).toHaveLength(1);
      expect(requests).toBe(1);
      const [desktopReplay, relayReplay] = await Promise.all([patch(), call('rhythm_decide_approval', decision(card, relayStatus))]);
      expect(desktopReplay.ok).toBe(false); expect(relayReplay.isError).toBe(true);
      await new Promise(done => setTimeout(done, 500));
      const final = row(f.id);
      expect({ status: final.status, actor: final.actor, decidedAt: final.decided_at, nonce: final.decision_nonce })
        .toEqual({ status: winner.status, actor: winner.actor, decidedAt: winner.decided_at, nonce: null });
      transcript = await messages();
      expect(transcript.filter(m => m.info?.role === 'user' && JSON.stringify(m.parts).includes(marker))).toHaveLength(1);
      expect(requests).toBe(1); expect(final.continuation_state).toBe('delivered');
      console.log(`MIXED RACE desktop=${desktopStatus} relay=${relayStatus}: one durable ${desktop.ok ? 'desktop' : 'Hermes'} winner; immutable audit; one engine continuation; replay refused`);
    } finally {
      if (f) db.prepare("UPDATE agent_sessions SET status='completed' WHERE id=?").run(f.sessionId);
      if (sdkId) await fetch(`${engine}/session/${sdkId}`, { method: 'DELETE', headers: { 'X-OpenCode-Directory': sb } });
      db.prepare('DELETE FROM agent_configs WHERE id=?').run(profile);
      await config(original);
      await new Promise<void>(done => provider.close(() => done()));
    }
  }, 60_000);
});
