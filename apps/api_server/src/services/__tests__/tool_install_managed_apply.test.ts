import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { applyVettedToolInstallAsync } from '../tool_install_apply';
import { inspectImmutableLocalTarball, parseImmutableLocalTarballSource } from '../tool_install_artifact';
import type { AgentOrgProposal } from '../../models/agent_org_proposal';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import Database from 'better-sqlite3';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { createAndVetToolInstallProposalAsync, approveVettedToolInstallProposalAsync } from '../tool_install_proposal_lifecycle';
import { buildProfileRevisionFingerprint, toProfileTargetRef } from '../org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../../models/proposal_evidence_bundle';
import { GUARDRAIL_NAMES } from '../../models/guardrail_registry';
import { DockerSandboxRuntime, vetToolInSandboxAsync } from '../tool_sandbox_vetter';

function tarEntry(name: string, body: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write('0000000', 100);
  header.write('0000000', 108);
  header.write('0000000', 116);
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257);
  header.fill(0x20, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

function fixtureTarball(name: string, scripts?: Record<string, string>): Buffer {
  return gzipSync(Buffer.concat([
    tarEntry('package/package.json', JSON.stringify({ name, version: '1.0.0', bin: { [name]: 'index.js' }, ...(scripts ? { scripts } : {}) })),
    tarEntry('package/index.js', '#!/usr/bin/env node\nconsole.log("fixture")\n'),
    Buffer.alloc(1024),
  ]));
}

function setup(name = 'fixture-tool', scripts?: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'rhythm-managed-apply-'));
  const artifacts = join(root, 'artifacts');
  const managed = join(root, 'managed');
  mkdirSync(artifacts);
  const tarball = fixtureTarball(name, scripts);
  const digest = createHash('sha256').update(tarball).digest('hex');
  writeFileSync(join(artifacts, `${digest}.tgz`), tarball);
  return { root, artifacts, managed, digest, tarball };
}

function proposal(source: string): AgentOrgProposal {
  return {
    id: 'managed-apply-proposal', auditRunId: null, kind: 'tool-install', risk: 'high', external: 0,
    status: 'approved', title: 'fixture', rationale: null, signalRef: null, targetRef: null,
    changeJson: JSON.stringify({ toolName: 'fixture-tool', packageSource: source, installMethod: 'local-tarball', testPrompts: ['version-check', 'help-check'] }),
    beforeSnapshotJson: null, provenanceJson: null, dedupKey: null, baselineScore: null, postScore: null,
    measureReason: null, decidedByUserId: 1, ownerUserId: null, diagnosisConfidence: null,
    diagnosisConfidenceVersion: null, createdAt: '', updatedAt: '',
  };
}

