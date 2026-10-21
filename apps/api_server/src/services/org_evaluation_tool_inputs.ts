/** Trusted, bounded inputs for an evaluated managed-tool proposal. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { resolveManagedToolArtifactRoot } from '../config/env';
import { GUARDRAIL_NAMES } from '../models/guardrail_registry';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../models/proposal_evidence_bundle';
import type { OrgEvaluationDiagnosis } from './org_evaluation_coordinator';
import type { OrgEvaluationTargetSnapshot } from './org_evaluation_fixture';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { buildProfileRevisionFingerprint } from './org_proposal_experiment_service';
import { inspectImmutableLocalTarball, parseImmutableLocalTarballSource } from './tool_install_artifact';
import { isSafeToolName } from './tool_install_safety';
import { isToolTestScenarioId } from './tool_test_scenarios';

const DIGEST_NAME = /^([a-f0-9]{64})\.tgz$/;
const MAX_ARCHIVES = 16;
const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;

export interface OrgEvaluationToolArtifactDescriptor {
  toolName: string;
  packageSource: string;
  installMethod: 'local-tarball';
}

function guessPackageName(archive: Buffer): string | null {
  let tar: Buffer;
  try { tar = gunzipSync(archive, { maxOutputLength: MAX_EXPANDED_BYTES }); }
  catch { return null; }
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return null;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeField = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    if (!/^[0-7]+$/.test(sizeField)) return null;
    const size = Number.parseInt(sizeField, 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) return null;
    if (name === 'package/package.json') {
      try {
        const parsed = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString('utf8')) as { name?: unknown };
        return typeof parsed.name === 'string' && isSafeToolName(parsed.name) ? parsed.name : null;
      } catch { return null; }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

/** Only code-owned, digest-named, ordinary tarballs enter the reviewer context. */
export function listOrgEvaluationToolArtifacts(
  artifactRoot = resolveManagedToolArtifactRoot(),
): OrgEvaluationToolArtifactDescriptor[] {
  let root: string;
  try {
    if (!lstatSync(artifactRoot).isDirectory() || lstatSync(artifactRoot).isSymbolicLink()) return [];
    root = realpathSync(artifactRoot);
  } catch { return []; }
  const names = readdirSync(root).sort().filter((name) => DIGEST_NAME.test(name));
  if (names.length > MAX_ARCHIVES) throw new Error('Tool artifact catalog exceeds bounded review inventory');
  const descriptors: OrgEvaluationToolArtifactDescriptor[] = [];
  for (const name of names) {
    const path = join(root, name);
    const digest = DIGEST_NAME.exec(name)![1];
    let bytes: Buffer;
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARCHIVE_BYTES ||
          relative(root, realpathSync(path)) !== name) continue;
      bytes = readFileSync(path);
    } catch { continue; }
    if (createHash('sha256').update(bytes).digest('hex') !== digest) continue;
    const toolName = guessPackageName(bytes);
    if (!toolName || !inspectImmutableLocalTarball(root, digest, toolName)) continue;
    descriptors.push({ toolName, packageSource: `local-tarball:sha256:${digest}`, installMethod: 'local-tarball' });
  }
  return descriptors;
}

