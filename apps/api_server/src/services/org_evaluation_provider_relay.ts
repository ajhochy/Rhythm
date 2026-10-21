import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import type { OrgEvaluationStage, OrgEvaluationTokenUsage } from '../models/org_evaluation';
import { OrgEvaluationRepository } from '../repositories/org_evaluation_repository';
import { OrgEvaluationProviderGate, type EvaluationUpstream } from './org_evaluation_provider_gate';
import type { ObservedDeferredCatalog } from './org_evaluation_scope_effects';
import { anthropicAccountsService } from './anthropic_accounts_service';
import { openaiAccountsService } from './openai_accounts_service';

export interface EvaluationProviderLease {
  leaseId: string;
  token: string;
  baseURL: string;
  jobId: string;
  stage: OrgEvaluationStage;
  model: string;
  expiresAt: string;
}

interface ActiveLease extends EvaluationProviderLease {
  calls: number;
  maxCalls: number;
  requestDigests: Set<string>;
  usages: OrgEvaluationTokenUsage[];
  failed: boolean;
  catalogs: Array<{ providerRequestHash: string; toolNames: string[]; deferredCatalog: ObservedDeferredCatalog | null }>;
}

const stages = new Set<OrgEvaluationStage>([
  'generator', 'original-probe', 'candidate-probe', 'composition', 'judge', 'final-validation', 'retry',
]);
const isLoopback = (address: string | undefined) => !!address && (
  address === '::1' || address === '127.0.0.1' || address.startsWith('127.') || address === '::ffff:127.0.0.1'
);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Only a public API key path is attested. Native Codex OAuth compatibility is unproven. */
export function resolvePublicOpenAIUpstream(model: string): Promise<EvaluationUpstream> {
  if (!/^[a-zA-Z0-9._/-]{1,100}$/.test(model)) throw new Error('Unsupported evaluation model');
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('No public OpenAI API key is available for bounded evaluation');
  return Promise.resolve({
    url: 'https://api.openai.com/v1/responses', headers: { authorization: `Bearer ${apiKey}` },
    protocol: 'openai-responses-v1', supportsMaxOutputTokens: true, noHiddenContext: true,
  });
}

