/** No-model probe of the routed live harness's hand-built provider route. */
import Database from 'better-sqlite3';
import express from 'express';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { SQLITE_ORG_EVALUATION_SCHEMA } from '../../database/org_evaluation_schema';
import { OrgEvaluationRepository } from '../../repositories/org_evaluation_repository';
import { OrgEvaluationProviderRelay } from '../org_evaluation_provider_relay';
import { evaluationSandboxPolicy } from '../org_evaluation_runtime';

const handles: Database.Database[] = [];
afterEach(() => { for (const db of handles.splice(0)) db.close(); });

it('settles a real HTTP Anthropic lease through the routed harness path without a model', async () => {
  const db = new Database(':memory:'); handles.push(db); db.exec(SQLITE_ORG_EVALUATION_SCHEMA);
  const repository = new OrgEvaluationRepository(db);
  await repository.createJobAsync({ id: 'routed-root', sourceAuditRunId: null, ownerUserId: null,
    maxTokens: 20_000, validationReserveTokens: 0, originalHash: 'synthetic-original',
    targetRef: 'recipe:Owned recipe', targetRevision: 'absent', inputJson: '{}' });
  let upstreamCalls = 0;
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  const server = createServer(app);
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Private relay did not bind');
    const relay = new OrgEvaluationProviderRelay({ repository,
      baseURL: `http://127.0.0.1:${address.port}/agent-org-proposals/evaluations/provider`,
      resolveUpstream: async () => ({ url: 'https://api.anthropic.com/v1/messages', headers: {},
        protocol: 'anthropic-messages-v1', supportsMaxOutputTokens: true, noHiddenContext: true }),
      fetchImpl: async () => {
        upstreamCalls++;
        const events = [
          { type: 'message_start', message: { usage: { input_tokens: 12 } } },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
          { type: 'message_stop' },
        ];
        return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
          { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    app.post('/agent-org-proposals/evaluations/provider/:leaseId/v1/messages',
      (request, response, next) => { void relay.handle(request, response, next); });
    const lease = await relay.createLease({ jobId: 'routed-root', stage: 'original-probe',
      model: 'claude-sonnet-4-5', maxCalls: 4 });
    const response = await fetch(`${lease.baseURL}/messages`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${lease.token}` },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'synthetic' }],
      max_tokens: 16 }) });
    expect(response.status).toBe(200);
    expect(upstreamCalls).toBe(1);
    expect(relay.finishLease(lease.leaseId)).toMatchObject({ totalTokens: 15 });
    expect(await repository.getBudgetAsync('routed-root')).toMatchObject({
      settledTokens: 15, outstandingTokens: 0, hasUnknownUsage: false });
    if (process.platform === 'darwin') {
      const root = mkdtempSync('/private/tmp/rhythm-routed-relay-sandbox-');
      try {
        const second = await relay.createLease({ jobId: 'routed-root', stage: 'candidate-probe',
          model: 'claude-sonnet-4-5', maxCalls: 1 });
        const policy = evaluationSandboxPolicy({ workerRoot: root,
          programRoots: [dirname(process.execPath)], enginePort: 57991, relayPort: address.port });
        const policyPath = join(root, 'policy.sb');
        const scriptPath = join(root, 'request.mjs');
        const requestPath = join(root, 'request.json');
        writeFileSync(policyPath, policy, { mode: 0o600 });
        writeFileSync(requestPath, JSON.stringify({ url: `${second.baseURL}/messages`, token: second.token }),
          { mode: 0o600 });
        writeFileSync(scriptPath, `import { readFileSync } from 'node:fs';
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const response = await fetch(request.url, { method: 'POST', headers: {
  'content-type': 'application/json', authorization: 'Bearer ' + request.token },
  body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'synthetic' }],
    max_tokens: 16 }) });
process.exit(response.status === 200 ? 0 : 1);\n`, { mode: 0o600 });
        const exitCode = await new Promise<number | null>((resolve, reject) => {
          const child = spawn('/usr/bin/sandbox-exec', ['-f', policyPath, process.execPath,
            scriptPath, requestPath], { stdio: 'ignore' });
          child.once('error', reject);
          child.once('exit', resolve);
        });
        expect(exitCode).toBe(0);
        expect(relay.finishLease(second.leaseId)).toMatchObject({ totalTokens: 15 });
        expect(await repository.getBudgetAsync('routed-root')).toMatchObject({
          settledTokens: 30, outstandingTokens: 0, hasUnknownUsage: false });
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
  }
});