/** Replaces model-authored evidence with verified sessions and the frozen profile. */
export async function normalizeToolInstallDiagnosisAsync(input: {
  diagnosis: OrgEvaluationDiagnosis;
  snapshot: OrgEvaluationTargetSnapshot;
  ownerUserId: number | null;
  artifactRoot?: string;
  now?: string;
}): Promise<OrgEvaluationDiagnosis> {
  const { diagnosis, snapshot } = input;
  if (diagnosis.kind !== 'tool-install') return diagnosis;
  const change = diagnosis.change;
  const profile = snapshot.profiles[0];
  const control = snapshot.creationControl;
  const sessionIds = [...new Set(diagnosis.evidence.map((item) => item.sessionId))].sort();
  if (!profile || !control || control.baselineProfileId !== profile.id ||
      diagnosis.targetRef !== `agent_config:${profile.id}` ||
      JSON.stringify(sessionIds) !== JSON.stringify([...control.evidenceSessionIds].sort()) ||
      change.agentConfigId !== profile.id || typeof change.toolName !== 'string' ||
      typeof change.packageSource !== 'string' || change.installMethod !== 'local-tarball' ||
      !Array.isArray(change.testPrompts) || change.testPrompts.length < 2 || change.testPrompts.length > 3 ||
      !change.testPrompts.every(isToolTestScenarioId) ||
      new Set(change.testPrompts).size !== change.testPrompts.length) {
    throw new Error('Tool diagnosis lacks one verified baseline, artifact, or closed scenario set');
  }
  const digest = parseImmutableLocalTarballSource(change.packageSource);
  if (!digest || !inspectImmutableLocalTarball(input.artifactRoot ?? resolveManagedToolArtifactRoot(), digest, change.toolName))
    throw new Error('Tool diagnosis requires an available immutable local tarball');
  const allOutcomes = await new AgentRunOutcomesRepository().listByProfileAsync(profile.id);
  if (allOutcomes.length > 10_000) throw new Error('Tool counter-evidence history exceeds bounded scan');
  const sessions = new AgentSessionsRepository();
  const readable = allOutcomes.filter((outcome) => {
    const session = sessions.findById(outcome.rootSessionId);
    return !!session && (input.ownerUserId === null
      ? session.ownerUserId === null
      : session.ownerUserId === null || session.ownerUserId === input.ownerUserId);
  });
  const bundle = {
    version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
    sourceEvidence: { sessionIds, eventIds: readable.filter((item) => sessionIds.includes(item.rootSessionId)).map((item) => item.id) },
    counterEvidenceSearch: {
      query: `owner-readable same-profile outcome ledger:${profile.id}`,
      searchedAt: input.now ?? new Date().toISOString(),
      contradictingCount: readable.filter((item) => item.objectiveVerdict === 'success').length,
    },
    target: { ref: diagnosis.targetRef, hash: buildProfileRevisionFingerprint(profile) },
    expectedOutcome: 'The installed tool improves the independent task cases cited in this evaluation',
    primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
    guardrails: [...GUARDRAIL_NAMES], experimentAdapter: 'usage-count',
    rollbackRule: 'Remove the managed tool and restore the prior profile tool catalog',
    generatorVersion: 'org-evaluation-tool-evidence-v1',
    confidenceCalibrationVersion: 'independent-evaluation-v1',
  };
  return { ...diagnosis, change: { ...change, evidenceBundle: bundle } };
}

/** Alternatives may compare distinct supplied tarballs/scenarios, but may not
 * rewrite the frozen evidence, identity, or target to improve their score. */
export function normalizeToolInstallCandidateChange(input: {
  diagnosis: OrgEvaluationDiagnosis;
  change: Record<string, unknown>;
  snapshot: OrgEvaluationTargetSnapshot;
  artifactRoot?: string;
}): Record<string, unknown> {
  const { diagnosis, change, snapshot } = input;
  const original = diagnosis.change;
  const profileId = snapshot.creationControl?.baselineProfileId;
  const expected = ['toolName', 'packageSource', 'installMethod', 'agentConfigId', 'testPrompts', 'evidenceBundle'];
  if (diagnosis.kind !== 'tool-install' || !profileId ||
      diagnosis.targetRef !== `agent_config:${profileId}` ||
      Object.keys(change).some((key) => !expected.includes(key)) ||
      change.toolName !== original.toolName || change.agentConfigId !== profileId ||
      change.installMethod !== 'local-tarball' || typeof change.packageSource !== 'string' ||
      !Array.isArray(change.testPrompts) || change.testPrompts.length < 2 || change.testPrompts.length > 3 ||
      !change.testPrompts.every(isToolTestScenarioId) || new Set(change.testPrompts).size !== change.testPrompts.length ||
      !original.evidenceBundle || typeof original.evidenceBundle !== 'object') {
    throw new Error('Tool alternative changed identity, baseline, evidence, or closed scenarios');
  }
  const digest = parseImmutableLocalTarballSource(change.packageSource);
  if (!digest || !inspectImmutableLocalTarball(input.artifactRoot ?? resolveManagedToolArtifactRoot(), digest,
      change.toolName as string)) {
    throw new Error('Tool alternative requires an available immutable local tarball');
  }
  return { toolName: change.toolName, packageSource: change.packageSource,
    installMethod: 'local-tarball', agentConfigId: profileId,
    testPrompts: [...change.testPrompts], evidenceBundle: original.evidenceBundle };
}
