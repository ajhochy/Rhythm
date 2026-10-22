/** Actual private-engine managed-tool pair. This test makes provider calls and
 * starts disposable Docker containers only when explicitly gated. It must use
 * the exact locally signed qualification bundle and a fresh selected loan. */
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { describe, it } from 'vitest';
import type { OrgEvaluationCandidate } from '../../models/org_evaluation';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../../models/proposal_evidence_bundle';
import { GUARDRAIL_NAMES } from '../../models/guardrail_registry';
import type { OrgEvaluationTargetSnapshot } from '../org_evaluation_fixture';
import { loadPackagedOrgEvaluationAuthorityAsync } from './org_evaluation_packaged_live_authority';

const enabled = process.env.RHYTHM_ORG_EVALUATION_MANAGED_ENGINE_LIVE === '1';
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const model = { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' };
const profile = { id: 'smoke-managed-profile', label: '[smoke] managed profile', revision: 1,
  systemPrompt: 'Use available managed tools to answer the task. Report only observed tool results.',
  allowedMcpsJson: JSON.stringify({ rhythm: ['rhythm_list_managed_tools', 'rhythm_run_managed_tool'] }),
  allowedSkillsJson: '[]', corePermissionsJson: '{}', allowedDelegatesJson: '[]', isManager: false,
  modelProvider: model.providerID, modelId: model.modelID };
// Product default whole-run cap. Reservations are pessimistic (request bytes +
// output ceiling), so a 20k cap refused the candidate arm's later calls; a routed
// pair alone needs ~120-130k, more than the former 100k default.
const RUN_TOKEN_CAP = 1_500_000;
const targetRef = `agent_config:${profile.id}`;
const proposal = { title: 'Owned immutable CLI', rationale: 'Measure a real managed command outcome',
  securityNote: 'Runs only in copied state and network-disabled Docker' };

function tarEntry(name: string, body: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name); header.write('0000755', 100); header.write('0000000', 108);
  header.write('0000000', 116); header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136); header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257); header.fill(0x20, 148, 156);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - body.length % 512) % 512)]);
}

function writeOwnedTarball(artifactRoot: string): string {
  mkdirSync(artifactRoot, { mode: 0o700 });
  const archive = gzipSync(Buffer.concat([
    tarEntry('package/package.json', JSON.stringify({ name: 'fixture-tool', version: '1.0.0',
      bin: { 'fixture-tool': 'index.js' } })),
    tarEntry('package/index.js', '#!/usr/bin/env node\nconsole.log("fixture-tool 1.0.0")\n'),
    Buffer.alloc(1024),
  ]));
  const digest = sha256(archive);
  writeFileSync(join(artifactRoot, `${digest}.tgz`), archive, { mode: 0o400, flag: 'wx' });
  return digest;
}

type Receipt = { sessionId: string; outputText: string; outputHash: string;
  toolEvents: Array<{ name: string; status: string; callId: string;
    dispatch: { action: string; name: string } | null; resultContentHashes: string[] }>;
  managedReceiverObservations: Array<{ toolName: string; callId: string; status: number;
    responseHash: string; denialReason?: string; proposalId?: string; artifactDigest?: string;
    networkMode?: string; forbiddenArtifactWriteDenied?: boolean }>;
  dockerVetting?: { status: string; changeHash: string; receiptHash: string };
  effectProof: { negativeGuardsPassed: boolean; events: Array<{ kind: string;
    evidenceHash: string; subject: string }> } };