describe('D1 managed tool-install apply', () => {
  it('installs a safe approved immutable local artifact only beneath the managed root', async () => {
    const { artifacts, managed, digest } = setup();
    expect(inspectImmutableLocalTarball(artifacts, digest, 'fixture-tool')).not.toBeNull();
    expect(parseImmutableLocalTarballSource(`local-tarball:sha256:${digest}`)).toBe(digest);

    const result = await applyVettedToolInstallAsync(proposal(`local-tarball:sha256:${digest}`), undefined, {
      artifactRoot: artifacts, managedRoot: managed, skipSafetyRecheck: true,
    });

    expect(result).toEqual({ applied: true, reason: null });
  });

  it('refuses a digest mismatch before staging or process spawn', async () => {
    const { artifacts, managed, digest } = setup();
    writeFileSync(join(artifacts, `${digest}.tgz`), 'changed');
    let spawned = false;
    const result = await applyVettedToolInstallAsync(proposal(`local-tarball:sha256:${digest}`), undefined, {
      artifactRoot: artifacts, managedRoot: managed, skipSafetyRecheck: true,
      runner: async () => { spawned = true; },
    });
    expect(result.reason).toBe('tool_install_apply_immutable_artifact_refused');
    expect(spawned).toBe(false);
    expect(existsSync(managed)).toBe(false);
  });

  it('refuses mutable registry sources and package lifecycle scripts', async () => {
    const mutable = setup();
    expect((await applyVettedToolInstallAsync(proposal('npm:fixture-tool'), undefined, {
      artifactRoot: mutable.artifacts, managedRoot: mutable.managed, skipSafetyRecheck: true,
    })).reason).toBe('tool_install_apply_immutable_artifact_refused');
    const scripted = setup('fixture-tool', { install: 'touch owned-by-script' });
    expect((await applyVettedToolInstallAsync(proposal(`local-tarball:sha256:${scripted.digest}`), undefined, {
      artifactRoot: scripted.artifacts, managedRoot: scripted.managed, skipSafetyRecheck: true,
    })).reason).toBe('tool_install_apply_immutable_artifact_refused');
    expect(existsSync(join(scripted.root, 'owned-by-script'))).toBe(false);
  });

  it('is receipt-idempotent, but refuses another proposal at the same destination', async () => {
    const { artifacts, managed, digest } = setup();
    const first = proposal(`local-tarball:sha256:${digest}`);
    expect((await applyVettedToolInstallAsync(first, undefined, { artifactRoot: artifacts, managedRoot: managed, skipSafetyRecheck: true })).applied).toBe(true);
    expect((await applyVettedToolInstallAsync(first, undefined, { artifactRoot: artifacts, managedRoot: managed, skipSafetyRecheck: true })).applied).toBe(true);
    const conflict = { ...first, id: 'other-proposal' };
    expect((await applyVettedToolInstallAsync(conflict, undefined, { artifactRoot: artifacts, managedRoot: managed, skipSafetyRecheck: true })).reason).toBe('tool_install_apply_conflict');
  });

  it('cleans its exact staging directory after runner failure', async () => {
    const { artifacts, managed, digest } = setup();
    const result = await applyVettedToolInstallAsync(proposal(`local-tarball:sha256:${digest}`), undefined, {
      artifactRoot: artifacts, managedRoot: managed, skipSafetyRecheck: true,
      runner: async () => { throw new Error('fixture runner failure'); },
    });
    expect(result.reason).toBe('tool_install_apply_failed');
    expect(existsSync(join(managed, 'tools')) ? readdirSync(join(managed, 'tools')) : []).toEqual([]);
    expect(existsSync(join(managed, '.staging')) ? readdirSync(join(managed, '.staging')) : []).toEqual([]);
  });

  it('refuses a symlinked artifact path outside its code-owned root', async () => {
    const { root, artifacts, managed, digest } = setup();
    const outside = join(root, 'outside.tgz');
    writeFileSync(outside, fixtureTarball('fixture-tool'));
    writeFileSync(join(artifacts, `${digest}.tgz`), 'replace');
    // Replace only the test-owned artifact leaf; the source digest itself is never a path input.
    require('node:fs').rmSync(join(artifacts, `${digest}.tgz`));
    symlinkSync(outside, join(artifacts, `${digest}.tgz`));
    expect((await applyVettedToolInstallAsync(proposal(`local-tarball:sha256:${digest}`), undefined, {
      artifactRoot: artifacts, managedRoot: managed, skipSafetyRecheck: true,
    })).reason).toBe('tool_install_apply_immutable_artifact_refused');
  });

  it('drives the durable approved lifecycle to an actual receipt-verified applied installation', async () => {
    const { artifacts, managed, digest } = setup();
    const priorArtifacts = process.env.RHYTHM_TOOL_ARTIFACT_ROOT;
    const priorManaged = process.env.RHYTHM_MANAGED_TOOL_ROOT;
    process.env.RHYTHM_TOOL_ARTIFACT_ROOT = artifacts;
    process.env.RHYTHM_MANAGED_TOOL_ROOT = managed;
    try {
      const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db); setDb(db);
      const config = new AgentConfigsRepository().insert({ label: 'managed fixture', icon: 'shield' });
      const evidenceBundle = {
        version: PROPOSAL_EVIDENCE_BUNDLE_VERSION, sourceEvidence: { sessionIds: ['fixture'], eventIds: [] },
        counterEvidenceSearch: { query: 'fixture', searchedAt: '2026-08-21T00:00:00.000Z', contradictingCount: 0 },
        target: { ref: toProfileTargetRef(config.id), hash: buildProfileRevisionFingerprint(config) },
        expectedOutcome: 'fixture', primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
        guardrails: [...GUARDRAIL_NAMES], experimentAdapter: 'usage-count', rollbackRule: 'revoke', generatorVersion: 'fixture', confidenceCalibrationVersion: 'uncalibrated',
      };
      const created = await createAndVetToolInstallProposalAsync({ title: 'install fixture', change: {
        toolName: 'fixture-tool', packageSource: `local-tarball:sha256:${digest}`, installMethod: 'local-tarball',
        agentConfigId: config.id, testPrompts: ['version-check', 'help-check'], evidenceBundle,
      } }, { vet: async () => ({ verdict: 'safe', reason: null, sandboxDurationMs: 1, testPromptsRunCount: 2, forbiddenPathViolationsJson: '[]', networkCallsObservedJson: '[]', fileSystemWritesObservedJson: '[]', credentialAccessAttemptsCount: 0, evidenceJson: '{}' }) });
      expect(created.status).toBe('sandbox-vetted');
      const applied = await approveVettedToolInstallProposalAsync(created.id, 7, false);
      expect(applied.status).toBe('applied');
      expect(existsSync(join(managed, 'tools'))).toBe(true);
    } finally {
      if (priorArtifacts === undefined) delete process.env.RHYTHM_TOOL_ARTIFACT_ROOT; else process.env.RHYTHM_TOOL_ARTIFACT_ROOT = priorArtifacts;
      if (priorManaged === undefined) delete process.env.RHYTHM_MANAGED_TOOL_ROOT; else process.env.RHYTHM_MANAGED_TOOL_ROOT = priorManaged;
    }
  });

  const dockerIt = process.env.RHYTHM_DOCKER_E2E === '1' ? it : it.skip;
  dockerIt('vets the same immutable local tarball in real Docker without network access', async () => {
    const { root, artifacts, digest } = setup();
    const outcome = await vetToolInSandboxAsync({
      candidate: { toolName: 'fixture-tool', packageSource: `local-tarball:sha256:${digest}`, installMethod: 'local-tarball' },
      scenarioIds: ['version-check', 'help-check'],
    }, { runtime: new DockerSandboxRuntime({ artifactRoot: artifacts, scratchRoot: root }) });
    expect(outcome.reason).toBeNull();
    expect(outcome.verdict).toBe('safe');
  }, 90_000);
});
