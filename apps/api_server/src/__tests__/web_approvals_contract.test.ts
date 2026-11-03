/**
 * Slice 2c acceptance contract: real HTTP + migrated disposable SQLite.
 * No engine is started. The separate web-host Playwright contract owns live
 * continuation proof; closed synthetic sessions keep these cards inert.
 * Only the host configuration is injected. Auth, routes, repositories, receipt
 * verification and continuation services are the production implementations.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const webConfigState = vi.hoisted(() => ({
  current: null as null | {
    hosts: string[]; origins: string[]; ownerUserId: number; distDir: string;
  },
}));
vi.mock('../config/web_host', () => ({
  get webHostConfig() { return webConfigState.current; },
}));

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentApprovalsRepository, type AgentApproval } from '../repositories/agent_approvals_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { clearTrustedMcpVerifier, pinTrustedMcpPublicKey } from '../security/trusted_mcp_call';
import { initializeWebHost } from '../services/web_host';
import { startTestServer, type TestServer } from './helpers/real_server';
import { createTrustedMcpTestSigner } from './helpers/trusted_mcp_test_proof';
import { installHumanApprovalTestCredentials, signHumanApprovalDecision } from './helpers/human_approval_test_credentials';

const origin = 'https://rhythm-web-approvals.example.ts.net';
const host = new URL(origin).host;
type WebCard = {
  id: string; sessionId: string; action: string; preview: string | null;
  consequence: string | null; status: 'pending'; createdAt: string;
  revision: string; cardHash: string; decisionMode: 'trusted-tailnet-web'; decisionNonce?: string | null;
};
type HttpResult = { status: number; body: any; text: string };

describe('web-approvals-2c: owner-bound exact-card browser decisions', () => {
  let db: Database.Database;
  let root: string;
  let server: TestServer;
  let owner: ReturnType<UsersRepository['create']>;
  let other: ReturnType<UsersRepository['create']>;
  let bearer: string;
  let ownerSession: string;
  let human: ReturnType<typeof installHumanApprovalTestCredentials>;
  let trusted: ReturnType<typeof createTrustedMcpTestSigner>;
  const approvals = new AgentApprovalsRepository();
  const sessions = new AgentSessionsRepository();
  const originalEnv = {
    agentLocal: env.agentLocal,
    agentExecutionEnabled: env.agentExecutionEnabled,
    agentOriginGuardEnabled: env.agentOriginGuardEnabled,
    localRendererOrigins: env.localRendererOrigins,
    humanApprovalCapabilitySha256: env.humanApprovalCapabilitySha256,
    humanApprovalPublicKey: env.humanApprovalPublicKey,
  };

  function inertSession(ownerUserId: number | null): string {
    const session = sessions.insert({
      agentKind: 'claude-code', taskId: null, cwd: root,
      name: `[smoke] web-approvals ${randomUUID()}`,
      mcpRole: 'email-assistant',
      ...(ownerUserId === null ? {} : { ownerUserId }),
    });
    sessions.updateStatus(session.id, 'closed');
    return session.id;
  }

  beforeEach(async () => {
    env.agentLocal = true;
    env.agentExecutionEnabled = true;
    env.agentOriginGuardEnabled = true;
    env.localRendererOrigins = ['rhythm://app'];
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-web-approvals-contract-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Synthetic approvals</title>');
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    owner = new UsersRepository().create({ name: 'Synthetic Web Owner', email: 'web-owner@example.invalid', role: 'admin' });
    other = new UsersRepository().create({ name: 'Other Synthetic Owner', email: 'other-owner@example.invalid', role: 'admin' });
    bearer = (await new SessionsRepository().createAsync(owner.id)).token;
    ownerSession = inertSession(owner.id);
    human = installHumanApprovalTestCredentials();
    trusted = createTrustedMcpTestSigner();
    pinTrustedMcpPublicKey(trusted.publicDocument);
    webConfigState.current = { hosts: [host], origins: [origin], ownerUserId: owner.id, distDir: root };
    await initializeWebHost();
    server = await startTestServer(createApp());
  });

  afterEach(async () => {
    await server?.close();
    clearTrustedMcpVerifier();
    webConfigState.current = null;
    Object.assign(env, originalEnv);
    db?.close();
    if (root) fs.rmSync(root, { recursive: true });
  });

  async function call(route: string, options: {
    method?: string; body?: unknown; headers?: Record<string, string | undefined>; baseUrl?: string;
  } = {}): Promise<HttpResult> {
    const headers: Record<string, string> = { host, origin, 'content-type': 'application/json' };
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      if (value === undefined) delete headers[key.toLowerCase()];
      else headers[key.toLowerCase()] = value;
    }
    return new Promise((resolve, reject) => {
      const req = http.request(`${options.baseUrl ?? server.baseUrl}${route}`, {
        method: options.method ?? 'GET', headers,
      }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => {
          let body: unknown;
          try { body = JSON.parse(text); } catch { body = text; }
          resolve({ status: response.statusCode!, body, text });
        });
      });
      req.on('error', reject);
      req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
    });
  }

  function card(overrides: Partial<Parameters<AgentApprovalsRepository['create']>[0]> = {}): AgentApproval {
    return approvals.create({
      sessionId: ownerSession, agentConfigId: 'claude-code',
      action: `[smoke] exact web approval ${randomUUID()}`,
      preview: 'Original displayed preview', consequence: 'Synthetic only; no external action',
      ...overrides,
    });
  }

  function persisted(id: string): unknown {
    return db.prepare('SELECT * FROM agent_approvals WHERE id = ?').get(id);
  }

  async function visible(id: string): Promise<WebCard> {
    const response = await call('/web/approvals?status=pending');
    expect(response.status, response.text).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    const found = response.body.find((row: WebCard) => row.id === id);
    expect(found, 'normal HTTP read must supply the exact displayed card').toBeDefined();
    expect(found.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(found.cardHash).toMatch(/^[a-f0-9]{64}$/);
    return found;
  }

  function decision(row: WebCard, status: 'approved' | 'rejected' = 'approved') {
    return { status, revision: row.revision, cardHash: row.cardHash };
  }

  function decide(row: WebCard, status: 'approved' | 'rejected' = 'approved') {
    return call(`/web/approvals/${row.id}`, { method: 'PATCH', body: decision(row, status) });
  }

  it('web-approvals-2c-c01: tokenless web capability lists exact pending cards without signing material', async () => {
    const created = card();
    const bootstrap = await call('/web/bootstrap');
    expect(bootstrap.status, bootstrap.text).toBe(200);
    expect(bootstrap.body.capabilities.approvals).toBe(true);
    const row = await visible(created.id);
    expect(row).toMatchObject({ id: created.id, sessionId: ownerSession, action: created.action,
      preview: created.preview, consequence: created.consequence, status: 'pending', createdAt: created.createdAt,
      decisionMode: 'trusted-tailnet-web' });
    expect(row.decisionNonce ?? null).toBeNull();
    expect(JSON.stringify(row)).not.toContain(created.decisionNonce!);
    for (const secret of [bearer, human.capability, human.publicKey]) expect(JSON.stringify([row, bootstrap.body])).not.toContain(secret);
  });

  it('web-approvals-2c-c02: foreign, ownerless and sessionless cards are neither listed nor decidable', async () => {
    const owned = card();
    const hidden = [card({ action: 'foreign', sessionId: inertSession(other.id) }),
      card({ action: 'ownerless', sessionId: inertSession(null) }), card({ action: 'sessionless', sessionId: null })];
    const response = await call('/web/approvals?status=pending');
    expect(response.status, response.text).toBe(200);
    expect(response.body.map((row: WebCard) => row.id)).toEqual([owned.id]);
    const ownerRows = db.prepare('SELECT id, owner_user_id FROM agent_sessions ORDER BY id').all();
    for (const row of hidden) {
      const before = persisted(row.id);
      const result = await call(`/web/approvals/${row.id}`, { method: 'PATCH', body: {
        status: 'approved', revision: 'a'.repeat(64), cardHash: 'b'.repeat(64),
      } });
      expect(result.status, result.text).toBe(404);
      expect(persisted(row.id)).toEqual(before);
    }
    expect(db.prepare('SELECT id, owner_user_id FROM agent_sessions ORDER BY id').all()).toEqual(ownerRows);
  });

  it('web-approvals-2c-c03: changed display, execution bindings and nonce refuse a stale card without mutation', async () => {
    const mutations: Array<[string, string]> = [
      ['action', 'Changed action'], ['preview', 'Changed preview'], ['consequence', 'Changed consequence'],
      ['agent_config_id', 'changed-profile'], ['session_id', inertSession(owner.id)],
      ['payload_digest', 'f'.repeat(64)], ['security_action', 'task.create'], ['taint_id', 'changed-taint'], ['tainted_turn_id', 'changed-turn'],
      ['bound_agent', 'changed-agent'], ['expires_at', new Date(Date.now() + 120_000).toISOString()],
      ['created_at', new Date(Date.now() - 2_000).toISOString()], ['decision_nonce', randomUUID()],
    ];
    for (const [column, value] of mutations) {
      const created = card();
      const shown = await visible(created.id);
      db.prepare(`UPDATE agent_approvals SET ${column} = ? WHERE id = ?`).run(value, created.id);
      const before = persisted(created.id);
      const result = await decide(shown);
      expect(result.status, `${column}: ${result.text}`).toBe(409);
      expect(persisted(created.id)).toEqual(before);
    }
  });

  it('web-approvals-2c-c04: expired and malformed cards refuse Approve with 403 and retain their nonce unconsumed', async () => {
    for (const mode of ['explicit', 'fallback', 'malformed'] as const) {
      const created = card();
      const shown = await visible(created.id);
      if (mode === 'fallback') db.prepare("UPDATE agent_approvals SET created_at = datetime('now', '-11 minutes') WHERE id = ?").run(created.id);
      else db.prepare('UPDATE agent_approvals SET expires_at = ? WHERE id = ?')
        .run(mode === 'explicit' ? new Date(Date.now() - 2_000).toISOString() : 'not-a-date', created.id);
      const before = persisted(created.id);
      const result = await decide(shown);
      expect(result.status, `${mode}: ${result.text}`).toBe(403);
      expect(result.body.error.message).toMatch(/expired/i);
      expect(persisted(created.id)).toEqual(before);
      expect(approvals.getById(created.id)).toMatchObject({ status: 'pending', decisionNonce: created.decisionNonce, consumedAt: null });
      const pending = await call('/web/approvals?status=pending');
      expect(pending.status, pending.text).toBe(200);
      expect(pending.body.some((row: WebCard) => row.id === created.id)).toBe(false);
    }
  });

  it('web-approvals-2c-c05: concurrent decisions persist one result and replay or opposite decisions cannot consume twice', async () => {
    const created = card();
    const shown = await visible(created.id);
    const results = await Promise.all([decide(shown), decide(shown)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(approvals.getById(created.id)).toMatchObject({ status: 'approved', decisionNonce: null, consumedAt: null });
    const durable = persisted(created.id);
    for (const status of ['approved', 'rejected'] as const) {
      const replay = await decide(shown, status);
      expect(replay.status, replay.text).toBe(409);
      expect(persisted(created.id)).toEqual(durable);
    }
  });

  it('web-approvals-2c-c06: exact body keys and server-authored trusted-tailnet-web receipt prevent provenance spoofing', async () => {
    const created = card();
    const shown = await visible(created.id);
    const before = persisted(created.id);
    for (const extra of [{ ownerUserId: other.id }, { source: 'hermes' }, { assurance: 'crypto-human' },
      { signature: 'forged' }, { attestation: 'owner_chose_in_chat' }, { approvalIds: [created.id] }]) {
      const result = await call(`/web/approvals/${created.id}`, { method: 'PATCH', body: { ...decision(shown), ...extra } });
      expect(result.status, result.text).toBe(400);
      expect(persisted(created.id)).toEqual(before);
    }
    const result = await decide(shown, 'rejected');
    expect(result.status, result.text).toBe(200);
    expect(result.body).toMatchObject({ id: created.id, status: 'rejected', audit: {
      kind: 'trusted-tailnet-web-decision-v1', source: 'trusted-tailnet-web', assurance: 'trusted-tailnet',
      ownerUserId: owner.id, ownerName: owner.name, displayIdentity: `${owner.name} via browser`,
      attestation: 'owner_chose_in_browser', decision: 'rejected', revision: shown.revision, cardHash: shown.cardHash,
    } });
    expect(Number.isFinite(Date.parse(result.body.decidedAt))).toBe(true);
    expect(JSON.parse(approvals.getById(created.id)!.actor!)).toEqual(result.body.audit);
    expect(approvals.getById(created.id)).toMatchObject({ status: 'rejected', decisionNonce: null, consumedAt: null });
  });

  it('web-approvals-2c-c07: downstream signed consumption accepts an unchanged web receipt once and rejects changed cards or receipts', async () => {
    // Internal service ingress retains its normal synthetic bearer authority.
    // visible()/decide() still send no browser bearer or signing capability.
    const internalHeaders = { authorization: `Bearer ${bearer}` };
    const context = { sdkSessionId: 'web-approval-contract-sdk', turnId: 'web-contract-read',
      agentName: 'email-assistant', toolCallId: 'web-contract-read-call' };
    sessions.setSdkSessionId(ownerSession, context.sdkSessionId);
    const taint = await call('/agent-approvals/external-content/taint', { method: 'POST', headers: internalHeaders, body: {
      trustedCall: trusted.signCall(context, 'rhythm_read_email', { source: 'gmail.message' }),
      context, source: 'gmail.message', contentDigest: 'a'.repeat(64), blocked: false, diagnostics: [],
    } });
    expect(taint.status, taint.text).toBe(201);
    const actionContext = { ...context, turnId: 'web-contract-action', toolCallId: 'web-contract-action-call' };
    const payload = { to: 'synthetic@example.invalid', subject: 'Inert contract', body: 'No email is actually sent.' };
    async function boundCard() {
      const response = await call('/agent-approvals', { method: 'POST', headers: internalHeaders, body: {
        action: 'Authorize inert synthetic email', security: { context: actionContext, action: 'email.send', payload },
      } });
      expect(response.status, response.text).toBe(201);
      const row = await visible(response.body.id);
      const accepted = await decide(row);
      expect(accepted.status, accepted.text).toBe(200);
      return row;
    }
    function consume(id: string) {
      return call('/agent-approvals/consume', { method: 'POST', headers: internalHeaders, body: {
        trustedCall: trusted.signCall(actionContext, 'rhythm_send_email', payload),
        context: actionContext, approvalId: id, action: 'email.send', payload,
      } });
    }
    const good = await boundCard();
    const used = await consume(good.id);
    expect(used.status, used.text).toBe(200);
    expect(used.body).toMatchObject({ allowed: true, consumed: true });
    expect(approvals.getById(good.id)?.consumedAt).toEqual(expect.any(String));
    expect((await consume(good.id)).status).toBe(409);

    for (const mutation of ['display', 'receipt-source', 'receipt-owner', 'receipt-hash'] as const) {
      const changed = await boundCard();
      if (mutation === 'display') db.prepare('UPDATE agent_approvals SET preview = ? WHERE id = ?').run('changed after approval', changed.id);
      else {
        const audit = JSON.parse(approvals.getById(changed.id)!.actor!);
        if (mutation === 'receipt-source') audit.source = 'hermes';
        if (mutation === 'receipt-owner') audit.ownerUserId = other.id;
        if (mutation === 'receipt-hash') audit.cardHash = 'f'.repeat(64);
        db.prepare('UPDATE agent_approvals SET actor = ? WHERE id = ?').run(JSON.stringify(audit), changed.id);
      }
      const before = persisted(changed.id);
      const denied = await consume(changed.id);
      expect(denied.status, `${mutation}: ${denied.text}`).toBe(403);
      expect(persisted(changed.id)).toEqual(before);
      expect(approvals.getById(changed.id)?.consumedAt).toBeNull();
    }
  });

  it('web-approvals-2c-c08: Host/Origin guards, web-off absence and existing native/Hermes authority remain intact', async () => {
    const created = card();
    for (const headers of [{ origin: 'https://foreign.example.invalid' }, { host: 'foreign.example.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
      const blocked = await call(`/web/approvals/${created.id}`, { method: 'PATCH', headers,
        body: { status: 'approved', revision: 'a'.repeat(64), cardHash: 'b'.repeat(64) } });
      expect(blocked.status, blocked.text).toBe(403);
      expect(approvals.getById(created.id)?.status).toBe('pending');
    }
    expect((await call('/agent-approvals?status=pending')).status).toBe(401);
    expect((await call('/agent-approvals?status=pending', { headers: { authorization: `Bearer ${bearer}` } })).status).toBe(403);
    expect((await call('/agent-approvals/relay/pending')).status).toBe(401);
    const native = await call(`/agent-approvals/${created.id}`, { method: 'PATCH',
      headers: { authorization: `Bearer ${bearer}`, ...human.capabilityHeader },
      body: { status: 'rejected', signature: signHumanApprovalDecision(human, { ...created, decisionNonce: created.decisionNonce! }, 'rejected') },
    });
    expect(native.status, native.text).toBe(200);
    expect(native.body.actor).toBe(`user:${owner.id}`);
    const relay = card();
    const relayRead = await call(`/agent-approvals/relay/pending/${relay.id}`, { headers: { authorization: `Bearer ${bearer}` } });
    expect(relayRead.status, relayRead.text).toBe(200);
    const relayDecision = await call(`/agent-approvals/relay/${relay.id}/decision`, { method: 'POST',
      headers: { authorization: `Bearer ${bearer}` }, body: { revision: relayRead.body.revision,
        cardHash: relayRead.body.cardHash, decision: 'rejected', attestation: 'owner_chose_in_chat' },
    });
    expect(relayDecision.status, relayDecision.text).toBe(200);
    expect(relayDecision.body.audit).toMatchObject({ kind: 'hermes-chat-decision-v1', source: 'hermes',
      assurance: 'relay-attested', displayIdentity: `${owner.name} via Hermes`, attestation: 'owner_chose_in_chat' });
    webConfigState.current = null;
    const offServer = await startTestServer(createApp());
    try {
      for (const method of ['GET', 'PATCH']) {
        const result = await call(method === 'GET' ? '/web/approvals' : `/web/approvals/${relay.id}`, {
          method, baseUrl: offServer.baseUrl, headers: { host: new URL(offServer.baseUrl).host, origin: undefined },
          ...(method === 'PATCH' ? { body: { status: 'approved', revision: 'a'.repeat(64), cardHash: 'b'.repeat(64) } } : {}),
        });
        expect(result.status, result.text).toBe(404);
      }
    } finally { await offServer.close(); }
  });
});