function boundedArmDiagnostic(input: { role: string; status: string; score: number | null;
  tokenUsage: { totalTokens: number } | null; manifestHash: string; receipt: Receipt }) {
  const { receipt } = input;
  return { role: input.role, status: input.status, score: input.score,
    totalTokens: input.tokenUsage?.totalTokens ?? null, manifestHash: input.manifestHash,
    outputHash: receipt.outputHash, outputBytes: Buffer.byteLength(receipt.outputText),
    negativeGuardsPassed: receipt.effectProof.negativeGuardsPassed,
    effects: receipt.effectProof.events.slice(0, 48).map(({ kind, evidenceHash }) => ({
      kind: kind.slice(0, 80), evidenceHash })),
    receiver: receipt.managedReceiverObservations.slice(0, 48).map((entry) => ({
      toolName: entry.toolName.slice(0, 80), status: entry.status,
      callIdHash: sha256(entry.callId), denialReason: entry.denialReason ?? null,
      proposalIdHash: entry.proposalId ? sha256(entry.proposalId) : null,
      artifactDigest: entry.artifactDigest ?? null, responseHash: entry.responseHash,
      networkMode: entry.networkMode ?? null,
      forbiddenArtifactWriteDenied: entry.forbiddenArtifactWriteDenied ?? null,
    })),
    history: receipt.toolEvents.slice(0, 64).map((part) => ({
      name: part.name.slice(0, 80), status: part.status.slice(0, 32),
      callIdHash: sha256(part.callId), action: part.dispatch?.action.slice(0, 32) ?? null,
      dispatchedTool: part.dispatch?.name.slice(0, 80) ?? null,
      resultContentHashes: part.resultContentHashes.slice(0, 8),
    })),
  };
}