/** Reads existing account access credentials without rotating or mutating OAuth state. */
export function resolveConfiguredEvaluationUpstream(model: string): Promise<EvaluationUpstream> {
  if (!/^[a-zA-Z0-9._/-]{1,100}$/.test(model)) throw new Error('Unsupported evaluation model');
  if (model.startsWith('claude-')) {
    const account = anthropicAccountsService.defaultAccount();
    if (!account || account.status !== 'ok' || account.expires <= Date.now() + 60_000)
      throw new Error('No current Anthropic OAuth account is available for bounded evaluation');
    return Promise.resolve({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { authorization: `Bearer ${account.access}`, 'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05,context-management-2025-06-27,advisor-tool-2026-03-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'x-app': 'cli', 'user-agent': 'claude-cli/2.1.296 (external, sdk-cli)' },
      protocol: 'anthropic-messages-v1', supportsMaxOutputTokens: true, noHiddenContext: true,
    });
  }
  // This exact model and endpoint accepted a 16-token ceiling with terminal
  // usage in the disposable capability probe; other OAuth models stay closed.
  const openai = openaiAccountsService.defaultAccount();
  if (model === 'gpt-6.1-sol' && openai?.status === 'ok' && openai.expires > Date.now() + 60_000) {
    return Promise.resolve({ url: 'https://chatgpt.com/backend-api/codex/responses',
      headers: { authorization: `Bearer ${openai.access}`,
        ...(openai.chatgptAccountId ? { 'ChatGPT-Account-Id': openai.chatgptAccountId } : {}) },
      protocol: 'codex-oauth-responses-v1', supportsMaxOutputTokens: true, noHiddenContext: true });
  }
  if (openai && !process.env.OPENAI_API_KEY) throw new Error('Codex OAuth output ceiling is not attested for this model');
  return resolvePublicOpenAIUpstream(model);
}

export class OrgEvaluationProviderRelay {
  private readonly leases = new Map<string, ActiveLease>();
  private readonly gate: OrgEvaluationProviderGate;
  private baseURL: string;
  private readonly repository: OrgEvaluationRepository;
  private readonly ready: Promise<void>;
  private dedicatedServer: Server | null = null;
  private dedicatedPort: number | null = null;

  constructor(deps: {
    repository: OrgEvaluationRepository;
    resolveUpstream: (model: string) => Promise<EvaluationUpstream>;
    baseURL: string;
    fetchImpl?: typeof fetch;
    dedicatedListener?: boolean;
  }) {
    const url = new URL(deps.baseURL);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash)
      throw new Error('Evaluation relay must use a fixed loopback URL');
    this.baseURL = deps.baseURL.replace(/\/$/, '');
    this.repository = deps.repository;
    this.gate = new OrgEvaluationProviderGate({
      repository: deps.repository, resolveUpstream: deps.resolveUpstream, fetchImpl: deps.fetchImpl,
    });
    this.ready = deps.dedicatedListener ? this.startDedicatedListener() : Promise.resolve();
  }

  private async startDedicatedListener(): Promise<void> {
    const app = express();
    app.use(express.json({ limit: '64kb' }));
    app.post('/agent-org-proposals/evaluations/provider/:leaseId/v1/responses',
      (req, res, next) => { void this.handle(req, res, next); });
    app.post('/agent-org-proposals/evaluations/provider/:leaseId/v1/messages',
      (req, res, next) => { void this.handle(req, res, next); });
    app.use((_req, res) => { res.sendStatus(404); });
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
      server.close();
      throw new Error('Evaluation relay failed to bind a private loopback port');
    }
    this.dedicatedServer = server;
    this.dedicatedPort = address.port;
    this.baseURL = `http://127.0.0.1:${address.port}/agent-org-proposals/evaluations/provider`;
    server.unref();
  }

  async closeDedicatedListener(): Promise<void> {
    await this.ready;
    if (!this.dedicatedServer) return;
    await new Promise<void>((resolve, reject) => this.dedicatedServer!.close((error) => error ? reject(error) : resolve()));
    this.dedicatedServer = null;
    this.dedicatedPort = null;
  }

  async createLease(input: { jobId: string; stage: OrgEvaluationStage; model: string; expiresMs?: number; maxCalls?: number }):
    Promise<EvaluationProviderLease> {
    await this.ready;
    const job = await this.repository.getJobAsync(input.jobId);
    if (!job || ['qualified', 'failed', 'inconclusive'].includes(job.status)) throw new Error('Evaluation job is not active');
    if (!stages.has(input.stage) || !/^[a-zA-Z0-9._/-]{1,100}$/.test(input.model))
      throw new Error('Invalid evaluation lease binding');
    const expiresMs = input.expiresMs ?? 5 * 60_000;
    const maxCalls = input.maxCalls ?? 1;
    if (!Number.isSafeInteger(expiresMs) || expiresMs < 1000 || expiresMs > 10 * 60_000
      || !Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 16)
      throw new Error('Invalid evaluation lease lifetime or call count');
    for (const [id, lease] of this.leases) if (Date.parse(lease.expiresAt) <= Date.now()) this.leases.delete(id);
    if (this.leases.size >= 128) throw new Error('Too many active evaluation leases');
    const leaseId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const lease: ActiveLease = {
      leaseId, token, baseURL: `${this.baseURL}/${leaseId}/v1`,
      jobId: input.jobId, stage: input.stage, model: input.model,
      expiresAt: new Date(Date.now() + expiresMs).toISOString(),
      calls: 0, maxCalls, requestDigests: new Set(), usages: [], failed: false, catalogs: [],
    };
    this.leases.set(leaseId, lease);
    const { calls: _calls, maxCalls: _maxCalls, requestDigests: _digests,
      usages: _usages, failed: _failed, catalogs: _catalogs, ...publicLease } = lease;
    return publicLease;
  }

  revoke(leaseId: string): void { this.leases.delete(leaseId); }

  /** Per-request tool names from the exact bounded provider body, never profile projection. */
  getObservedToolCatalog(leaseId: string): Array<{ providerRequestHash: string; toolNames: string[];
    deferredCatalog: ObservedDeferredCatalog | null }> | null {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.failed || lease.calls === 0 || lease.catalogs.length !== lease.calls) return null;
    return lease.catalogs.map((item) => ({ providerRequestHash: item.providerRequestHash,
      toolNames: [...item.toolNames], deferredCatalog: item.deferredCatalog }));
  }

  /** Aggregate only usage settled by this lease's actual provider calls. */
  finishLease(leaseId: string): OrgEvaluationTokenUsage | null {
    const lease = this.leases.get(leaseId);
    this.leases.delete(leaseId);
    if (!lease || lease.failed || lease.calls === 0 || lease.usages.length !== lease.calls) return null;
    const sum = (key: 'totalTokens' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'reasoningTokens') =>
      lease.usages.reduce((value, usage) => value + (usage[key] ?? 0), 0);
    return { totalTokens: sum('totalTokens'), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'),
      cacheReadTokens: sum('cacheReadTokens'), reasoningTokens: sum('reasoningTokens') };
  }

  async handle(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (this.dedicatedPort !== null && req.socket.localPort !== this.dedicatedPort)
        throw AppError.forbidden('Evaluation lease is restricted to its private relay listener');
      if (!isLoopback(req.socket.remoteAddress)) throw AppError.forbidden('Evaluation provider requires loopback peer');
      const lease = this.leases.get(String(req.params.leaseId));
      if (!lease || Date.parse(lease.expiresAt) <= Date.now()) throw AppError.unauthorized('Evaluation provider lease expired');
      const authorization = req.headers.authorization;
      const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7)
        : typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '';
      const actual = Buffer.from(supplied);
      const expected = Buffer.from(lease.token);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw AppError.unauthorized('Evaluation provider lease bearer invalid');
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
        throw AppError.badRequest('Evaluation provider requires JSON request');
      const body = req.body as Record<string, unknown>;
      if (body.model !== lease.model) throw AppError.forbidden('Evaluation model differs from lease');
      if (req.path.endsWith('/v1/messages') !== lease.model.startsWith('claude-'))
        throw AppError.forbidden('Evaluation provider protocol differs from lease');
      const requestDigest = digest(JSON.stringify(body));
      if (lease.calls >= lease.maxCalls || lease.requestDigests.has(requestDigest))
        throw AppError.conflict('Evaluation provider lease already used');
      lease.calls++;
      lease.requestDigests.add(requestDigest);
      let response;
      try {
        response = await this.gate.request({ jobId: lease.jobId, stage: lease.stage,
          requestKey: `${lease.leaseId}:${lease.calls}`, body });
        lease.usages.push(response.usage);
        lease.catalogs.push({ providerRequestHash: response.providerRequestHash, toolNames: response.toolNames,
          deferredCatalog: response.deferredCatalog });
        if (!response.complete) lease.failed = true;
      } catch (error) { lease.failed = true; throw error; }
      res.status(response.status).type(response.contentType).send(response.body);
    } catch (error) { next(error); }
  }

  async runBoundedText(input: {
    jobId: string; stage: OrgEvaluationStage; model: string; prompt: string; requestKey?: string;
  }): Promise<{ text: string; usage: OrgEvaluationTokenUsage }> {
    await this.ready;
    if (!stages.has(input.stage) || typeof input.prompt !== 'string' || !input.prompt.trim())
      throw new Error('Invalid bounded evaluation prompt');
    const rawModel = input.model.startsWith('anthropic/') ? input.model.slice('anthropic/'.length) : input.model;
    const anthropic = rawModel.startsWith('claude-');
    const response = await this.gate.request({
      jobId: input.jobId, stage: input.stage, requestKey: input.requestKey ?? randomUUID(),
      body: anthropic ? { model: rawModel, messages: [{ role: 'user', content: input.prompt }], max_tokens: 4096 }
        : { model: rawModel, input: input.prompt, max_output_tokens: 4096 },
    });
    if (!response.complete) throw new Error('Bounded evaluation reached provider output ceiling');
    if (response.protocol === 'anthropic-messages-v1') {
      const text = response.body.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        .map((line) => { try { return JSON.parse(line.slice(5).trim()) as Record<string, unknown>; } catch { return null; } })
        .filter((event) => event?.type === 'content_block_delta'
          && (event.delta as Record<string, unknown> | undefined)?.type === 'text_delta')
        .map((event) => String((event?.delta as Record<string, unknown>).text ?? '')).join('');
      if (!text) throw new Error('Bounded evaluation returned no terminal text');
      return { text, usage: response.usage };
    }
    const completed = response.body.split(/\r?\n\r?\n/).flatMap((block) => block.split(/\r?\n/))
      .filter((line) => line.startsWith('data:'))
      .map((line) => { try { return JSON.parse(line.slice(5).trim()) as Record<string, unknown>; } catch { return null; } })
      .filter((event) => event?.type === 'response.completed').pop();
    const output = (completed?.response as Record<string, unknown> | undefined)?.output;
    const text = Array.isArray(output) ? output.flatMap((item) => {
      const content = (item as Record<string, unknown>).content;
      return Array.isArray(content) ? content.filter((part) => (part as Record<string, unknown>).type === 'output_text')
        .map((part) => String((part as Record<string, unknown>).text ?? '')) : [];
    }).join('') : '';
    if (!text) throw new Error('Bounded evaluation returned no terminal text');
    return { text, usage: response.usage };
  }
}

let activeRelay: OrgEvaluationProviderRelay | null = null;

export function getOrgEvaluationProviderRelay(): OrgEvaluationProviderRelay {
  activeRelay ??= new OrgEvaluationProviderRelay({
    repository: new OrgEvaluationRepository(),
    baseURL: 'http://127.0.0.1:0/agent-org-proposals/evaluations/provider',
    dedicatedListener: true,
    resolveUpstream: resolveConfiguredEvaluationUpstream,
  });
  return activeRelay;
}
