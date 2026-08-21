/** D4.5 (#1443) — real production-default auto-promotion across all supported kinds. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../../models/proposal_evidence_bundle';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { PostApplyEventsRepository } from '../../repositories/post_apply_events_repository';
import { PromotionTrustStateRepository } from '../../repositories/promotion_trust_state_repository';
import { ToolSafetyReportsRepository } from '../../repositories/tool_safety_reports_repository';
import { isAutoPromotionFeatureAvailable } from '../../config/env';
import { attemptAutoPromotionAsync } from '../auto_promotion_gate';
import { registerAllProposalAppliers } from '../org_proposal_appliers_wiring';
import { resetProposalPluginsForTests } from '../org_proposal_apply_service';
import { buildProfileRevisionFingerprint, toProfileTargetRef } from '../org_proposal_experiment_service';
import { createAndVetToolInstallProposalAsync } from '../tool_install_proposal_lifecycle';

let db: Database.Database;
let configs: AgentConfigsRepository;
let proposals: AgentOrgProposalsRepository;
let trust: PromotionTrustStateRepository;
let events: PostApplyEventsRepository;
let priorFeatureFlag: string | undefined;
let priorDbClient: string | undefined;

interface NegativeTrustState {
  feature?: string;
  dbClient?: string;
  eligible?: boolean;
  enabled?: boolean;
  regressions?: number;
}

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

function immutableToolTarball(name: string): Buffer {
  return gzipSync(Buffer.concat([
    tarEntry('package/package.json', JSON.stringify({ name, version: '1.0.0', bin: { [name]: 'index.js' } })),
    tarEntry('package/index.js', '#!/usr/bin/env node\nconsole.log("D4.5 fixture")\n'),
    Buffer.alloc(1024),
  ]));
}

async function enableDurableTrust(): Promise<void> {
  await trust.recordEligibilityAsync({ totalVerified: 10, totalRegressions: 0, autoPromotionEligible: true });
  const enabled = await trust.enableAutoPromotionAsync('2026-08-21T00:00:00.000Z');
  expect(enabled).toMatchObject({ autoPromotionEligible: true, autoPromotionEnabled: true, totalRegressions: 0 });
}

async function markVerified(id: string): Promise<void> {
  const proposal = await proposals.findByIdAsync(id);
  expect(proposal).not.toBeNull();
  const verified = await proposals.setOutcomeStatusAtRevisionAsync({
    proposalId: id,
    expectedRevision: proposal!.revision,
    outcomeStatus: 'verified',
  });
  expect(verified?.outcomeStatus).toBe('verified');
}

async function assertSingleMonitor(input: {
  proposalId: string;
  profileId: string;
  changeType: 'prompt' | 'tool' | 'scope';
}): Promise<void> {
  const event = await events.findByProposalIdAsync(input.proposalId);
  expect(event).toMatchObject({ profileId: input.profileId, changeType: input.changeType, guardrailStatus: 'monitoring' });
  expect(
    db.prepare('SELECT COUNT(*) AS count FROM agent_org_post_apply_events WHERE proposal_id = ?').get(input.proposalId),
  ).toEqual({ count: 1 });
}

async function assertIdempotent(input: {
  proposalId: string;
  state: () => unknown;
}): Promise<void> {
  const before = input.state();
  const result = await attemptAutoPromotionAsync(input.proposalId);
  expect(result.status).toBe('already-applied');
  expect(input.state()).toEqual(before);
  expect(
    db.prepare('SELECT COUNT(*) AS count FROM agent_org_post_apply_events WHERE proposal_id = ?').get(input.proposalId),
  ).toEqual({ count: 1 });
}

beforeEach(() => {
  priorFeatureFlag = process.env.AUTO_PROMOTION_FEATURE_AVAILABLE;
  priorDbClient = process.env.DB_CLIENT;
  process.env.AUTO_PROMOTION_FEATURE_AVAILABLE = 'true';
  process.env.DB_CLIENT = 'sqlite';
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  resetProposalPluginsForTests();
  registerAllProposalAppliers();
  configs = new AgentConfigsRepository();
  proposals = new AgentOrgProposalsRepository(db);
  trust = new PromotionTrustStateRepository(db);
  events = new PostApplyEventsRepository(db);
});

afterEach(() => {
  db.close();
  if (priorFeatureFlag === undefined) delete process.env.AUTO_PROMOTION_FEATURE_AVAILABLE;
  else process.env.AUTO_PROMOTION_FEATURE_AVAILABLE = priorFeatureFlag;
  if (priorDbClient === undefined) delete process.env.DB_CLIENT;
  else process.env.DB_CLIENT = priorDbClient;
});

describe('D4.5 all change types use the production-default gate', () => {
  it('auto-applies a verified system-prompt refinement and arms exactly one D2 prompt monitor', async () => {
    configs.insert({ id: 'prompt-profile', label: 'Prompt', icon: 'spark', systemPrompt: 'before prompt' });
    await enableDurableTrust();
    expect(isAutoPromotionFeatureAvailable()).toBe(true);
    const created = await proposals.createAsync({
      id: 'prompt-refinement', kind: 'refine-config', risk: 'high', status: 'proposed', title: 'Refine system prompt',
      targetRef: 'agent_config:prompt-profile',
      changeJson: JSON.stringify({ configPatch: { agentConfigId: 'prompt-profile', field: 'system_prompt', value: 'after prompt' } }),
    });
    await markVerified(created.id);

    expect(await attemptAutoPromotionAsync(created.id)).toEqual({ status: 'applied' });
    expect(configs.getById('prompt-profile')).toMatchObject({ systemPrompt: 'after prompt' });
    expect(await proposals.findByIdAsync(created.id)).toMatchObject({ status: 'measuring', outcomeStatus: 'verified' });
    await assertSingleMonitor({ proposalId: created.id, profileId: 'prompt-profile', changeType: 'prompt' });
    await assertIdempotent({ proposalId: created.id, state: () => configs.getById('prompt-profile')?.systemPrompt });
  });

  it('auto-applies a D1 SAFE immutable local-tarball tool install and arms exactly one D2 tool monitor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rhythm-d4-1443-tool-'));
    const artifacts = join(root, 'artifacts');
    const managed = join(root, 'managed');
    mkdirSync(artifacts);
    const tarball = immutableToolTarball('d45-tool');
    const digest = createHash('sha256').update(tarball).digest('hex');
    writeFileSync(join(artifacts, `${digest}.tgz`), tarball);
    const priorArtifacts = process.env.RHYTHM_TOOL_ARTIFACT_ROOT;
    const priorManaged = process.env.RHYTHM_MANAGED_TOOL_ROOT;
    process.env.RHYTHM_TOOL_ARTIFACT_ROOT = artifacts;
    process.env.RHYTHM_MANAGED_TOOL_ROOT = managed;
    try {
      const profile = configs.insert({ id: 'tool-profile', label: 'Tool', icon: 'wrench' });
      await enableDurableTrust();
      const created = await createAndVetToolInstallProposalAsync({
        title: 'Install D4.5 tool',
        change: {
          toolName: 'd45-tool', packageSource: `local-tarball:sha256:${digest}`, installMethod: 'local-tarball',
          agentConfigId: profile.id, testPrompts: ['version-check', 'help-check'],
          evidenceBundle: {
            version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
            sourceEvidence: { sessionIds: ['d45'], eventIds: [] },
            counterEvidenceSearch: { query: 'd45', searchedAt: '2026-08-21T00:00:00.000Z', contradictingCount: 0 },
            target: { ref: toProfileTargetRef(profile.id), hash: buildProfileRevisionFingerprint(profile) },
            expectedOutcome: 'managed tool installed', primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
            guardrails: ['terminal-error-rate'], experimentAdapter: 'paired-cohort-outcome', rollbackRule: 'restore',
            generatorVersion: 'd45', confidenceCalibrationVersion: 'd45',
          },
        },
      }, {
        vet: async () => ({
          verdict: 'safe', reason: null, sandboxDurationMs: 1, testPromptsRunCount: 2,
          forbiddenPathViolationsJson: '[]', networkCallsObservedJson: '[]', fileSystemWritesObservedJson: '[]',
          credentialAccessAttemptsCount: 0, evidenceJson: '{}',
        }),
      });
      expect(created.status).toBe('sandbox-vetted');
      await markVerified(created.id);

      expect(await attemptAutoPromotionAsync(created.id)).toEqual({ status: 'applied' });
      const destination = join(managed, 'tools', `d45-tool-${digest.slice(0, 16)}`);
      expect(existsSync(join(destination, '.rhythm-managed-install.json'))).toBe(true);
      expect(await proposals.findByIdAsync(created.id)).toMatchObject({ status: 'measuring', outcomeStatus: 'verified' });
      await assertSingleMonitor({ proposalId: created.id, profileId: profile.id, changeType: 'tool' });
      await assertIdempotent({ proposalId: created.id, state: () => readdirSync(join(managed, 'tools')).sort() });
    } finally {
      if (priorArtifacts === undefined) delete process.env.RHYTHM_TOOL_ARTIFACT_ROOT;
      else process.env.RHYTHM_TOOL_ARTIFACT_ROOT = priorArtifacts;
      if (priorManaged === undefined) delete process.env.RHYTHM_MANAGED_TOOL_ROOT;
      else process.env.RHYTHM_MANAGED_TOOL_ROOT = priorManaged;
      rmSync(root, { recursive: true, force: true });
      expect(existsSync(root)).toBe(false);
    }
  });

  it('auto-applies a verified tool removal through the real config validator/applier and arms a D2 tool monitor', async () => {
    configs.insert({
      id: 'tool-remove-profile', label: 'Tool remove', icon: 'minus', allowedDelegatesJson: JSON.stringify(['legacy-tool', 'keep-tool']),
    });
    await enableDurableTrust();
    const created = await proposals.createAsync({
      id: 'tool-remove', kind: 'refine-config', risk: 'high', status: 'proposed', title: 'Remove legacy tool',
      targetRef: 'agent_config:tool-remove-profile',
      changeJson: JSON.stringify({ configPatch: { agentConfigId: 'tool-remove-profile', field: 'allowedDelegatesJson', value: JSON.stringify(['keep-tool']) } }),
    });
    await markVerified(created.id);

    expect(await attemptAutoPromotionAsync(created.id)).toEqual({ status: 'applied' });
    expect(configs.getById('tool-remove-profile')?.allowedDelegatesJson).toBe(JSON.stringify(['keep-tool']));
    expect(await proposals.findByIdAsync(created.id)).toMatchObject({ status: 'measuring', outcomeStatus: 'verified' });
    await assertSingleMonitor({ proposalId: created.id, profileId: 'tool-remove-profile', changeType: 'tool' });
    await assertIdempotent({ proposalId: created.id, state: () => configs.getById('tool-remove-profile')?.allowedDelegatesJson });
  });

  it('auto-applies a verified scope tightening through the atomic scope lifecycle and arms a D2 scope monitor', async () => {
    configs.insert({
      id: 'scope-profile', label: 'Scope', icon: 'shield', allowedMcpsJson: JSON.stringify(['obsolete-mcp', 'keep-mcp']),
    });
    await enableDurableTrust();
    const created = await proposals.createAsync({
      id: 'scope-tighten', kind: 'tighten-scope', risk: 'high', status: 'proposed', title: 'Remove obsolete MCP scope',
      targetRef: 'agent_config:scope-profile',
      changeJson: JSON.stringify({ agentConfigId: 'scope-profile', field: 'allowedMcpsJson', remove: ['obsolete-mcp'] }),
    });
    await markVerified(created.id);

    expect(await attemptAutoPromotionAsync(created.id)).toEqual({ status: 'applied' });
    expect(configs.getById('scope-profile')?.allowedMcpsJson).toBe(JSON.stringify(['keep-mcp']));
    expect(await proposals.findByIdAsync(created.id)).toMatchObject({ status: 'measuring', outcomeStatus: 'verified' });
    await assertSingleMonitor({ proposalId: created.id, profileId: 'scope-profile', changeType: 'scope' });
    await assertIdempotent({ proposalId: created.id, state: () => configs.getById('scope-profile')?.allowedMcpsJson });
  });

  const negativeTrustStates: ReadonlyArray<readonly [string, NegativeTrustState]> = [
    ['feature unavailable', { feature: 'false' }],
    ['Postgres D2 runtime', { dbClient: 'postgres' }],
    ['ineligible trust', { eligible: false }],
    ['disabled trust', { enabled: false }],
    ['regressed trust', { regressions: 1 }],
  ];

  it.each(negativeTrustStates)('fails closed without mutation when %s', async (_name, state) => {
    configs.insert({ id: `negative-${_name}`, label: 'Negative', icon: 'x', systemPrompt: 'before' });
    await trust.recordEligibilityAsync({
      totalVerified: 10,
      totalRegressions: state.regressions ?? 0,
      autoPromotionEligible: state.eligible ?? true,
    });
    if (state.enabled ?? true) await trust.enableAutoPromotionAsync('2026-08-21T00:00:00.000Z');
    if (state.feature) process.env.AUTO_PROMOTION_FEATURE_AVAILABLE = state.feature;
    if (state.dbClient) process.env.DB_CLIENT = state.dbClient;
    const created = await proposals.createAsync({
      id: `negative-${_name}`, kind: 'refine-config', risk: 'high', status: 'proposed', title: 'Must not apply',
      changeJson: JSON.stringify({ configPatch: { agentConfigId: `negative-${_name}`, field: 'system_prompt', value: 'after' } }),
    });
    await markVerified(created.id);

    await attemptAutoPromotionAsync(created.id);

    expect(configs.getById(`negative-${_name}`)?.systemPrompt).toBe('before');
    expect(await proposals.findByIdAsync(created.id)).toMatchObject({ status: 'proposed', outcomeStatus: 'verified' });
    expect(await events.findByProposalIdAsync(created.id)).toBeNull();
  });

  it.each([
    ['conditional', 'conditional', undefined],
    ['unsafe', 'unsafe', undefined],
    ['stale fingerprint', 'safe', 'stale-fingerprint'],
    ['malformed report', 'safe', undefined],
  ] as const)('fails closed without tool installation for a %s D1 report', async (_name, verdict, staleFingerprint) => {
    const root = mkdtempSync(join(tmpdir(), 'rhythm-d4-1443-negative-tool-'));
    const artifacts = join(root, 'artifacts');
    const managed = join(root, 'managed');
    mkdirSync(artifacts);
    const tarball = immutableToolTarball('d45-negative-tool');
    const digest = createHash('sha256').update(tarball).digest('hex');
    writeFileSync(join(artifacts, `${digest}.tgz`), tarball);
    const priorArtifacts = process.env.RHYTHM_TOOL_ARTIFACT_ROOT;
    const priorManaged = process.env.RHYTHM_MANAGED_TOOL_ROOT;
    process.env.RHYTHM_TOOL_ARTIFACT_ROOT = artifacts;
    process.env.RHYTHM_MANAGED_TOOL_ROOT = managed;
    try {
      const profile = configs.insert({ id: `negative-tool-${_name}`, label: 'Negative tool', icon: 'x' });
      await enableDurableTrust();
      const created = await createAndVetToolInstallProposalAsync({
        title: 'Negative tool install',
        change: {
          toolName: 'd45-negative-tool', packageSource: `local-tarball:sha256:${digest}`, installMethod: 'local-tarball',
          agentConfigId: profile.id, testPrompts: ['version-check', 'help-check'],
          evidenceBundle: {
            version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
            sourceEvidence: { sessionIds: ['d45-negative'], eventIds: [] },
            counterEvidenceSearch: { query: 'd45-negative', searchedAt: '2026-08-21T00:00:00.000Z', contradictingCount: 0 },
            target: { ref: toProfileTargetRef(profile.id), hash: buildProfileRevisionFingerprint(profile) },
            expectedOutcome: 'must not install', primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
            guardrails: ['terminal-error-rate'], experimentAdapter: 'paired-cohort-outcome', rollbackRule: 'restore', generatorVersion: 'd45', confidenceCalibrationVersion: 'd45',
          },
        },
      }, { vet: async () => ({ verdict: 'safe', reason: null, sandboxDurationMs: 1, testPromptsRunCount: 2, forbiddenPathViolationsJson: '[]', networkCallsObservedJson: '[]', fileSystemWritesObservedJson: '[]', credentialAccessAttemptsCount: 0, evidenceJson: '{}' }) });
      const report = await new ToolSafetyReportsRepository(db).findByProposalIdAsync(created.id);
      expect(report).not.toBeNull();
      db.prepare(
        `UPDATE tool_safety_reports
            SET verdict = ?, proposal_fingerprint = ?, test_prompts_run_count = ?
          WHERE proposal_id = ?`,
      ).run(verdict, staleFingerprint ?? report!.proposalFingerprint, _name === 'malformed report' ? 1 : 2, created.id);
      await markVerified(created.id);

      expect(await attemptAutoPromotionAsync(created.id)).toEqual({ status: 'tool-safety-blocked' });
      expect(await proposals.findByIdAsync(created.id)).toMatchObject({ status: 'sandbox-vetted', outcomeStatus: 'verified' });
      expect(existsSync(managed)).toBe(false);
      expect(await events.findByProposalIdAsync(created.id)).toBeNull();
    } finally {
      if (priorArtifacts === undefined) delete process.env.RHYTHM_TOOL_ARTIFACT_ROOT;
      else process.env.RHYTHM_TOOL_ARTIFACT_ROOT = priorArtifacts;
      if (priorManaged === undefined) delete process.env.RHYTHM_MANAGED_TOOL_ROOT;
      else process.env.RHYTHM_MANAGED_TOOL_ROOT = priorManaged;
      rmSync(root, { recursive: true, force: true });
      expect(existsSync(root)).toBe(false);
    }
  });

  it.each([
    ['malformed scope payload', 'tighten-scope', '{'],
    ['stale scope CAS/value', 'tighten-scope', JSON.stringify({ agentConfigId: 'negative-scope', field: 'allowedMcpsJson', remove: ['already-removed'] })],
    ['unsupported kind', 'unknown-d4-kind', JSON.stringify({ agentConfigId: 'negative-scope' })],
  ] as const)('fails closed without mutation for %s', async (_name, kind, changeJson) => {
    configs.insert({ id: 'negative-scope', label: 'Negative scope', icon: 'x', allowedMcpsJson: JSON.stringify(['keep-mcp']) });
    await enableDurableTrust();
    const created = await proposals.createAsync({ id: `negative-${kind}-${_name}`, kind, risk: 'high', status: 'proposed', title: 'Must not apply', changeJson });
    await markVerified(created.id);

    const result = await attemptAutoPromotionAsync(created.id);

    expect(result.status).toBe(kind === 'unknown-d4-kind' ? 'conflict' : 'conflict');
    expect(configs.getById('negative-scope')?.allowedMcpsJson).toBe(JSON.stringify(['keep-mcp']));
    expect(await proposals.findByIdAsync(created.id)).toMatchObject({ status: 'proposed', outcomeStatus: 'verified' });
    expect(await events.findByProposalIdAsync(created.id)).toBeNull();
  });
});
