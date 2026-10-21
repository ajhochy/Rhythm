import Database from 'better-sqlite3';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQLITE_ORG_EVALUATION_SCHEMA } from '../../database/org_evaluation_schema';
import { OrgEvaluationRepository } from '../../repositories/org_evaluation_repository';
import { OrgEvaluationProviderRelay, resolveConfiguredEvaluationUpstream } from '../org_evaluation_provider_relay';
import type { OrgEvaluationTargetSnapshot } from '../org_evaluation_fixture';
import type { OrgEvaluationCandidate } from '../../models/org_evaluation';

const live = process.env.RHYTHM_ORG_EVALUATION_LIVE === '1';

describe.skipIf(!live)('private engine evaluation with real bounded provider', () => {
  it('executes an original arm using only a budgeted loopback relay', async () => {
    const root = mkdtempSync('/private/tmp/rhythm-org-evaluation-live-');
    const db = new Database(':memory:');
    db.exec(SQLITE_ORG_EVALUATION_SCHEMA);
    const repo = new OrgEvaluationRepository(db);
    const jobId = 'live-budget-root';
    await repo.createJobAsync({ id: jobId, sourceAuditRunId: null, ownerUserId: null,
      maxTokens: 20_000, validationReserveTokens: 0, originalHash: 'synthetic-original',
      targetRef: 'agent_config:evaluation-fixture-agent', targetRevision: '1', inputJson: '{}' });
    const app = express();
    app.use(express.json({ limit: '256kb' }));
    const server = createServer(app);
    try {
      await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Loopback relay address missing');
      const relay = new OrgEvaluationProviderRelay({ repository: repo,
        baseURL: `http://127.0.0.1:${address.port}/agent-org-proposals/evaluations/provider`,
        resolveUpstream: resolveConfiguredEvaluationUpstream });
      app.post('/agent-org-proposals/evaluations/provider/:leaseId/v1/messages',
        (request, response, next) => {
          const body = request.body as Record<string, unknown>;
          console.log('relay request', request.path, body.model,
            JSON.stringify({ keys: Object.keys(body), tools: Array.isArray(body.tools) ? body.tools.map((tool: Record<string, unknown>) => Object.keys(tool)) : null,
              system: Array.isArray(body.system) ? body.system.map((part: Record<string, unknown>) => Object.keys(part)) : typeof body.system }),
            JSON.stringify(Array.isArray(body.messages) ? body.messages.map((item: Record<string, unknown>) => ({
              keys: Object.keys(item), role: item.role,
              content: Array.isArray(item.content) ? item.content.map((part: Record<string, unknown>) => ({
                type: part.type, keys: Object.keys(part),
                caller: part.caller === undefined ? null : { type: typeof part.caller,
                  keys: part.caller && typeof part.caller === 'object' ? Object.keys(part.caller) : [] },
                cacheControl: part.cache_control === undefined ? null : { type: typeof part.cache_control,
                  keys: part.cache_control && typeof part.cache_control === 'object' ? Object.keys(part.cache_control) : [] },
                contentValueType: typeof part.content, contentIsArray: Array.isArray(part.content),
                isErrorType: typeof part.is_error,
              })) : typeof item.content,
            })) : 'no messages'));
          void relay.handle(request, response, next);
        });
      app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
        console.log('relay error', error.message); response.status(500).json({ error: error.message });
      });
      const model = { providerID: 'anthropic' as const, modelID: 'claude-sonnet-4-5' };
      const snapshot: OrgEvaluationTargetSnapshot = { schemaVersion: 1,
        kind: 'refine-config', targetRef: 'agent_config:evaluation-fixture-agent', targetRevision: '1',
        effectiveModel: { providerID: model.providerID, modelID: model.modelID, source: 'profile' },
        profiles: [{ id: 'evaluation-fixture-agent', label: 'Evaluation Fixture Agent',
          systemPrompt: 'Respond with exactly SUMMARY.', revision: 1,
          allowedMcpsJson: '{"evaluation-fixture":["read_fixture"]}', allowedSkillsJson: '[]',
          corePermissionsJson: '{}', allowedDelegatesJson: '[]', isManager: false,
          modelProvider: model.providerID, modelId: model.modelID }],
        skills: [], schedules: [], recipes: [], managedSkillFiles: [] };
      // The disposable child is a Node process, so drive the compiled service
      // while Vitest itself executes TypeScript source.
      const { createOrgEvaluationRuntimeAdapter } = require(resolve(
        'apps/api_server/dist/services/org_evaluation_runtime.js')) as typeof import('../org_evaluation_runtime');
      const runtime = createOrgEvaluationRuntimeAdapter({
        engineBinary: resolve('apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode'),
        workerBaseRoot: root, model,
        createLease: (input) => relay.createLease(input), finishLease: (leaseId) => {
          const usage = relay.finishLease(leaseId); console.log('relay usage', usage); return usage;
        },
        getObservedToolCatalog: (leaseId) => relay.getObservedToolCatalog(leaseId),
        enginePort: () => 49477, wallMs: 120_000,
      });
      const prepared = await runtime.prepare({ snapshot, kind: 'refine-config',
        targetRef: snapshot.targetRef, changeJson: '{}', role: 'original',
        proposal: { title: 'Synthetic fixture', rationale: 'Bounded live test', securityNote: null } });
      const candidate: OrgEvaluationCandidate = { id: 'original-fixture', jobId,
        role: 'original', ordinal: 0, kind: 'refine-config', targetRef: snapshot.targetRef,
        configHash: prepared.manifestHash, effectiveConfigJson: prepared.manifestJson,
        changeJson: '{}', parentCandidateIds: [], createdAt: new Date().toISOString() };
      if (process.env.RHYTHM_ORG_EVALUATION_PREPARE_ONLY === '1') return;
      if (process.env.RHYTHM_ORG_EVALUATION_TOOL_ONLY !== '1') {
      const task = { key: 'basic-reply', prompt: 'Give the heading instructed by your system prompt.',
        outputIncludes: ['ACTIONS'], outputExcludes: [] };
      const result = await runtime.execute({ jobId, candidate, snapshot,
        task,
        phase: 'probe', stage: 'original-probe',
        proposal: { title: 'Synthetic fixture', rationale: 'Bounded live test', securityNote: null } });
      expect(result.status).toBe('pass');
      expect(result.score).toBe(0);
      expect(result.tokenUsage?.totalTokens).toBeGreaterThan(0);
      const receipt = JSON.parse(result.receiptJson) as Record<string, unknown>;
      expect(receipt.effectiveConfigHash).toBe(prepared.manifestHash);
      expect((receipt.effectProof as Record<string, unknown>).negativeGuardsPassed).toBe(true);
      expect((await repo.getBudgetAsync(jobId)).settledTokens).toBeGreaterThan(0);
      const changeJson = JSON.stringify({ configPatch: { agentConfigId: 'evaluation-fixture-agent',
        field: 'system_prompt', value: 'Respond with exactly ACTIONS.' } });
      const variantManifest = await runtime.prepare({ snapshot, kind: 'refine-config',
        targetRef: snapshot.targetRef, changeJson, role: 'variant',
        proposal: { title: 'Synthetic fixture', rationale: 'Bounded live test', securityNote: null } });
      expect(variantManifest.manifestHash).not.toBe(prepared.manifestHash);
      const variant: OrgEvaluationCandidate = { ...candidate, id: 'variant-fixture', role: 'variant', ordinal: 1,
        configHash: variantManifest.manifestHash, effectiveConfigJson: variantManifest.manifestJson,
        changeJson, parentCandidateIds: [candidate.id] };
      const variantResult = await runtime.execute({ jobId, candidate: variant, snapshot, task,
        phase: 'probe', stage: 'candidate-probe',
        proposal: { title: 'Synthetic fixture', rationale: 'Bounded live test', securityNote: null } });
      expect(variantResult.status).toBe('pass');
      expect(variantResult.score).toBe(1);
      expect(variantResult.tokenUsage?.totalTokens).toBeGreaterThan(0);
      }
      const toolSnapshot: OrgEvaluationTargetSnapshot = { ...snapshot,
        profiles: [{ ...snapshot.profiles[0], systemPrompt:
          'Call the evaluation-fixture read_fixture tool with key request before replying. Then reply exactly ACTIONS.' }] };
      const toolManifest = await runtime.prepare({ snapshot: toolSnapshot, kind: 'refine-config',
        targetRef: toolSnapshot.targetRef, changeJson: '{}', role: 'original',
        proposal: { title: 'Synthetic MCP fixture', rationale: 'Bounded tool proof', securityNote: null } });
      const toolCandidate: OrgEvaluationCandidate = { ...candidate, id: 'tool-fixture',
        configHash: toolManifest.manifestHash, effectiveConfigJson: toolManifest.manifestJson };
      const toolResult = await runtime.execute({ jobId, candidate: toolCandidate, snapshot: toolSnapshot,
        task: { key: 'fixture-tool', prompt: 'Use read_fixture with key request, then reply exactly ACTIONS.',
          outputIncludes: ['ACTIONS'], outputExcludes: [] },
        phase: 'probe', stage: 'original-probe',
        proposal: { title: 'Synthetic MCP fixture', rationale: 'Bounded tool proof', securityNote: null } });
      const toolReceipt = JSON.parse(toolResult.receiptJson) as Record<string, unknown>;
      console.log('tool proof', JSON.stringify({ toolEvents: toolReceipt.toolEvents,
        fixtureToolEvents: toolReceipt.fixtureToolEvents, providerToolCatalogs: toolReceipt.providerToolCatalogs }));
      if (process.env.RHYTHM_ORG_EVALUATION_TOOL_PROOF_PATH) {
        writeFileSync(process.env.RHYTHM_ORG_EVALUATION_TOOL_PROOF_PATH, JSON.stringify({
          toolEvents: toolReceipt.toolEvents, fixtureToolEvents: toolReceipt.fixtureToolEvents,
          providerToolCatalogs: toolReceipt.providerToolCatalogs,
        }), { mode: 0o600 });
      }
      expect(toolResult.status).toBe('pass');
      expect((toolReceipt.fixtureToolEvents as unknown[]).length).toBeGreaterThan(0);
      const deniedSnapshot: OrgEvaluationTargetSnapshot = { ...toolSnapshot,
        profiles: [{ ...toolSnapshot.profiles[0], allowedMcpsJson: '[]',
          systemPrompt: 'Attempt mcp_dispatch execute for evaluation-fixture_read_fixture with key request. Report DENIED if unavailable.' }] };
      const deniedManifest = await runtime.prepare({ snapshot: deniedSnapshot, kind: 'refine-config',
        targetRef: deniedSnapshot.targetRef, changeJson: '{}', role: 'original',
        proposal: { title: 'Synthetic MCP denial', rationale: 'Bounded negative tool proof', securityNote: null } });
      const deniedCandidate: OrgEvaluationCandidate = { ...candidate, id: 'denied-tool-fixture',
        configHash: deniedManifest.manifestHash, effectiveConfigJson: deniedManifest.manifestJson };
      const deniedResult = await runtime.execute({ jobId, candidate: deniedCandidate, snapshot: deniedSnapshot,
        task: { key: 'denied-fixture-tool',
          prompt: 'Attempt mcp_dispatch execute name evaluation-fixture_read_fixture with arguments key request. Say DENIED if unavailable.',
          outputIncludes: [], outputExcludes: [] },
        phase: 'probe', stage: 'original-probe',
        proposal: { title: 'Synthetic MCP denial', rationale: 'Bounded negative tool proof', securityNote: null } });
      const deniedReceipt = JSON.parse(deniedResult.receiptJson) as Record<string, unknown>;
      console.log('denied tool proof', JSON.stringify({ toolEvents: deniedReceipt.toolEvents,
        fixtureToolEvents: deniedReceipt.fixtureToolEvents, providerToolCatalogs: deniedReceipt.providerToolCatalogs }));
      if (process.env.RHYTHM_ORG_EVALUATION_TOOL_PROOF_PATH) {
        writeFileSync(process.env.RHYTHM_ORG_EVALUATION_TOOL_PROOF_PATH, JSON.stringify({
          allowed: { toolEvents: toolReceipt.toolEvents, fixtureToolEvents: toolReceipt.fixtureToolEvents,
            providerToolCatalogs: toolReceipt.providerToolCatalogs },
          denied: { toolEvents: deniedReceipt.toolEvents, fixtureToolEvents: deniedReceipt.fixtureToolEvents,
            providerToolCatalogs: deniedReceipt.providerToolCatalogs },
        }), { mode: 0o600 });
      }
      expect(deniedResult.status).toBe('pass');
      expect(deniedReceipt.fixtureToolEvents).toEqual([]);
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()));
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});
