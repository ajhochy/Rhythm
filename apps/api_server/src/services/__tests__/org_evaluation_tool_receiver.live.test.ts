/** Real Docker observation. This is not a real-engine or packaged UI test. */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { startOrgEvaluationToolReceiverAsync } from '../org_evaluation_tool_receiver';
import { OrgEvaluationMcpFixture } from '../org_evaluation_mcp_fixture';
import { vetToolInstallCandidateAsync } from '../org_evaluation_external_effects';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { buildProfileRevisionFingerprint } from '../org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../../models/proposal_evidence_bundle';
import { GUARDRAIL_NAMES } from '../../models/guardrail_registry';

function entry(name: string, body: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write(name.endsWith('.js') ? '0000755' : '0000644', 100);
  header.write('0000000', 108);
  header.write('0000000', 116);
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257);
  header.fill(0x20, 148, 156);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

describe.skipIf(process.env.RHYTHM_EVAL_TOOL_DOCKER !== '1')('real confined evaluated tool receiver', () => {
  it('runs a pinned CLI inside Docker after private MCP authorization and observes kernel write denial', async () => {
    const root = mkdtempSync('/private/tmp/rhythm-eval-tool-receiver-');
    const artifacts = join(root, 'artifacts');
    const workerRoot = join(root, 'worker');
    let receiver: Awaited<ReturnType<typeof startOrgEvaluationToolReceiverAsync>> | null = null;
    let db: Database.Database | null = null;
    let previousDb: ReturnType<typeof setDb> | undefined;
    const priorUrl = process.env.RHYTHM_EVALUATION_TOOL_RECEIVER_URL;
    const priorToken = process.env.RHYTHM_EVALUATION_TOOL_RECEIVER_TOKEN;
    try {
    mkdirSync(artifacts);
    mkdirSync(workerRoot);
    const archive = gzipSync(Buffer.concat([
      entry('package/package.json', JSON.stringify({ name: 'fixture-tool', version: '1.0.0',
        bin: { 'fixture-tool': 'index.js' } })),
      entry('package/index.js', '#!/usr/bin/env node\nconsole.log("fixture-tool 1.0.0")\n'),
      Buffer.alloc(1024),
    ]));
    const digest = createHash('sha256').update(archive).digest('hex');
    writeFileSync(join(artifacts, `${digest}.tgz`), archive);
    db = new Database(':memory:');
    runMigrations(db);
    previousDb = setDb(db);
    const profile = new AgentConfigsRepository().insert({ label: 'Tool receiver fixture', icon: 'tool' });
    const changeJson = JSON.stringify({ toolName: 'fixture-tool', packageSource: `local-tarball:sha256:${digest}`,
      installMethod: 'local-tarball', agentConfigId: profile.id, testPrompts: ['version-check', 'help-check'],
      evidenceBundle: { version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
        sourceEvidence: { sessionIds: ['fixture-a', 'fixture-b'], eventIds: [] },
        counterEvidenceSearch: { query: 'owned fixture', searchedAt: '2026-10-21T00:00:00.000Z', contradictingCount: 0 },
        target: { ref: `agent_config:${profile.id}`, hash: buildProfileRevisionFingerprint(profile) },
        expectedOutcome: 'Fixture tool works', primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
        guardrails: [...GUARDRAIL_NAMES], experimentAdapter: 'usage-count', rollbackRule: 'remove fixture',
        generatorVersion: 'fixture', confidenceCalibrationVersion: 'fixture' } });
      const vetted = await vetToolInstallCandidateAsync({ changeJson, workerRoot, artifactRoot: artifacts });
      expect(vetted.status).toBe('observed');
      expect(vetted.report.verdict).toBe('safe');
      receiver = await startOrgEvaluationToolReceiverAsync({ workerRoot, artifactRoot: artifacts,
        changeJson });
      expect((await fetch(`${receiver.baseURL}/invoke`, { method: 'POST', headers: {
        'content-type': 'application/json' }, body: JSON.stringify({ scenarioId: 'version-check' }) })).status).toBe(404);
      const response = await fetch(`${receiver.baseURL}/invoke`, { method: 'POST', headers: {
        authorization: `Bearer ${receiver.token}`, 'content-type': 'application/json',
      }, body: JSON.stringify({ scenarioId: 'version-check' }) });
      expect(response.status).toBe(200);
      const result = await response.json() as { output: string; receiptHash: string };
      expect(result.output).toContain('fixture-tool 1.0.0');
      expect(receiver.observations()).toMatchObject([{ scenarioId: 'version-check', artifactDigest: digest,
        receiptHash: result.receiptHash, forbiddenArtifactWriteDenied: true, containerNetworkMode: 'none' }]);
      const fixture = new OrgEvaluationMcpFixture(workerRoot);
      expect((await fixture.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))?.result)
        .not.toMatchObject({ tools: expect.arrayContaining([expect.objectContaining({ name: 'invoke_vetted_tool' })]) });
      process.env.RHYTHM_EVALUATION_TOOL_RECEIVER_URL = receiver.baseURL;
      process.env.RHYTHM_EVALUATION_TOOL_RECEIVER_TOKEN = receiver.token;
      expect((await fixture.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))?.result)
        .toMatchObject({ tools: expect.arrayContaining([expect.objectContaining({ name: 'invoke_vetted_tool' })]) });
      const invoked = await fixture.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
        name: 'invoke_vetted_tool', arguments: { scenarioId: 'help-check' },
      } });
      expect(JSON.stringify(invoked)).toContain('fixture-tool 1.0.0');
      expect(receiver.observations().map((item) => item.scenarioId)).toEqual(['version-check', 'help-check']);
      const ledger = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8').trim()) as Record<string, unknown>;
      expect(ledger).toMatchObject({ tool: 'invoke_vetted_tool', arguments: { scenarioId: 'help-check' },
        outputHash: receiver.observations()[1].outputHash,
        receiverReceiptHash: receiver.observations()[1].receiptHash });
      expect((await fetch(`${receiver.baseURL}/invoke`, { method: 'POST', headers: {
        authorization: `Bearer ${receiver.token}`, 'content-type': 'application/json',
      }, body: JSON.stringify({ scenarioId: 'version-check' }) })).status).toBe(400);
    } finally {
      if (priorUrl === undefined) delete process.env.RHYTHM_EVALUATION_TOOL_RECEIVER_URL;
      else process.env.RHYTHM_EVALUATION_TOOL_RECEIVER_URL = priorUrl;
      if (priorToken === undefined) delete process.env.RHYTHM_EVALUATION_TOOL_RECEIVER_TOKEN;
      else process.env.RHYTHM_EVALUATION_TOOL_RECEIVER_TOKEN = priorToken;
      await receiver?.close();
      if (previousDb !== undefined) setDb(previousDb);
      db?.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 90_000);
});
