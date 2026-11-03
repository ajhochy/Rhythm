import Database from 'better-sqlite3';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { SQLITE_ORG_EVALUATION_SCHEMA } from '../../database/org_evaluation_schema';
import { OrgEvaluationRepository } from '../../repositories/org_evaluation_repository';
import { OrgEvaluationProviderRelay } from '../org_evaluation_provider_relay';

const handles: Database.Database[] = [];
afterEach(() => { for (const db of handles.splice(0)) db.close(); });
const responseEvent = (text = 'OK') => new globalThis.Response(`data: ${JSON.stringify({
  type: 'response.completed', response: { status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
  },
})}\n\n`, { headers: { 'content-type': 'text/event-stream' } });

async function setup(dedicatedListener = false, reply: () => globalThis.Response = () => responseEvent()) {
  const db = new Database(':memory:'); handles.push(db); db.exec(SQLITE_ORG_EVALUATION_SCHEMA);
  const repository = new OrgEvaluationRepository(db);
  await repository.createJobAsync({ id: 'root', sourceAuditRunId: null, ownerUserId: 8,
    maxTokens: 20000, validationReserveTokens: 3000, originalHash: 'original',
    targetRef: 'org-review-cycle:owned', targetRevision: '1', inputJson: '{}' });
  let contacts = 0;
  let forwarded: Record<string, unknown> | null = null;
  const relay = new OrgEvaluationProviderRelay({ repository,
    baseURL: `http://127.0.0.1:${dedicatedListener ? 0 : 4001}/agent-org-proposals/evaluations/provider`,
    dedicatedListener,
    resolveUpstream: async () => ({ url: 'https://example.invalid/v1/responses',
      headers: { authorization: 'Bearer trusted-test-secret' }, protocol: 'openai-responses-v1',
      supportsMaxOutputTokens: true, noHiddenContext: true }),
    fetchImpl: async (_url, init) => { contacts++; forwarded = JSON.parse(String(init?.body)); return reply(); },
  });
  return { repository, relay, db, contacts: () => contacts, forwarded: () => forwarded };
}

async function invoke(relay: OrgEvaluationProviderRelay, leaseId: string, token: string,
  body: Record<string, unknown>, remoteAddress = '127.0.0.1', path = `/evaluations/provider/${leaseId}/v1/responses`) {
  const request = { params: { leaseId }, headers: { authorization: `Bearer ${token}` },
    socket: { remoteAddress }, body, path } as unknown as Request;
  const captured = { status: 200, contentType: '', body: '' };
  const response = {
    status(code: number) { captured.status = code; return this; },
    type(type: string) { captured.contentType = type; return this; },
    send(value: string) { captured.body = value; return this; },
  } as unknown as ExpressResponse;
  await relay.handle(request, response, ((error?: unknown) => { if (error) throw error; }) as NextFunction);
  return captured;
}

