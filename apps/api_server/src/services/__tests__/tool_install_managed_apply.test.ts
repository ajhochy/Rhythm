import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { createAndVetToolInstallProposalAsync } from '../tool_install_proposal_lifecycle';
import { buildProfileRevisionFingerprint, toProfileTargetRef } from '../org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../../models/proposal_evidence_bundle';
import { GUARDRAIL_NAMES } from '../../models/guardrail_registry';
import { DockerSandboxRuntime, vetToolInSandboxAsync } from '../tool_sandbox_vetter';
import { buildToolInstallProposalFingerprint } from '../tool_install_safety_policy';
import { applyApprovedProposalAsync } from '../org_proposal_apply_service';
import { PostApplyEventsRepository } from '../../repositories/post_apply_events_repository';

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

function tarballWithEntries(entries: Array<[string, string]>): Buffer {
  return gzipSync(Buffer.concat([...entries.map(([name, body]) => tarEntry(name, body)), Buffer.alloc(1024)]));
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

  it.each(['tools', '.staging', '.locks'] as const)('fails closed when managed %s is a symlink', async (child) => {
    const { root, artifacts, managed, digest } = setup();
    mkdirSync(managed);
    const outside = join(root, `outside-${child.replace('.', '')}`);
    mkdirSync(outside);
    const sentinel = join(outside, 'sentinel');
    writeFileSync(sentinel, 'untouched');
    symlinkSync(outside, join(managed, child));
    let spawned = false;

    const result = await applyVettedToolInstallAsync(proposal(`local-tarball:sha256:${digest}`), undefined, {
      artifactRoot: artifacts, managedRoot: managed, skipSafetyRecheck: true,
      runner: async () => { spawned = true; },
    });

    expect(result.applied).toBe(false);
    expect(spawned).toBe(false);
    expect(readFileSync(sentinel, 'utf8')).toBe('untouched');
    expect(readdirSync(outside)).toEqual(['sentinel']);
  });

  it('refuses an exact destination symlink even when its outside receipt matches', async () => {
    const { root, artifacts, managed, digest, tarball } = setup();
    const first = proposal(`local-tarball:sha256:${digest}`);
    const fingerprint = buildToolInstallProposalFingerprint(first)!;
    const destination = `fixture-tool-${digest.slice(0, 16)}`;
    const outside = join(root, 'outside-destination');
    mkdirSync(join(outside, 'node_modules', 'fixture-tool'), { recursive: true });
    writeFileSync(join(outside, 'artifact.tgz'), tarball);
    writeFileSync(join(outside, 'node_modules', 'fixture-tool', 'package.json'), JSON.stringify({ name: 'fixture-tool' }));
    writeFileSync(join(outside, '.rhythm-managed-install.json'), JSON.stringify({
      version: 1, proposalId: first.id, proposalFingerprint: fingerprint, installMethod: 'local-tarball', artifactDigest: digest,
      managedRelativePath: join('tools', destination), status: 'active', installedAt: '', verifiedAt: '',
    }));
    writeFileSync(join(outside, 'sentinel'), 'untouched');
    mkdirSync(join(managed, 'tools'), { recursive: true });
    symlinkSync(outside, join(managed, 'tools', destination));

    const result = await applyVettedToolInstallAsync(first, undefined, {
      artifactRoot: artifacts, managedRoot: managed, skipSafetyRecheck: true,
    });

    expect(result.applied).toBe(false);
    expect(readFileSync(join(outside, 'sentinel'), 'utf8')).toBe('untouched');
  });

  it('rejects a source mutation after inspection before invoking npm', async () => {
    const { artifacts, managed, digest } = setup();
    let spawned = false;
    const result = await applyVettedToolInstallAsync(proposal(`local-tarball:sha256:${digest}`), undefined, {
      artifactRoot: artifacts, managedRoot: managed, skipSafetyRecheck: true,
      afterArtifactInspection: async () => writeFileSync(join(artifacts, `${digest}.tgz`), fixtureTarball('fixture-tool', { install: 'changed-after-inspection' })),
      runner: async () => { spawned = true; },
    });

    expect(result.applied).toBe(false);
    expect(spawned).toBe(false);
    expect(existsSync(join(managed, 'tools', `fixture-tool-${digest.slice(0, 16)}`))).toBe(false);
  });

  it.each([
    ['duplicate package.json', tarballWithEntries([
      ['package/package.json', JSON.stringify({ name: 'fixture-tool', version: '1.0.0' })],
      ['package/package.json', JSON.stringify({ name: 'fixture-tool', version: '1.0.0', dependencies: { bad: '1.0.0' } })],
    ])],
    ['packaged node_modules', tarballWithEntries([
      ['package/package.json', JSON.stringify({ name: 'fixture-tool', version: '1.0.0' })],
      ['package/node_modules/uninspected/index.js', 'module.exports = 1'],
    ])],
    ['bundleDependencies alias', tarballWithEntries([
      ['package/package.json', JSON.stringify({ name: 'fixture-tool', version: '1.0.0', bundleDependencies: ['uninspected'] })],
    ])],
  ])('refuses tarball ambiguity: %s before process spawn', async (_label, tarball) => {
    const root = mkdtempSync(join(tmpdir(), 'rhythm-managed-apply-ambiguous-'));
    const artifacts = join(root, 'artifacts');
    const managed = join(root, 'managed');
    mkdirSync(artifacts);
    const digest = createHash('sha256').update(tarball).digest('hex');
    writeFileSync(join(artifacts, `${digest}.tgz`), tarball);
    let spawned = false;

    const result = await applyVettedToolInstallAsync(proposal(`local-tarball:sha256:${digest}`), undefined, {
      artifactRoot: artifacts, managedRoot: managed, skipSafetyRecheck: true,
      runner: async () => { spawned = true; },
    });

    expect(inspectImmutableLocalTarball(artifacts, digest, 'fixture-tool')).toBeNull();
    expect(result.reason).toBe('tool_install_apply_immutable_artifact_refused');
    expect(spawned).toBe(false);
  });

  it('drives the managed immutable installer through shared approval and creates one D2 event', async () => {
    const { root, artifacts, managed, digest } = setup();
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
      const outcome = await applyApprovedProposalAsync({ proposal: created, decidedByUserId: 7 });
      expect(outcome.kind).toBe('applied');
      expect((await new PostApplyEventsRepository().findByProposalIdAsync(created.id))?.profileId).toBe(config.id);
      expect((db.prepare('SELECT COUNT(*) AS count FROM agent_org_post_apply_events WHERE proposal_id = ?').get(created.id) as { count: number }).count).toBe(1);
      expect(existsSync(join(managed, 'tools'))).toBe(true);
    } finally {
      if (priorArtifacts === undefined) delete process.env.RHYTHM_TOOL_ARTIFACT_ROOT; else process.env.RHYTHM_TOOL_ARTIFACT_ROOT = priorArtifacts;
      if (priorManaged === undefined) delete process.env.RHYTHM_MANAGED_TOOL_ROOT; else process.env.RHYTHM_MANAGED_TOOL_ROOT = priorManaged;
      rmSync(root, { recursive: true, force: true });
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
