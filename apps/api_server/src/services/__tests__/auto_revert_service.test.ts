/**
 * D2.4 (#1434) — auto-revert with alert after failed repairs.
 *
 * CONTRACT TEST — must fail before implementation (module does not exist
 * yet), then pass once `../auto_revert_service` exists. See
 * docs/ai/contracts/issue-1434.json for the criterion mapping.
 *
 * Covers:
 *  - issue-1434-c1: all 3 repairs fail -> auto-revert -> profile restored to
 *    its pre-change state -> `reverted` recorded.
 *  - issue-1434-c2: CAS revert fails (the original proposal drifted away
 *    from `applied` during the repair loop) -> `revert_failed` recorded with
 *    conflict details, and the live profile is left untouched.
 *  - issue-1434-c3: the alert carries the full trail (original change, all 3
 *    repair attempts, revert outcome).
 *  - issue-1434-c4: no raw secrets in the alert payload.
 *  - issue-1434-c5 (sharp-edge pin): `AgentOrgProposal.beforeSnapshotJson`
 *    (the value-bearing snapshot this service restores from) is NEVER routed
 *    through `redactSecrets` — restoring a secret-shaped priorValue must
 *    reproduce it byte-exact, not a "[redacted]" placeholder. This pins the
 *    finding that `PostApplyEvent.preChangeSnapshotJson` (which IS redacted
 *    at write time) is deliberately NOT the restoration source.
 *  - issue-1434-c6 (security fix pin): a whole-field revert of a
 *    legacy-scope field (`allowedMcpsJson` / `allowedSkillsJson` /
 *    `corePermissionsJson`) is refused even after all 3 repairs are
  *    exhausted — enforced by the shared `revertProposal` path. Without this,
  *    auto-revert could silently clobber a later operator scope edit with no
  *    human in the loop. The live config is asserted byte-for-byte unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { PostApplyEventsRepository } from '../../repositories/post_apply_events_repository';
import { logger } from '../../utils/logger';
import { runAutoRevertAsync } from '../auto_revert_service';

let db: Database.Database;
let configsRepo: AgentConfigsRepository;
let proposalsRepo: AgentOrgProposalsRepository;
let eventsRepo: PostApplyEventsRepository;

/** Mirrors auto_revert_service.ts's `fingerprintOf` — independent computation for exact-hash assertions. */
function sha256Hex(material: string): string {
  return createHash('sha256').update(material).digest('hex');
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  configsRepo = new AgentConfigsRepository();
  proposalsRepo = new AgentOrgProposalsRepository(db);
  eventsRepo = new PostApplyEventsRepository(db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Seeds the exact shape the real pipeline produces by the time D2.4 fires:
 * an ORIGINAL `refine-config` proposal already `applied` (model swapped
 * from `priorModel` to `appliedModel`, `beforeSnapshotJson` recording the
 * real prior value — the codebase's established `ConfigFieldSnapshot`
 * shape), 3 exhausted repair proposals recorded on the PostApplyEvent (each
 * itself a real `applied` refine-config row, mirroring D2.3's own repair
 * proposals), and a `tripped` PostApplyEvent pointing at the original.
 */
async function seedExhaustedRepairScenario(over: {
  priorModel?: string;
  appliedModel?: string;
  lastRepairModel?: string;
  repairRationale?: (attempt: number) => string;
} = {}) {
  const priorModel = over.priorModel ?? 'anthropic/claude-haiku';
  const appliedModel = over.appliedModel ?? 'anthropic/claude-opus';
  const lastRepairModel = over.lastRepairModel ?? 'anthropic/claude-sonnet-3';

  const config = configsRepo.insert({ id: 'profile-1', label: 'Profile 1', icon: 'x', modelId: priorModel.split('/')[1], modelProvider: priorModel.split('/')[0] });

  const originalProposal = await proposalsRepo.createAsync({
    id: 'proposal-original',
    kind: 'refine-config',
    risk: 'high',
    status: 'applied',
    title: 'Swap model for profile-1',
    rationale: 'Original model caused guardrail regressions',
    targetRef: 'agent_config:profile-1',
    changeJson: JSON.stringify({ configPatch: { agentConfigId: 'profile-1', field: 'model', value: appliedModel } }),
    beforeSnapshotJson: JSON.stringify({ agentConfigId: 'profile-1', field: 'model', priorValue: priorModel }),
  });

  // Repairs actually mutate the live config (mirrors auto_repair_service.ts) —
  // by the time all 3 exhaust, the live value is whatever attempt 3 left it as.
  configsRepo.update('profile-1', { modelProvider: lastRepairModel.split('/')[0], modelId: lastRepairModel.split('/')[1] });

  const repairIds: string[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const repair = await proposalsRepo.createAsync({
      id: `repair-${i}`,
      kind: 'refine-config',
      risk: 'high',
      status: 'applied',
      title: `D2.3 auto-repair attempt ${i} for profile-1`,
      rationale: over.repairRationale ? over.repairRationale(i) : `Root cause for profile-1, attempt ${i}`,
      targetRef: 'agent_config:profile-1',
      changeJson: JSON.stringify({ configPatch: { agentConfigId: 'profile-1', field: 'model', value: `anthropic/claude-sonnet-${i}` } }),
    });
    repairIds.push(repair.id);
  }

  await eventsRepo.createAsync({
    proposalId: 'proposal-original',
    profileId: 'profile-1',
    changeType: 'prompt',
    preChangeSnapshotJson: JSON.stringify({ profileId: 'profile-1', revisionBefore: config.revision }),
    monitoringWindowStart: '2026-08-19T00:00:00.000Z',
    monitoringWindowEnd: '2026-08-19T01:00:00.000Z',
  });
  await eventsRepo.updateStatusAsync('proposal-original', {
    guardrailStatus: 'tripped',
    repairProposalIdsJson: JSON.stringify(repairIds),
  });
  const event = await eventsRepo.findByProposalIdAsync('proposal-original');
  return { event: event!, originalProposal, repairIds, priorModel, appliedModel, lastRepairModel };
}

/**
 * Second pass (independent review) — the CURRENT-shape scenario: every
 * snapshot (original apply AND each repair) carries `expectedAppliedValue`,
 * exactly what auto_repair_service.ts and org_proposal_appliers_wiring.ts's
 * refineConfigApplier both now write. Exercises the value+revision CAS path
 * in revertProposal's isConfigFieldSnapshot branch, unlike
 * seedExhaustedRepairScenario above (which pins backward-compat with
 * pre-existing legacy snapshots that never carried this field).
 */
async function seedCasProtectedRepairScenario(finalLiveModel = 'anthropic/claude-sonnet-3') {
  const priorModel = 'anthropic/claude-haiku';
  const appliedModel = 'anthropic/claude-opus';

  configsRepo.insert({ id: 'profile-cas', label: 'Profile CAS', icon: 'x', modelProvider: 'anthropic', modelId: 'claude-haiku' });

  await proposalsRepo.createAsync({
    id: 'proposal-cas-original',
    kind: 'refine-config',
    risk: 'high',
    status: 'applied',
    title: 'Swap model for profile-cas',
    targetRef: 'agent_config:profile-cas',
    changeJson: JSON.stringify({ configPatch: { agentConfigId: 'profile-cas', field: 'model', value: appliedModel } }),
    beforeSnapshotJson: JSON.stringify({
      agentConfigId: 'profile-cas', field: 'model', priorValue: priorModel, expectedAppliedValue: appliedModel,
    }),
  });

  // Each repair's OWN snapshot chains to the next: repair i expects the
  // PREVIOUS attempt's value live, and lands its own.
  const repairValues = ['anthropic/claude-sonnet-1', 'anthropic/claude-sonnet-2', finalLiveModel];
  let expectedBefore = appliedModel;
  const repairIds: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const repair = await proposalsRepo.createAsync({
      id: `repair-cas-${i + 1}`,
      kind: 'refine-config',
      risk: 'high',
      status: 'applied',
      title: `D2.3 auto-repair attempt ${i + 1} for profile-cas`,
      targetRef: 'agent_config:profile-cas',
      changeJson: JSON.stringify({ source: 'auto-repair-service', profileId: 'profile-cas', field: 'model' }),
      beforeSnapshotJson: JSON.stringify({
        agentConfigId: 'profile-cas',
        field: 'model',
        priorValue: expectedBefore,
        expectedAppliedValue: repairValues[i],
      }),
    });
    repairIds.push(repair.id);
    expectedBefore = repairValues[i];
  }
  configsRepo.update('profile-cas', {
    modelProvider: finalLiveModel.split('/')[0],
    modelId: finalLiveModel.split('/')[1],
  });

  await eventsRepo.createAsync({
    proposalId: 'proposal-cas-original',
    profileId: 'profile-cas',
    changeType: 'prompt',
    preChangeSnapshotJson: '{}',
    monitoringWindowStart: '2026-08-19T00:00:00.000Z',
    monitoringWindowEnd: '2026-08-19T01:00:00.000Z',
  });
  await eventsRepo.updateStatusAsync('proposal-cas-original', {
    guardrailStatus: 'tripped',
    repairProposalIdsJson: JSON.stringify(repairIds),
  });
  const event = await eventsRepo.findByProposalIdAsync('proposal-cas-original');
  return { event: event!, priorModel, appliedModel, repairIds };
}

describe('D2.4 runAutoRevertAsync', () => {
  it('CAS override (second pass): reverts past a whole repair chain, anchoring on the LAST repair\'s own applied value', async () => {
    const { event, priorModel } = await seedCasProtectedRepairScenario();

    const result = await runAutoRevertAsync(event, {});

    expect(result.outcome).toBe('reverted');
    const restored = configsRepo.getById('profile-cas');
    expect(`${restored?.modelProvider}/${restored?.modelId}`).toBe(priorModel);
  });

  it('CAS override (second pass): a genuine concurrent edit AFTER the repair chain is detected and refused, never overwritten', async () => {
    const { event } = await seedCasProtectedRepairScenario();
    // An operator (or an unrelated automation) edits the SAME field to a
    // value the repair chain never produced — this must NOT be silently
    // clobbered by the revert.
    configsRepo.update('profile-cas', { modelProvider: 'openai', modelId: 'human-edit' });

    const result = await runAutoRevertAsync(event, {});

    expect(result.outcome).toBe('revert_failed');
    expect(result.conflict?.reason).toBe('revert-conflict');
    const untouched = configsRepo.getById('profile-cas');
    expect(`${untouched?.modelProvider}/${untouched?.modelId}`).toBe('openai/human-edit');
  });


  it('finding #3: a config-field revert that lands in the DB but whose profile-file projection is blocked never marks the proposal reverted (never reverted+revert_failed); a retry that projects cleanly then settles without re-writing', async () => {
    const writer = await import('../../services/opencode_agent_writer');
    const writeSpy = vi.spyOn(writer, 'writeAgentProfileFile');
    writeSpy.mockReturnValueOnce('blocked');

    configsRepo.insert({
      id: 'profile-gate',
      label: 'Profile gate',
      icon: 'x',
      isAgent: true,
      systemPrompt: 'Safely verify configuration changes.',
      modelProvider: 'anthropic',
      modelId: 'claude-opus',
    });
    await proposalsRepo.createAsync({
      id: 'proposal-gate',
      kind: 'refine-config',
      risk: 'high',
      status: 'applied',
      title: 'Swap model for profile-gate',
      targetRef: 'agent_config:profile-gate',
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: 'profile-gate', field: 'model', value: 'anthropic/claude-opus' },
      }),
      beforeSnapshotJson: JSON.stringify({
        agentConfigId: 'profile-gate',
        field: 'model',
        priorValue: 'anthropic/claude-haiku',
        expectedAppliedValue: 'anthropic/claude-opus',
      }),
    });
    await eventsRepo.createAsync({
      proposalId: 'proposal-gate',
      profileId: 'profile-gate',
      changeType: 'prompt',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-19T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-19T01:00:00.000Z',
    });
    await eventsRepo.updateStatusAsync('proposal-gate', { guardrailStatus: 'tripped' });
    const event = await eventsRepo.findByProposalIdAsync('proposal-gate');

    const first = await runAutoRevertAsync(event!, {});
    expect(first.outcome).toBe('revert_failed');
    expect(first.conflict?.reason).toBe('revert-conflict');
    // The DB half of the restore DID land...
    const afterFirstConfig = configsRepo.getById('profile-gate');
    expect(`${afterFirstConfig?.modelProvider}/${afterFirstConfig?.modelId}`).toBe('anthropic/claude-haiku');
    // ...but the proposal must NOT be terminal — never 'reverted' at the same
    // time the event says 'revert_failed'.
    const afterFirstProposal = await proposalsRepo.findByIdAsync('proposal-gate');
    expect(afterFirstProposal?.status).toBe('measuring');
    expect(first.event.revertStatus).toBe('revert_failed');

    const revisionAfterFirst = afterFirstConfig?.revision;
    writeSpy.mockReturnValueOnce('written');
    const second = await runAutoRevertAsync(first.event, {});
    expect(second.outcome).toBe('reverted');
    expect(configsRepo.getById('profile-gate')?.revision).toBe(revisionAfterFirst);
    expect((await proposalsRepo.findByIdAsync('proposal-gate'))?.status).toBe('reverted');
    expect(second.event.revertStatus).toBe('reverted');
  });

  it('all 3 repairs fail: reverts the original proposal and restores the profile to its pre-change state', async () => {
    const { event, priorModel } = await seedExhaustedRepairScenario();

    const result = await runAutoRevertAsync(event, {});

    expect(result.outcome).toBe('reverted');
    expect(result.event.revertStatus).toBe('reverted');

    const restored = configsRepo.getById('profile-1');
    expect(`${restored?.modelProvider}/${restored?.modelId}`).toBe(priorModel);

    const originalProposal = await proposalsRepo.findByIdAsync('proposal-original');
    expect(originalProposal?.status).toBe('reverted');

    const persisted = await eventsRepo.findByProposalIdAsync('proposal-original');
    expect(persisted?.revertStatus).toBe('reverted');
  });

  it('proposal CAS race: records proposal-cas-conflict, leaves the live profile byte-exact, and persists the alert', async () => {
    const { event } = await seedExhaustedRepairScenario();
    const profileBefore = JSON.stringify(configsRepo.getById('profile-1'));
    const originalUpdateStatusAsync = proposalsRepo.updateStatusAsync.bind(proposalsRepo);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(proposalsRepo, 'updateStatusAsync').mockImplementationOnce(
      async (proposalId, status, reason, expectedRevision) => {
        const concurrentRepo = new AgentOrgProposalsRepository(db);
        await concurrentRepo.updateStatusAsync(proposalId, 'measuring', undefined, expectedRevision);
        return await originalUpdateStatusAsync(proposalId, status, reason, expectedRevision);
      },
    );

    const result = await runAutoRevertAsync(event, { proposalsRepo, configsRepo, eventsRepo });

    expect(result.outcome).toBe('revert_failed');
    expect(result.conflict?.reason).toBe('proposal-cas-conflict');
    expect(JSON.stringify(configsRepo.getById('profile-1'))).toBe(profileBefore);

    const persisted = await eventsRepo.findByProposalIdAsync('proposal-original');
    expect(persisted?.revertStatus).toBe('revert_failed');
    expect(persisted?.alertPayloadJson).toBeTruthy();
    const alert = JSON.parse(persisted!.alertPayloadJson!);
    expect(alert.revert.outcome).toBe('revert_failed');
    expect(alert.revert.conflict.reason).toBe('proposal-cas-conflict');
    expect(warn).toHaveBeenCalledWith("[auto-revert] revert_failed for proposal 'proposal-original'");
  });

  it('generates an alert with the full trail: original change, all 3 repair attempts, and the revert outcome', async () => {
    const { event, repairIds } = await seedExhaustedRepairScenario();

    await runAutoRevertAsync(event, {});

    const persisted = await eventsRepo.findByProposalIdAsync('proposal-original');
    expect(persisted?.alertPayloadJson).toBeTruthy();
    const alert = JSON.parse(persisted!.alertPayloadJson!);
    expect(alert.proposalId).toBe('proposal-original');
    expect(alert.profileId).toBe('profile-1');
    // issue-1434 full-trail fingerprints: computable for the original (a
    // legacy snapshot, no expectedAppliedValue — falls back to priorValue as
    // the "change" material) even though these seeded repairs carry no
    // beforeSnapshotJson at all (their own field/valueFingerprint stay absent).
    expect(alert.originalChange).toEqual({
      kind: 'refine-config',
      targetFingerprint: sha256Hex(['target', 'profile-1', 'model'].join('\u0000')),
      changeFingerprint: sha256Hex(['change', 'profile-1', 'model', 'anthropic/claude-haiku'].join('\u0000')),
    });
    for (const [index, proposalId] of repairIds.entries()) {
      expect(alert.repairAttempts[index]).toEqual({
        proposalId,
        status: 'applied',
      });
    }
    expect(alert.revert.outcome).toBe('reverted');
  });

  it('issue-1434 full-trail fingerprints: alert carries exact SHA-256 target/change fingerprints for the original and a field + value fingerprint for each repair, with no raw values', async () => {
    const { event, priorModel, appliedModel, repairIds } = await seedCasProtectedRepairScenario();

    await runAutoRevertAsync(event, {});

    const persisted = await eventsRepo.findByProposalIdAsync('proposal-cas-original');
    const alert = JSON.parse(persisted!.alertPayloadJson!);

    expect(alert.originalChange).toEqual({
      kind: 'refine-config',
      targetFingerprint: sha256Hex(['target', 'profile-cas', 'model'].join('\u0000')),
      changeFingerprint: sha256Hex(['change', 'profile-cas', 'model', appliedModel].join('\u0000')),
    });

    const repairValues = ['anthropic/claude-sonnet-1', 'anthropic/claude-sonnet-2', 'anthropic/claude-sonnet-3'];
    for (const [index, proposalId] of repairIds.entries()) {
      expect(alert.repairAttempts[index]).toEqual({
        proposalId,
        status: 'applied',
        field: 'model',
        valueFingerprint: sha256Hex(['value', repairValues[index]].join('\u0000')),
      });
    }

    // Never a raw model value in the alert — only fingerprints/plain field names.
    const raw = JSON.stringify(alert);
    expect(raw).not.toContain(priorModel);
    expect(raw).not.toContain(appliedModel);
    for (const value of repairValues) expect(raw).not.toContain(value);
  });

  it('never persists raw secret-shaped text from repair rationale into the alert payload', async () => {
    // A repair's diagnosis rationale is LLM-authored free text — plant a
    // secret-shaped token exactly like the D2.1/D2.3 redaction tests do.
    const { event } = await seedExhaustedRepairScenario({
      repairRationale: (attempt) =>
        attempt === 3
          ? 'Root cause found using Bearer abcdefghijklmnop1234567890 for diagnosis'
          : `Root cause for profile-1, attempt ${attempt}`,
    });

    await runAutoRevertAsync(event, {});

    const raw = db.prepare(`SELECT alert_payload_json FROM agent_org_post_apply_events WHERE proposal_id = ?`).get('proposal-original') as { alert_payload_json: string };
    expect(raw.alert_payload_json).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/);
    expect(raw.alert_payload_json).not.toContain('Root cause found using');
  });

  it('is a no-op when the event is not currently tripped', async () => {
    const { event } = await seedExhaustedRepairScenario();
    const monitoring = { ...event, guardrailStatus: 'monitoring' as const };

    const result = await runAutoRevertAsync(monitoring, {});

    expect(result.outcome).toBe('not-tripped');
    const originalProposal = await proposalsRepo.findByIdAsync('proposal-original');
    expect(originalProposal?.status).toBe('applied');
  });

  it('sharp edge: restores a secret-shaped priorValue byte-exact — the restoration source (proposal.beforeSnapshotJson) is never redacted', async () => {
    // A profile's system_prompt is realistic free text an operator could
    // paste a credential into. Pin that reverting it round-trips EXACTLY,
    // proving proposal.beforeSnapshotJson (unlike PostApplyEvent's own
    // preChangeSnapshotJson) is never routed through redactSecrets.
    const secretPrompt = 'You are a helper. Use Bearer abcdefghijklmnop1234567890 to authenticate.';
    configsRepo.insert({ id: 'profile-2', label: 'Profile 2', icon: 'x', systemPrompt: 'current prompt' });

    await proposalsRepo.createAsync({
      id: 'proposal-secret',
      kind: 'refine-config',
      risk: 'high',
      status: 'applied',
      title: 'Swap prompt for profile-2',
      targetRef: 'agent_config:profile-2',
      changeJson: JSON.stringify({ configPatch: { agentConfigId: 'profile-2', field: 'system_prompt', value: 'current prompt' } }),
      beforeSnapshotJson: JSON.stringify({ agentConfigId: 'profile-2', field: 'system_prompt', priorValue: secretPrompt }),
    });
    await eventsRepo.createAsync({
      proposalId: 'proposal-secret',
      profileId: 'profile-2',
      changeType: 'prompt',
      preChangeSnapshotJson: '{}',
      monitoringWindowStart: '2026-08-19T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-19T01:00:00.000Z',
    });
    await eventsRepo.updateStatusAsync('proposal-secret', { guardrailStatus: 'tripped' });
    const event = await eventsRepo.findByProposalIdAsync('proposal-secret');

    const result = await runAutoRevertAsync(event!, {});

    expect(result.outcome).toBe('reverted');
    const restored = configsRepo.getById('profile-2');
    expect(restored?.systemPrompt).toBe(secretPrompt);
    expect(restored?.systemPrompt).not.toContain('[redacted]');
  });

  it('security fix (#1434): refuses a whole-field revert of allowedSkillsJson even after all 3 repairs are exhausted, and leaves the live config byte-for-byte unchanged', async () => {
    // Regression pin: org_proposal_apply.ts's revertProposal() already
    // refuses a whole-field ConfigFieldSnapshot revert on allowedMcpsJson /
    // allowedSkillsJson / corePermissionsJson (it cannot tell a safe rollback
    // apart from clobbering a LATER operator edit to that same allowlist).
    // This service routes through revertProposal, so the unattended and human
    // paths share this refusal. allowedSkillsJson is a real reachable target:
    // it is both a legal refine-config field and an unsafe whole-field revert.
    const priorSkills = JSON.stringify(['triage']);
    const appliedSkills = JSON.stringify(['triage', 'follow-up']);
    // What the live row holds after 3 repair attempts on top of the
    // original apply — the value that MUST survive this call untouched.
    const liveAfterRepairs = JSON.stringify(['triage', 'follow-up', 'escalate']);

    configsRepo.insert({ id: 'profile-3', label: 'Profile 3', icon: 'x', allowedSkillsJson: appliedSkills });

    await proposalsRepo.createAsync({
      id: 'proposal-scope',
      kind: 'refine-config',
      risk: 'high',
      status: 'applied',
      title: 'Swap allowedSkillsJson for profile-3',
      targetRef: 'agent_config:profile-3',
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: 'profile-3', field: 'allowedSkillsJson', value: appliedSkills },
      }),
      beforeSnapshotJson: JSON.stringify({
        agentConfigId: 'profile-3',
        field: 'allowedSkillsJson',
        priorValue: priorSkills,
      }),
    });

    // Mirrors seedExhaustedRepairScenario: repairs mutate the live config
    // further before all 3 exhaust.
    configsRepo.update('profile-3', { allowedSkillsJson: liveAfterRepairs });

    const repairIds: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const repair = await proposalsRepo.createAsync({
        id: `repair-scope-${i}`,
        kind: 'refine-config',
        risk: 'high',
        status: 'applied',
        title: `D2.3 auto-repair attempt ${i} for profile-3`,
        rationale: `Root cause for profile-3, attempt ${i}`,
        targetRef: 'agent_config:profile-3',
        changeJson: JSON.stringify({
          configPatch: { agentConfigId: 'profile-3', field: 'allowedSkillsJson', value: liveAfterRepairs },
        }),
      });
      repairIds.push(repair.id);
    }

    await eventsRepo.createAsync({
      proposalId: 'proposal-scope',
      profileId: 'profile-3',
      changeType: 'prompt',
      preChangeSnapshotJson: JSON.stringify({ profileId: 'profile-3', revisionBefore: 1 }),
      monitoringWindowStart: '2026-08-19T00:00:00.000Z',
      monitoringWindowEnd: '2026-08-19T01:00:00.000Z',
    });
    await eventsRepo.updateStatusAsync('proposal-scope', {
      guardrailStatus: 'tripped',
      repairProposalIdsJson: JSON.stringify(repairIds),
    });
    const event = await eventsRepo.findByProposalIdAsync('proposal-scope');

    const result = await runAutoRevertAsync(event!, {});

    expect(result.outcome).toBe('revert_failed');
    expect(result.event.revertStatus).toBe('revert_failed');
    expect(result.conflict).toBeTruthy();
    expect(JSON.stringify(result.conflict)).toMatch(/allowedSkillsJson/);
    expect(JSON.stringify(result.conflict)).toMatch(/unsafe-legacy-scope/);

    // The actual security property: the live config was NEVER touched — not
    // reverted to priorSkills, and not left partway through a write.
    const untouched = configsRepo.getById('profile-3');
    expect(untouched?.allowedSkillsJson).toBe(liveAfterRepairs);

    // The original proposal must not have been silently marked 'reverted'.
    const originalProposal = await proposalsRepo.findByIdAsync('proposal-scope');
    expect(originalProposal?.status).not.toBe('reverted');

    const persisted = await eventsRepo.findByProposalIdAsync('proposal-scope');
    expect(persisted?.revertStatus).toBe('revert_failed');
    expect(persisted?.alertPayloadJson).toBeTruthy();
  });
});
