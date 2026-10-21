import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import type { OrgEvaluationDiagnosis } from '../org_evaluation_coordinator';
import type { OrgEvaluationTargetSnapshot } from '../org_evaluation_fixture';
import { buildProfileRevisionFingerprint } from '../org_proposal_experiment_service';
import { listOrgEvaluationToolArtifacts, normalizeToolInstallCandidateChange,
  normalizeToolInstallDiagnosisAsync } from '../org_evaluation_tool_inputs';

function entry(name: string, body: string): Buffer {
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
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

let root: string;
let artifacts: string;
let db: Database.Database;
let previous: Database.Database | null;
let source: string;
beforeEach(() => {
  root = mkdtempSync('/private/tmp/rhythm-eval-tool-inputs-');
  artifacts = join(root, 'artifacts');
  mkdirSync(artifacts);
  const archive = gzipSync(Buffer.concat([
    entry('package/package.json', JSON.stringify({ name: 'fixture-tool', version: '1.0.0', bin: { 'fixture-tool': 'index.js' } })),
    entry('package/index.js', '#!/usr/bin/env node\nconsole.log("fixture")\n'),
    Buffer.alloc(1024),
  ]));
  const digest = createHash('sha256').update(archive).digest('hex');
  writeFileSync(join(artifacts, `${digest}.tgz`), archive);
  source = `local-tarball:sha256:${digest}`;
  db = new Database(':memory:');
  runMigrations(db);
  previous = setDb(db);
});
afterEach(() => {
  setDb(previous);
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function snapshot(): OrgEvaluationTargetSnapshot {
  return {
    schemaVersion: 1, effectiveModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5', source: 'profile' },
    kind: 'tool-install', targetRef: 'agent_config:baseline', targetRevision: 'absent',
    profiles: [{ id: 'baseline', label: 'Baseline', systemPrompt: 'Original', revision: 4,
      allowedMcpsJson: '[]', allowedSkillsJson: '[]', corePermissionsJson: '{}',
      allowedDelegatesJson: '[]', isManager: false, modelProvider: 'anthropic', modelId: 'claude-sonnet-4-5' }],
    skills: [], schedules: [], recipes: [], managedSkillFiles: [],
    creationControl: { targetName: 'fixture-tool', absenceKind: 'managed-tool', baselineProfileId: 'baseline',
      evidenceSessionIds: ['s1', 's2'], catalogFingerprint: 'frozen', dependencyFingerprints: {} },
  };
}

function diagnosis(): OrgEvaluationDiagnosis {
  return {
    kind: 'tool-install', targetRef: 'agent_config:baseline', targetRevision: 'absent',
    title: 'Install fixture tool', rationale: 'Two tasks need a command',
    evidence: [{ sessionId: 's1', messageId: 'm1', quote: 'Command missing' },
      { sessionId: 's2', messageId: 'm2', quote: 'Command missing' }],
    change: { toolName: 'fixture-tool', agentConfigId: 'baseline', packageSource: source,
      installMethod: 'local-tarball', testPrompts: ['version-check', 'help-check'],
      evidenceBundle: { invented: 'model-authored' } },
    cases: [{ key: 'a', prompt: 'Do A', outputIncludes: ['A'], outputExcludes: [] },
      { key: 'b', prompt: 'Do B', outputIncludes: ['B'], outputExcludes: [] }],
  };
}

describe('trusted tool inputs for bounded reviewer', () => {
  it('lists only validated digest-named ordinary tarballs', () => {
    expect(listOrgEvaluationToolArtifacts(artifacts)).toEqual([{
      toolName: 'fixture-tool', packageSource: source, installMethod: 'local-tarball',
    }]);
    writeFileSync(join(artifacts, `${'0'.repeat(64)}.tgz`), 'untrusted');
    symlinkSync(join(artifacts, source.slice(-64) + '.tgz'), join(artifacts, `${'1'.repeat(64)}.tgz`));
    expect(listOrgEvaluationToolArtifacts(artifacts)).toHaveLength(1);
  });

  it('replaces invented model evidence with frozen sessions and exact profile fingerprint', async () => {
    const normalized = await normalizeToolInstallDiagnosisAsync({ diagnosis: diagnosis(), snapshot: snapshot(),
      ownerUserId: 7, artifactRoot: artifacts, now: '2026-10-21T00:00:00.000Z' });
    const bundle = normalized.change.evidenceBundle as Record<string, unknown>;
    expect(bundle.sourceEvidence).toEqual({ sessionIds: ['s1', 's2'], eventIds: [] });
    expect(bundle.target).toEqual({ ref: 'agent_config:baseline',
      hash: buildProfileRevisionFingerprint(snapshot().profiles[0]) });
    expect(bundle.counterEvidenceSearch).toMatchObject({ contradictingCount: 0,
      searchedAt: '2026-10-21T00:00:00.000Z' });
    expect(JSON.stringify(bundle)).not.toContain('model-authored');
  });

  it('fails closed when the cited sessions or pinned artifact differ from frozen source', async () => {
    const wrongSession = diagnosis();
    wrongSession.evidence[1].sessionId = 'fabricated';
    await expect(normalizeToolInstallDiagnosisAsync({ diagnosis: wrongSession, snapshot: snapshot(),
      ownerUserId: 7, artifactRoot: artifacts })).rejects.toThrow(/verified baseline/);
    const missingArtifact = diagnosis();
    missingArtifact.change.packageSource = `local-tarball:sha256:${'0'.repeat(64)}`;
    await expect(normalizeToolInstallDiagnosisAsync({ diagnosis: missingArtifact, snapshot: snapshot(),
      ownerUserId: 7, artifactRoot: artifacts })).rejects.toThrow(/immutable local tarball/);
  });

  it('lets alternatives vary only an available package and closed scenarios while inheriting exact evidence', async () => {
    const original = await normalizeToolInstallDiagnosisAsync({ diagnosis: diagnosis(), snapshot: snapshot(),
      ownerUserId: 7, artifactRoot: artifacts });
    const variant = normalizeToolInstallCandidateChange({ diagnosis: original, snapshot: snapshot(), artifactRoot: artifacts,
      change: { toolName: 'fixture-tool', agentConfigId: 'baseline', packageSource: source,
        installMethod: 'local-tarball', testPrompts: ['help-check', 'stdin-noop'],
        evidenceBundle: { model: 'invented' } } });
    expect(variant.testPrompts).toEqual(['help-check', 'stdin-noop']);
    expect(variant.evidenceBundle).toBe(original.change.evidenceBundle);
    expect(JSON.stringify(variant)).not.toContain('invented');
    expect(() => normalizeToolInstallCandidateChange({ diagnosis: original, snapshot: snapshot(), artifactRoot: artifacts,
      change: { ...variant, toolName: 'other-tool' } })).toThrow(/changed identity/);
    expect(() => normalizeToolInstallCandidateChange({ diagnosis: original, snapshot: snapshot(), artifactRoot: artifacts,
      change: { ...variant, packageSource: `local-tarball:sha256:${'0'.repeat(64)}` } })).toThrow(/immutable local tarball/);
  });
});
