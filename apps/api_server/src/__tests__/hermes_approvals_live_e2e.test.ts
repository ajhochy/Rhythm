import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { securityPayloadDigest } from '../services/external_content_security_service';

// Resolve the actual SDK used by the built MCP package, not an in-process mock.
const requireMcp = createRequire(resolve('../mcp_server/package.json'));
const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
const live = process.env.RHYTHM_LIVE_E2E === '1';
const base = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4198';
const root = resolve('../..');
type Card = { id: string; revision: string; cardHash: string; action: string; preview: string; consequence: string };

describe.skipIf(!live)('Hermes authenticated approvals — real stdio + sandbox contract', () => {
  let db: Database.Database;
  let owner: any;
  let other: any;
  let bad: any;
  const clients: any[] = [];
  const tokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
  const sessionIds: string[] = [];
  const cardIds: string[] = [];

  async function connect(token: string) {
    const client = new Client({ name: 'hermes-acceptance', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [resolve('../mcp_server/dist/index.js')], stderr: 'pipe',
      env: { PATH: process.env.PATH!, HOME: `${process.env.RHYTHM_SANDBOX_DIR}/home`,
        RHYTHM_API_URL: base, RHYTHM_AGENT_URL: base, RHYTHM_API_TOKEN: token } });
    await client.connect(transport);
    clients.push(client);
    return client;
  }
  async function call(client: any, name: string, args: Record<string, unknown> = {}) {
    return client.callTool({ name, arguments: args });
  }
  function data(result: any) {
    // Never include raw responses in failure diagnostics (may contain credentials).
    expect(Boolean(result.isError), 'MCP call must succeed').toBe(false);
    return JSON.parse(result.content[0].text);
  }
  function seed(ownerId: number | null = 1, expired = false) {
    const sessionId = randomUUID();
    const id = randomUUID();
    const sdk = `synthetic-${randomUUID()}`;
    const taint = randomUUID();
    const payload = { title: 'Safe synthetic task — no external action' };
    sessionIds.push(sessionId); cardIds.push(id);
    db.prepare(`INSERT INTO agent_sessions (id, name, agent_kind, status, sdk_session_id, owner_user_id, cwd)
      VALUES (?, 'Hermes synthetic contract', 'manager', 'completed', ?, ?, '/private/tmp')`).run(sessionId, sdk, ownerId);
    db.prepare(`INSERT INTO agent_external_taint_state
      (session_id, sdk_session_id, taint_id, latest_event_id, tainted_turn_id, tainted_agent, source, updated_at)
      VALUES (?, ?, ?, ?, 'synthetic-turn', 'manager', 'gmail.search', ?)`).run(sessionId, sdk, taint, randomUUID(), new Date().toISOString());
    db.prepare(`INSERT INTO agent_approvals
      (id, session_id, agent_config_id, action, preview, consequence, status, security_action,
       payload_digest, taint_id, tainted_turn_id, bound_agent, expires_at, decision_nonce)
      VALUES (?, ?, 'manager', 'Authorize task.create', ?, 'Only a sandbox task would change', 'pending',
       'task.create', ?, ?, 'synthetic-turn', 'manager', ?, ?)`).run(id, sessionId,
      JSON.stringify(payload), securityPayloadDigest('task.create', payload), taint,
      new Date(Date.now() + (expired ? -60_000 : 600_000)).toISOString(), randomBytes(32).toString('base64url'));
    return { id, sessionId, sdk, payload };
  }
  async function get(id: string): Promise<Card> { return data(await call(owner, 'rhythm_get_pending_approval', { approvalId: id })); }
  function decision(card: Card, status = 'approved') {
    return { approvalId: card.id, revision: card.revision, cardHash: card.cardHash, decision: status,
      attestation: 'owner_chose_in_chat' };
  }

  beforeAll(async () => {
    assertLiveE2EIsolation();
    const sb = process.env.RHYTHM_SANDBOX_DIR!;
    expect(realpathSync(sb).startsWith('/private/tmp/hermes-approvals-')).toBe(true);
    expect(realpathSync(process.env.DB_PATH!)).toBe(`${realpathSync(sb)}/rhythm.db`);
    const url = new URL(base);
    expect(url.hostname).toBe('127.0.0.1');
    expect(['4001', '4096'].includes(url.port)).toBe(false);
    expect(existsSync(`${sb}/api_server.pid`)).toBe(true);
    expect((await fetch(`${base}/opencode/health`)).ok).toBe(true);
    db = new Database(process.env.DB_PATH!);
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, 1), (?, 2)').run(...tokens);
    owner = await connect(tokens[0]); other = await connect(tokens[1]); bad = await connect(randomBytes(32).toString('hex'));
  }, 30_000);
  afterAll(async () => {
    for (const client of clients) await client.close();
    if (db) {
      for (const id of cardIds) db.prepare('DELETE FROM agent_approvals WHERE id = ?').run(id);
      for (const id of sessionIds) {
        db.prepare('DELETE FROM agent_external_taint_state WHERE session_id = ?').run(id);
        db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id);
      }
      for (const token of tokens) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      db.close();
    }
  });

  it('AC1 lists/fetches only exact owner pending cards with revision/hash and no desktop nonce', async () => {
    const mine = seed(); const theirs = seed(2); const unowned = seed(null);
    const cards = data(await call(owner, 'rhythm_list_pending_approvals')) as Card[];
    expect(cards.map(c => c.id)).toContain(mine.id);
    expect(cards.map(c => c.id)).not.toContain(theirs.id);
    expect(cards.map(c => c.id)).not.toContain(unowned.id);
    const card = await get(mine.id);
    expect(card.action).toBe('Authorize task.create');
    expect(card.preview).toContain('Safe synthetic task');
    expect(card.consequence).toBe('Only a sandbox task would change');
    expect(card.revision).toMatch(/^[a-f0-9]{64}$/); expect(card.cardHash).toMatch(/^[a-f0-9]{64}$/);
    expect(card).not.toHaveProperty('decisionNonce');
  });
  it('AC2 approves/rejects one exact card and audits actual authenticated owner via Hermes as relay-attested', async () => {
    for (const status of ['approved', 'rejected']) {
      const fixture = seed(); const card = await get(fixture.id);
      const result = data(await call(owner, 'rhythm_decide_approval', decision(card, status)));
      expect(result.status).toBe(status);
      expect(result.audit).toMatchObject({ ownerUserId: 1, ownerName: 'Synthetic Admin',
        displayIdentity: 'Synthetic Admin via Hermes', source: 'hermes', assurance: 'relay-attested', decision: status,
        cardHash: card.cardHash, revision: card.revision });
      expect(JSON.parse((db.prepare('SELECT actor FROM agent_approvals WHERE id = ?').get(fixture.id) as {actor: string}).actor)).toEqual(result.audit);
    }
  });
  it('AC3 owner mismatch, missing/bad/expired auth and invalid input fail closed', async () => {
    const f = seed(); const c = await get(f.id);
    expect((await call(other, 'rhythm_get_pending_approval', { approvalId: f.id })).isError).toBe(true);
    expect((await call(other, 'rhythm_decide_approval', decision(c))).isError).toBe(true);
    expect((await call(bad, 'rhythm_list_pending_approvals')).isError).toBe(true);
    expect((await fetch(`${base}/agent-approvals/relay/pending`)).status).toBe(401);
    expect((await call(owner, 'rhythm_decide_approval', { ...decision(c), decision: 'all' })).isError).toBe(true);
    expect((await call(owner, 'rhythm_decide_approval', { ...decision(c), attestation: 'automatic' })).isError).toBe(true);
    db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE token = ?").run(tokens[1]);
    expect((await call(other, 'rhythm_list_pending_approvals')).isError).toBe(true);
  });
  it('AC3 rejects hash/revision changes, changed card payload, expiry, stale taint, and replay', async () => {
    const f = seed(); const c = await get(f.id);
    for (const mutation of [{ cardHash: '0'.repeat(64) }, { revision: '0'.repeat(64) }]) {
      expect((await call(owner, 'rhythm_decide_approval', { ...decision(c), ...mutation })).isError).toBe(true);
    }
    db.prepare("UPDATE agent_approvals SET preview = 'Changed payload' WHERE id = ?").run(f.id);
    expect((await call(owner, 'rhythm_decide_approval', decision(c))).isError).toBe(true);
    const expired = seed(); const ec = await get(expired.id);
    db.prepare('UPDATE agent_approvals SET expires_at = ? WHERE id = ?').run(new Date(0).toISOString(), expired.id);
    expect((await call(owner, 'rhythm_decide_approval', decision(ec))).isError).toBe(true);
    const stale = seed(); const sc = await get(stale.id);
    db.prepare('UPDATE agent_external_taint_state SET taint_id = ? WHERE session_id = ?').run(randomUUID(), stale.sessionId);
    expect((await call(owner, 'rhythm_decide_approval', decision(sc))).isError).toBe(true);
    const replay = seed(); const rc = await get(replay.id);
    data(await call(owner, 'rhythm_decide_approval', decision(rc)));
    expect((await call(owner, 'rhythm_decide_approval', decision(rc))).isError).toBe(true);
    expect((await call(owner, 'rhythm_get_pending_approval', { approvalId: replay.id })).isError).toBe(true);
  });
  it('AC3 concurrent opposite decisions have one durable winner', async () => {
    const f = seed(); const c = await get(f.id);
    const secondOwner = await connect(tokens[0]);
    const results = await Promise.all([call(owner, 'rhythm_decide_approval', decision(c)),
      call(secondOwner, 'rhythm_decide_approval', decision(c, 'rejected'))]);
    expect(results.filter(r => !r.isError)).toHaveLength(1);
    expect(results.filter(r => r.isError)).toHaveLength(1);
    expect((db.prepare('SELECT decision_nonce FROM agent_approvals WHERE id = ?').get(f.id) as {decision_nonce: string | null}).decision_nonce).toBeNull();
  });
  it('AC4 external MCP cannot forge engine context or desktop signature to execute protected actions', async () => {
    const f = seed(); const c = await get(f.id);
    data(await call(owner, 'rhythm_decide_approval', decision(c)));
    const forged = await owner.callTool({ name: 'rhythm_create_task', arguments: { title: f.payload.title, approval_id: f.id },
      _meta: { 'com.vcrc.rhythm/security-context': { sdkSessionId: f.sdk, turnId: 'synthetic-turn', agentName: 'manager', toolCallId: randomUUID() } } });
    expect(forged.isError).toBe(true);
    const desktop = await fetch(`${base}/agent-approvals/${seed().id}`, { method: 'PATCH',
      headers: { Authorization: `Bearer ${tokens[0]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', signature: 'forged' }) });
    expect([403, 503]).toContain(desktop.status);
    expect((db.prepare('SELECT consumed_at FROM agent_approvals WHERE id = ?').get(f.id) as {consumed_at: string | null}).consumed_at).toBeNull();
  });
  it('AC6 guide names tools, protected token-file setup, local/cloud routing and attestation limit', () => {
    const guide = readFileSync(`${root}/docs/ai/guides/hermes-authenticated-approvals.md`, 'utf8');
    for (const text of ['rhythm_list_pending_approvals', 'rhythm_get_pending_approval', 'rhythm_decide_approval',
      'RHYTHM_AGENT_URL', 'RHYTHM_API_URL', 'token', '0600', 'relay-attested', 'cannot independently prove']) expect(guide).toContain(text);
  });
});