describe('ephemeral evaluation provider relay', () => {
  it('accepts only an owned loopback lease and charges its bound job and stage', async () => {
    const { relay, repository, db, contacts, forwarded } = await setup();
    const lease = await relay.createLease({ jobId: 'root', stage: 'generator', model: 'gpt-6-luna' });
    expect(lease.baseURL).toContain(`/provider/${lease.leaseId}/v1`);
    const reply = await invoke(relay, lease.leaseId, lease.token,
      { model: 'gpt-6-luna', input: 'one owned prompt', max_output_tokens: 100 });
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('response.completed');
    expect(contacts()).toBe(1);
    expect(forwarded()).toMatchObject({ model: 'gpt-6-luna', max_output_tokens: 100, store: false });
    expect(await repository.getBudgetAsync('root')).toMatchObject({ settledTokens: 15 });
    expect(relay.finishLease(lease.leaseId)).toMatchObject({ totalTokens: 15, inputTokens: 12, outputTokens: 3 });
    expect(relay.finishLease(lease.leaseId)).toBeNull();
    expect(db.prepare('SELECT stage FROM org_evaluation_token_reservations').get()).toMatchObject({ stage: 'generator' });
  });

  it('rejects a wrong bearer, remote peer, model override, and revoked lease before provider contact', async () => {
    const { relay, contacts } = await setup();
    const lease = await relay.createLease({ jobId: 'root', stage: 'candidate-probe', model: 'gpt-6-luna' });
    const valid = { model: 'gpt-6-luna', input: 'owned prompt', max_output_tokens: 100 };
    await expect(invoke(relay, lease.leaseId, 'wrong', valid)).rejects.toThrow();
    await expect(invoke(relay, lease.leaseId, lease.token, valid, '192.0.2.1')).rejects.toThrow();
    await expect(invoke(relay, lease.leaseId, lease.token, { ...valid, model: 'other-model' })).rejects.toThrow();
    relay.revoke(lease.leaseId);
    await expect(invoke(relay, lease.leaseId, lease.token, valid)).rejects.toThrow();
    expect(contacts()).toBe(0);
  });

  it('uses single-call leases by default so a replay cannot issue twice', async () => {
    const { relay, contacts } = await setup();
    const lease = await relay.createLease({ jobId: 'root', stage: 'generator', model: 'gpt-6-luna' });
    const body = { model: 'gpt-6-luna', input: 'owned prompt', max_output_tokens: 100 };
    await invoke(relay, lease.leaseId, lease.token, body);
    await expect(invoke(relay, lease.leaseId, lease.token, body)).rejects.toThrow();
    expect(contacts()).toBe(1);
  });

  it('records only the exact bounded provider tool catalog for the owned lease', async () => {
    const { relay, forwarded } = await setup();
    const lease = await relay.createLease({ jobId: 'root', stage: 'candidate-probe', model: 'gpt-6-luna' });
    expect(relay.getObservedToolCatalog(lease.leaseId)).toBeNull();
    await invoke(relay, lease.leaseId, lease.token, { model: 'gpt-6-luna', input: 'Use local fixture',
      max_output_tokens: 100, tools: [{ type: 'function', name: 'read_fixture',
        parameters: { type: 'object', properties: {} } }] });
    const catalog = relay.getObservedToolCatalog(lease.leaseId);
    expect(catalog).toMatchObject([{ toolNames: ['read_fixture'] }]);
    expect(catalog?.[0].providerRequestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(forwarded()?.tools).toMatchObject([{ name: 'read_fixture' }]);
    expect(relay.finishLease(lease.leaseId)).toMatchObject({ totalTokens: 15 });
    expect(relay.getObservedToolCatalog(lease.leaseId)).toBeNull();
  });

  it('uses an isolated port exposing only the provider POST path', async () => {
    const { relay, contacts } = await setup(true);
    try {
      const lease = await relay.createLease({ jobId: 'root', stage: 'generator', model: 'gpt-6-luna' });
      const base = new URL(lease.baseURL);
      expect(base.port).not.toBe('4001');
      const origin = base.origin;
      for (const [method, path] of [['GET', '/agent-org-proposals/evaluations/root'],
        ['PATCH', '/agent-configs/owned'], ['GET', '/agent-org-proposals/evaluations/settings']] as const) {
        const response = await fetch(`${origin}${path}`, { method });
        expect(response.status).toBe(404);
      }
      const url = `${lease.baseURL}/responses`;
      const body = JSON.stringify({ model: 'gpt-6-luna', input: 'safe prompt', max_output_tokens: 16 });
      await expect(invoke(relay, lease.leaseId, lease.token, JSON.parse(body)))
        .rejects.toThrow(/private relay listener/);
      expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json',
        authorization: 'Bearer wrong' }, body })).status).toBe(401);
      const accepted = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json',
        authorization: `Bearer ${lease.token}` }, body });
      expect(accepted.status).toBe(200);
      expect(contacts()).toBe(1);
      expect(relay.finishLease(lease.leaseId)?.totalTokens).toBe(15);
    } finally { await relay.closeDedicatedListener(); }
  });

  // Live managed/routed arms failed only as "usage was unavailable or incomplete";
  // without the lease's own reason the next live run could not be diagnosed.
  describe('lease failure reason', () => {
    const body = { model: 'gpt-6-luna', input: 'owned prompt', max_output_tokens: 100 };

    it('names a lease that never reached the provider, including why requests were refused', async () => {
      const { relay } = await setup();
      const idle = await relay.createLease({ jobId: 'root', stage: 'candidate-probe', model: 'gpt-6-luna' });
      expect(relay.describeLeaseFailure(idle.leaseId)).toBe('no-provider-calls');
      const refused = await relay.createLease({ jobId: 'root', stage: 'candidate-probe', model: 'gpt-6-luna' });
      await expect(invoke(relay, refused.leaseId, refused.token, { ...body, model: 'other-model' })).rejects.toThrow();
      expect(relay.describeLeaseFailure(refused.leaseId))
        .toBe('no-provider-calls; rejected: Evaluation model differs from lease');
      expect(relay.finishLease(refused.leaseId)).toBeNull();
      expect(relay.describeLeaseFailure(refused.leaseId)).toBe('lease-missing');
    });

    it('reports the code-owned gate rejection that failed a later call', async () => {
      const { relay } = await setup();
      const lease = await relay.createLease({ jobId: 'root', stage: 'candidate-probe', model: 'gpt-6-luna', maxCalls: 2 });
      await invoke(relay, lease.leaseId, lease.token, body);
      expect(relay.describeLeaseFailure(lease.leaseId)).toBeNull();
      await expect(invoke(relay, lease.leaseId, lease.token, { ...body, input: 'second', metadata: { a: 1 } })).rejects.toThrow();
      expect(relay.describeLeaseFailure(lease.leaseId)).toBe('Unsupported hidden state or unbounded provider request field');
      expect(relay.finishLease(lease.leaseId)).toBeNull();
    });

    it('distinguishes an output-ceiling stop from an upstream HTTP failure', async () => {
      const incomplete = await setup(false, () => new globalThis.Response(`data: ${JSON.stringify({
        type: 'response.incomplete', response: { status: 'incomplete',
          usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } } })}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } }));
      const capped = await incomplete.relay.createLease({ jobId: 'root', stage: 'candidate-probe', model: 'gpt-6-luna' });
      await invoke(incomplete.relay, capped.leaseId, capped.token, body);
      expect(incomplete.relay.describeLeaseFailure(capped.leaseId)).toBe('output-ceiling');

      const upstream = await setup(false, () => new globalThis.Response('busy', { status: 529 }));
      const lease = await upstream.relay.createLease({ jobId: 'root', stage: 'candidate-probe', model: 'gpt-6-luna' });
      await expect(invoke(upstream.relay, lease.leaseId, lease.token, body)).rejects.toThrow();
      expect(upstream.relay.describeLeaseFailure(lease.leaseId)).toBe('Provider returned HTTP 529');
    });

    it('never echoes provider bytes from a malformed stream', async () => {
      const { relay } = await setup(false, () => new globalThis.Response('data: {"secret-provider-text\n\n',
        { headers: { 'content-type': 'text/event-stream' } }));
      const lease = await relay.createLease({ jobId: 'root', stage: 'candidate-probe', model: 'gpt-6-luna' });
      await expect(invoke(relay, lease.leaseId, lease.token, body)).rejects.toThrow();
      expect(relay.describeLeaseFailure(lease.leaseId)).toBe('malformed-provider-stream');
    });
  });

  it('runs diagnosis through the same budget gate and returns only terminal text', async () => {
    const { relay, repository } = await setup();
    const response = await relay.runBoundedText({ jobId: 'root', stage: 'generator',
      model: 'gpt-6-luna', prompt: 'Summarize the owned failure.', requestKey: 'diagnosis-1' });
    expect(response.text).toBe('OK');
    expect(response.usage.totalTokens).toBe(15);
    expect((await repository.getBudgetAsync('root')).settledTokens).toBe(15);
  });
});