async function runPair(): Promise<void> {
  const authority = await loadPackagedOrgEvaluationAuthorityAsync();
  const apiRoot = join(dirname(authority.engineBinary), '../api_server');
  const { OrgEvaluationProviderRelay, resolveConfiguredEvaluationUpstream } = authority;
  const { SQLITE_ORG_EVALUATION_SCHEMA } = require(join(apiRoot,
    'dist/database/org_evaluation_schema.js')) as typeof import('../../database/org_evaluation_schema');
  const { OrgEvaluationRepository } = require(join(apiRoot,
    'dist/repositories/org_evaluation_repository.js')) as typeof import('../../repositories/org_evaluation_repository');
  const { buildProfileRevisionFingerprint } = require(join(apiRoot,
    'dist/services/org_proposal_experiment_service.js')) as typeof import('../org_proposal_experiment_service');
  const { privateToolProposalId } = require(join(apiRoot,
    'dist/services/org_evaluation_managed_lifecycle.js')) as typeof import('../org_evaluation_managed_lifecycle');

  const root = mkdtempSync('/private/tmp/rhythm-managed-engine-live-');
  const priorArtifactRoot = process.env.RHYTHM_TOOL_ARTIFACT_ROOT;
  const artifactRoot = join(root, 'artifacts');
  const digest = writeOwnedTarball(artifactRoot);
  process.env.RHYTHM_TOOL_ARTIFACT_ROOT = artifactRoot;
  const snapshot: OrgEvaluationTargetSnapshot = { schemaVersion: 1,
    kind: 'tool-install', targetRef, targetRevision: 'absent',
    effectiveModel: { ...model, source: 'profile' }, profiles: [profile],
    skills: [], schedules: [], recipes: [], managedSkillFiles: [],
    creationControl: { targetName: 'fixture-tool', absenceKind: 'managed-tool',
      baselineProfileId: profile.id, catalogFingerprint: 'owned-absent',
      evidenceSessionIds: ['owned-evidence-1', 'owned-evidence-2'], dependencyFingerprints: {} } };
  const changeJson = JSON.stringify({ toolName: 'fixture-tool',
    packageSource: `local-tarball:sha256:${digest}`, installMethod: 'local-tarball',
    agentConfigId: profile.id, testPrompts: ['version-check', 'help-check'],
    evidenceBundle: { version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
      sourceEvidence: { sessionIds: ['owned-evidence-1', 'owned-evidence-2'], eventIds: [] },
      counterEvidenceSearch: { query: 'private managed tool absence',
        searchedAt: '2026-10-21T00:00:00.000Z', contradictingCount: 0 },
      target: { ref: targetRef, hash: buildProfileRevisionFingerprint(profile) },
      expectedOutcome: 'CLI version is available to the approved agent',
      primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
      guardrails: [...GUARDRAIL_NAMES], experimentAdapter: 'usage-count',
      rollbackRule: 'Remove the private managed tool', generatorVersion: 'live-test',
      confidenceCalibrationVersion: 'live-test' } });
  const proposalId = privateToolProposalId(targetRef, changeJson);
  const db = new Database(':memory:');
  db.exec(SQLITE_ORG_EVALUATION_SCHEMA);
  const repository = new OrgEvaluationRepository(db);
  const jobId = 'managed-live-root';
  const observedArms: Array<{ role: string; status: string; score: number | null;
    tokenUsage: { totalTokens: number } | null; manifestHash: string; receipt: Receipt }> = [];
  const relay = new OrgEvaluationProviderRelay({ repository, dedicatedListener: true,
    baseURL: 'http://127.0.0.1:4796/agent-org-proposals/evaluations/provider',
    resolveUpstream: async (modelId) => { authority.assertCurrentLoan();
      return resolveConfiguredEvaluationUpstream(modelId); } });
  try {
    await repository.createJobAsync({ id: jobId, sourceAuditRunId: null, ownerUserId: null,
      maxTokens: RUN_TOKEN_CAP, validationReserveTokens: 0, originalHash: sha256(JSON.stringify(snapshot)),
      targetRef, targetRevision: 'absent', inputJson: JSON.stringify({ snapshot }) });
    const runtime = authority.createOrgEvaluationRuntimeAdapter({
      engineBinary: authority.engineBinary,
      workerBaseRoot: root, model, createLease: request => relay.createLease(request),
      finishLease: leaseId => relay.finishLease(leaseId),
      describeLeaseFailure: leaseId => relay.describeLeaseFailure(leaseId),
      getObservedToolCatalog: leaseId => relay.getObservedToolCatalog(leaseId),
      enginePort: () => randomInt(50000, 59000), wallMs: 120_000,
    });
    const task = { key: 'managed-version',
      prompt: `Use mcp_dispatch family=mcp to describe and execute the catalog name rhythm_rhythm_list_managed_tools with arguments {}. Then describe and execute rhythm_rhythm_run_managed_tool with arguments {"proposalId":"${proposalId}","argv":["--version"]}. If the actual tool output says fixture-tool 1.0.0, respond TOOL_READY. Otherwise report TOOL_UNAVAILABLE. Do not infer a result from tool descriptions.`,
      outputIncludes: ['TOOL_READY'], outputExcludes: ['TOOL_UNAVAILABLE'] };
    const runArm = async (role: 'original' | 'variant', change: string,
      stage: 'original-probe' | 'candidate-probe') => {
      authority.assertCurrentLoan();
      const prepared = await runtime.prepare({ snapshot, kind: 'tool-install', targetRef,
        changeJson: change, role, proposal });
      const candidate: OrgEvaluationCandidate = { id: `${role}-managed`, jobId, role,
        ordinal: role === 'original' ? 0 : 1, kind: 'tool-install', targetRef,
        configHash: prepared.manifestHash, effectiveConfigJson: prepared.manifestJson,
        changeJson: change, parentCandidateIds: [], createdAt: new Date().toISOString() };
      const result = await runtime.execute({ jobId, candidate, snapshot, task,
        phase: 'probe', stage, proposal });
      const receipt = JSON.parse(result.receiptJson) as Receipt;
      observedArms.push({ role, status: result.status, score: result.score,
        tokenUsage: result.tokenUsage, manifestHash: prepared.manifestHash, receipt });
      assert.equal(result.status, 'pass', result.failureReason ?? 'managed arm did not pass');
      assert.ok(result.tokenUsage && result.tokenUsage.totalTokens > 0);
      assert.equal(receipt.effectProof.negativeGuardsPassed, true);
      assert.equal(receipt.outputHash, sha256(receipt.outputText));
      return { result, receipt, manifest: prepared.manifestHash };
    };
    const original = await runArm('original', '{}', 'original-probe');
    const candidate = await runArm('variant', changeJson, 'candidate-probe');
    assert.equal(original.result.score, 0);
    assert.equal(candidate.result.score, 1);
    assert.notEqual(original.manifest, candidate.manifest);
    assert.notEqual(original.receipt.sessionId, candidate.receipt.sessionId);
    assert.ok(candidate.receipt.outputText.includes('TOOL_READY'));
    const originalObservations = original.receipt.managedReceiverObservations;
    const emptyListHash = sha256(JSON.stringify({ tools: [] }));
    assert.ok(originalObservations.some(event => event.toolName === 'rhythm_list_managed_tools' &&
      event.status === 200 && event.responseHash === emptyListHash));
    assert.ok(originalObservations.some(event => event.toolName === 'rhythm_run_managed_tool' &&
      event.status === 403 && event.denialReason === 'not-installed' && event.proposalId === proposalId));
    assert.ok(!originalObservations.some(event => event.toolName === 'rhythm_run_managed_tool' && event.status === 200));
    assert.equal(original.receipt.dockerVetting, undefined);
    assert.ok(!original.receipt.effectProof.events.some(event => event.kind === 'tool-installed' ||
      event.kind === 'tool-invoked'));
    assert.ok(original.receipt.effectProof.events.some(event => event.kind === 'managed-original-absent'));
    const run = candidate.receipt.managedReceiverObservations.find(event =>
      event.toolName === 'rhythm_run_managed_tool' && event.status === 200 &&
      event.proposalId === proposalId && event.artifactDigest === digest && event.networkMode === 'none' &&
      event.forbiddenArtifactWriteDenied === true);
    assert.ok(run, 'candidate has no private signed Docker execution');
    assert.ok(candidate.receipt.managedReceiverObservations.some(event =>
      event.toolName === 'external-content-taint' && event.status === 201 &&
      event.callId === run.callId && event.responseHash === run.responseHash));
    assert.ok(candidate.receipt.toolEvents.some(part => part.name === 'mcp_dispatch' &&
      part.status === 'completed' && part.callId === run.callId &&
      part.dispatch?.action === 'execute' && part.dispatch.name === 'rhythm_rhythm_run_managed_tool' &&
      part.resultContentHashes.includes(run.responseHash)));
    for (const kind of ['docker-safety-vetted', 'tool-installed', 'tool-invoked',
      'forbidden-tool-effect-denied']) {
      assert.ok(candidate.receipt.effectProof.events.some(event => event.kind === kind &&
        /^[a-f0-9]{64}$/.test(event.evidenceHash)), `${kind} was not observed`);
    }
    assert.equal(candidate.receipt.dockerVetting?.status, 'observed');
    assert.equal(candidate.receipt.dockerVetting?.changeHash, sha256(changeJson));
    const budget = await repository.getBudgetAsync(jobId);
    assert.ok(budget.settledTokens > 0 && budget.settledTokens <= RUN_TOKEN_CAP);
    assert.equal(budget.outstandingTokens, 0);
    assert.equal(budget.hasUnknownUsage, false);
  } catch (error) {
    // The loan runner scrubs its fixture even after failure, so retain a new
    // owned evidence directory. Never persist prompt, output, credentials, or
    // full provider/engine transcript. The disposable worker is still removed.
    const diagnosticRoot = mkdtempSync('/private/tmp/rhythm-managed-engine-diagnostics-');
    const path = join(diagnosticRoot, 'receipt.json');
    const budget = await repository.getBudgetAsync(jobId).catch(() => null);
    const evidence = { schemaVersion: 1, jobId, recordedAt: new Date().toISOString(),
      originalHash: sha256(JSON.stringify(snapshot)), artifactDigest: digest,
      arms: observedArms.map(boundedArmDiagnostic),
      budget: budget ? { settledTokens: budget.settledTokens,
        outstandingTokens: budget.outstandingTokens,
        hasUnknownUsage: budget.hasUnknownUsage } : null };
    writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    if (error instanceof Error) error.message += `; structural evidence: ${path}`;
    throw error;
  } finally {
    await relay.closeDedicatedListener();
    db.close();
    if (priorArtifactRoot === undefined) delete process.env.RHYTHM_TOOL_ARTIFACT_ROOT;
    else process.env.RHYTHM_TOOL_ARTIFACT_ROOT = priorArtifactRoot;
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

describe.skipIf(!enabled)('managed tool private-engine original/candidate, gated', () => {
  it('joins signed engine calls, copied approval, offline Docker, taint, and a closed shared budget',
    runPair, 300_000);
});
