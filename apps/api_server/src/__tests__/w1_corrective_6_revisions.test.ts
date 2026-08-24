import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import {
  AgentConfigsRepository,
  readPersistedRevision,
} from '../repositories/agent_configs_repository';
import { createScopeStateV2Snapshot } from '../services/scope_mutation_contract';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function dropRevisionInvariants(db: Database.Database, table: string): void {
  // A genuine pre-corrective-6 database had neither the column nor the
  // revision triggers, and SQLite refuses to drop a column a trigger reads.
  db.exec(`
    DROP TRIGGER IF EXISTS trg_${table}_revision_insert_domain;
    DROP TRIGGER IF EXISTS trg_${table}_revision_update_domain;
    DROP TRIGGER IF EXISTS trg_${table}_revision_autobump;
    ALTER TABLE ${table} DROP COLUMN revision;
  `);
}

describe('W1 corrective 6 package B — monotonic persistence revisions', () => {
  describe('B1 proposal revision schema and model', () => {
    it('migrates an existing proposal row to revision zero', () => {
      // Regression caught: adding the model field without an additive legacy
      // backfill leaves existing optimizer rows null/unreadable.
      const db = makeDb();
      dropRevisionInvariants(db, 'agent_org_proposals');
      db.prepare(
        `INSERT INTO agent_org_proposals
          (id, kind, risk, status, title)
         VALUES ('legacy-proposal', 'refine-config', 'low', 'proposed', 'Legacy')`,
      ).run();

      runMigrations(db);

      const row = db.prepare(
        `SELECT revision FROM agent_org_proposals WHERE id = 'legacy-proposal'`,
      ).get() as { revision: number };
      expect(row.revision).toBe(0);
      db.close();
    });

    it('exposes revision zero on new, read, and listed proposals', async () => {
      // Regression caught: SQLite has the column but one repository mapper or
      // read surface silently drops it, defeating callers that need a CAS token.
      const db = makeDb();
      setDb(db);
      const repo = new AgentOrgProposalsRepository(db);
      const created = await repo.createAsync({
        id: 'revision-proposal',
        kind: 'refine-config',
        risk: 'low',
        title: 'Revision proposal',
      });

      expect(created.revision).toBe(0);
      expect((await repo.findByIdAsync(created.id))?.revision).toBe(0);
      expect((await repo.listProposedAsync())[0]?.revision).toBe(0);
      db.close();
    });

    it('increments revision exactly once for each successful status mutation', async () => {
      // Regression caught: status updates either reuse a revision (ABA unsafe)
      // or increment more than once while applying a patch.
      const db = makeDb();
      setDb(db);
      const repo = new AgentOrgProposalsRepository(db);
      const created = await repo.createAsync({
        id: 'revision-sequence',
        kind: 'refine-config',
        risk: 'low',
        title: 'Revision sequence',
      });

      const applied = await repo.updateStatusAsync(created.id, 'applied', {
        beforeSnapshotJson: '{"prior":true}',
      });
      const measuring = await repo.updateStatusAsync(created.id, 'measuring');

      expect([created.revision, applied?.revision, measuring?.revision]).toEqual([0, 1, 2]);
      expect((await repo.findByIdAsync(created.id))?.revision).toBe(2);
      db.close();
    });
  });

  describe('B2 generic status CAS is ABA safe', () => {
    it('provides an explicit expected-revision status primitive for package C', async () => {
      // Regression caught: package C can only ask the repository to read the
      // latest revision, so it cannot fence a decision made from an earlier row.
      const db = makeDb();
      setDb(db);
      const repo = new AgentOrgProposalsRepository(db);
      const proposal = await repo.createAsync({
        id: 'explicit-status-revision',
        kind: 'refine-config',
        risk: 'low',
        title: 'Explicit status revision',
      });
      const winner = await repo.updateStatusAtRevisionAsync(
        proposal.id,
        proposal.revision,
        'applied',
      );
      expect(winner?.revision).toBe(1);
      await expect(
        repo.updateStatusAtRevisionAsync(proposal.id, proposal.revision, 'measuring'),
      ).rejects.toThrow(/concurrent|conflict/i);
      expect(await repo.findByIdAsync(proposal.id)).toEqual(winner);
      db.close();
    });

    it('rejects a stale failed writer paused across a failed-to-failed self-loop', async () => {
      // Regression caught: status-only CAS sees "failed" again after another
      // failure and lets stale patch bytes overwrite the winner.
      const db = makeDb();
      setDb(db);
      const setup = new AgentOrgProposalsRepository(db);
      const proposal = await setup.createAsync({
        id: 'failed-aba',
        kind: 'publish-skill-to-org',
        risk: 'high',
        title: 'Failed ABA',
      });
      await setup.updateStatusAsync(proposal.id, 'failed', { measureReason: 'initial' });

      const stale = new AgentOrgProposalsRepository(db);
      const originalFind = stale.findByIdAsync.bind(stale);
      let release!: () => void;
      let captured!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const read = new Promise<void>((resolve) => { captured = resolve; });
      let firstRead = true;
      stale.findByIdAsync = async (id: string) => {
        const row = await originalFind(id);
        if (firstRead) {
          firstRead = false;
          captured();
          await gate;
        }
        return row;
      };

      const staleWrite = stale.updateStatusAsync(proposal.id, 'failed', {
        measureReason: 'stale writer',
      });
      await read;
      const winner = await setup.updateStatusAsync(proposal.id, 'failed', {
        measureReason: 'winner',
      });
      release();

      expect(winner?.revision).toBe(2);
      await expect(staleWrite).rejects.toThrow(/concurrent|conflict/i);
      expect(await setup.findByIdAsync(proposal.id)).toMatchObject({
        status: 'failed',
        revision: 2,
        measureReason: 'winner',
      });
      db.close();
    });
  });

  describe('B3 atomic scope transitions bind both revisions', () => {
    async function setupAtomic(db: Database.Database, suffix: string) {
      setDb(db);
      const configs = new AgentConfigsRepository();
      const target = configs.insert({
        id: `atomic-target-${suffix}`,
        label: `Atomic target ${suffix}`,
        icon: 'shield',
        allowedSkillsJson: '["base","extra"]',
      });
      const proposals = new AgentOrgProposalsRepository(db);
      const changeJson = JSON.stringify({
        agentConfigId: target.id,
        field: 'allowedSkillsJson',
        add: ['extra'],
      });
      const snapshotJson = JSON.stringify(createScopeStateV2Snapshot(
        target.id,
        'allowedSkillsJson',
        '["base"]',
        '["base","extra"]',
        changeJson,
        'broaden-scope',
      ));
      const created = await proposals.createAsync({
        id: `atomic-proposal-${suffix}`,
        kind: 'broaden-scope',
        risk: 'high',
        title: `Atomic proposal ${suffix}`,
        changeJson,
        beforeSnapshotJson: snapshotJson,
      });
      // Fixture only: place the row in the durable post-apply state without
      // going through the lifecycle. The generic status API now refuses ANY
      // scope arrival at `applied` (that is what B9 asserts), so this raw
      // write stands in for a pair the atomic primitive already committed.
      db.prepare(
        `UPDATE agent_org_proposals SET status = 'applied' WHERE id = ?`,
      ).run(created.id);
      const measuring = (await proposals.updateStatusAsync(created.id, 'measuring'))!;
      return { configs, target, proposals, measuring, changeJson, snapshotJson };
    }

    function transitionInput(
      state: Awaited<ReturnType<typeof setupAtomic>>,
      overrides: Record<string, unknown> = {},
    ) {
      return {
        proposalId: state.measuring.id,
        expectedProposalStatus: 'measuring' as const,
        nextProposalStatus: 'reverted' as const,
        expectedProposalRevision: state.measuring.revision,
        expectedKind: 'broaden-scope',
        expectedChangeJson: state.changeJson,
        expectedBeforeSnapshotJson: state.snapshotJson,
        targetId: state.target.id,
        field: 'allowedSkillsJson' as const,
        expectedTargetValue: '["base","extra"]',
        nextTargetValue: '["base"]',
        expectedTargetRevision: state.target.revision,
        nextBaselineScore: null,
        nextPostScore: null,
        nextMeasureReason: 'atomic revert',
        ...overrides,
      };
    }

    it('rejects a stale measuring writer spanning measuring-reverted-measuring ABA', async () => {
      // Regression caught: the atomic inverse recreates status=measuring, so
      // a stale generic status writer wins unless proposal revision is bound.
      const db = makeDb();
      const state = await setupAtomic(db, 'aba');
      const stale = new AgentOrgProposalsRepository(db);
      const originalFind = stale.findByIdAsync.bind(stale);
      let release!: () => void;
      let captured!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const read = new Promise<void>((resolve) => { captured = resolve; });
      let firstRead = true;
      stale.findByIdAsync = async (id: string) => {
        const row = await originalFind(id);
        if (firstRead) {
          firstRead = false;
          captured();
          await gate;
        }
        return row;
      };

      const staleWrite = stale.updateStatusAsync(state.measuring.id, 'active', {
        measureReason: 'stale keep',
      });
      await read;
      const forward = await state.proposals.transitionScopeAtomicallyAsync(transitionInput(state));
      expect(forward).not.toBeNull();
      const inverse = await state.proposals.transitionScopeAtomicallyAsync(transitionInput(state, {
        expectedProposalStatus: 'reverted',
        nextProposalStatus: 'measuring',
        expectedProposalRevision: forward!.proposal.revision,
        expectedTargetValue: '["base"]',
        nextTargetValue: '["base","extra"]',
        expectedTargetRevision: forward!.target.revision,
        nextMeasureReason: 'winner cycle',
      }));
      expect(inverse).not.toBeNull();
      release();

      await expect(staleWrite).rejects.toThrow(/concurrent|conflict/i);
      expect(await state.proposals.findByIdAsync(state.measuring.id)).toMatchObject({
        status: 'measuring',
        revision: state.measuring.revision + 2,
        measureReason: 'winner cycle',
      });
      db.close();
    });

    it('returns null on exact proposal revision miss with zero target or proposal effects', async () => {
      // Regression caught: atomic SQL binds status/kind/bytes but ignores the
      // proposal generation, mutating a newer lifecycle occurrence.
      const db = makeDb();
      const state = await setupAtomic(db, 'revision-miss');
      const beforeProposal = await state.proposals.findByIdAsync(state.measuring.id);
      const beforeTarget = state.configs.getById(state.target.id);

      const result = await state.proposals.transitionScopeAtomicallyAsync(transitionInput(state, {
        expectedProposalRevision: state.measuring.revision - 1,
      }));

      expect(result).toBeNull();
      expect(await state.proposals.findByIdAsync(state.measuring.id)).toEqual(beforeProposal);
      expect(state.configs.getById(state.target.id)).toEqual(beforeTarget);
      db.close();
    });

    it('semantically binds the atomic target id and bytes to the verified v2 snapshot', async () => {
      const db = makeDb();
      const state = await setupAtomic(db, 'semantic-target');
      const other = state.configs.insert({
        id: 'atomic-other-target',
        label: 'Atomic other target',
        icon: 'shield',
        allowedSkillsJson: '["base","extra"]',
      });
      const beforeProposal = await state.proposals.findByIdAsync(state.measuring.id);
      const beforeOriginal = state.configs.getById(state.target.id);
      const beforeOther = state.configs.getById(other.id);

      await expect(state.proposals.transitionScopeAtomicallyAtRevisionsAsync({
        ...transitionInput(state),
        targetId: other.id,
        expectedTargetRevision: other.revision,
      })).rejects.toThrow(/snapshot|semantic|target|bound/i);
      await expect(state.proposals.transitionScopeAtomicallyAtRevisionsAsync({
        ...transitionInput(state),
        nextTargetValue: '["base","extra"]',
      })).rejects.toThrow(/snapshot|semantic|target|mutation/i);

      expect(await state.proposals.findByIdAsync(state.measuring.id)).toEqual(beforeProposal);
      expect(state.configs.getById(state.target.id)).toEqual(beforeOriginal);
      expect(state.configs.getById(other.id)).toEqual(beforeOther);
      db.close();
    });

    it.each([
      {
        label: 'null material',
        kind: 'broaden-scope',
        changeJson: null,
        snapshotJson: null,
      },
      {
        label: 'a non-scope kind',
        kind: 'refine-recipe',
        changeJson: '{"recipePatch":true}',
        snapshotJson: '{"legacy":true}',
      },
    ])('rejects $label before an atomic scope effect', async ({ kind, changeJson, snapshotJson }) => {
      const db = makeDb();
      setDb(db);
      const configs = new AgentConfigsRepository();
      const target = configs.insert({
        id: `unsafe-atomic-target-${kind}`,
        label: `Unsafe atomic target ${kind}`,
        icon: 'shield',
        allowedSkillsJson: '["base"]',
      });
      const proposals = new AgentOrgProposalsRepository(db);
      const proposal = await proposals.createAsync({
        id: `unsafe-atomic-proposal-${kind}`,
        kind,
        risk: 'high',
        status: 'approved',
        title: `Unsafe atomic proposal ${kind}`,
        changeJson,
        beforeSnapshotJson: snapshotJson,
      });
      const beforeTarget = configs.getById(target.id);
      const beforeProposal = await proposals.findByIdAsync(proposal.id);

      await expect((proposals.transitionScopeAtomicallyAtRevisionsAsync as any)({
        proposalId: proposal.id,
        expectedProposalStatus: 'approved',
        nextProposalStatus: 'applied',
        expectedProposalRevision: proposal.revision,
        expectedKind: kind,
        expectedChangeJson: changeJson,
        expectedBeforeSnapshotJson: snapshotJson,
        targetId: target.id,
        field: 'allowedSkillsJson',
        expectedTargetValue: '["base"]',
        nextTargetValue: '["unsafe"]',
        expectedTargetRevision: target.revision,
        nextBaselineScore: null,
        nextPostScore: null,
        nextMeasureReason: null,
      })).rejects.toThrow(/scope|snapshot|change|kind|material/i);
      expect(configs.getById(target.id)).toEqual(beforeTarget);
      expect(await proposals.findByIdAsync(proposal.id)).toEqual(beforeProposal);
      db.close();
    });

    it('requires both revisions at runtime on the revision-bound atomic seam', async () => {
      const db = makeDb();
      const state = await setupAtomic(db, 'required-revisions');
      const beforeProposal = await state.proposals.findByIdAsync(state.measuring.id);
      const beforeTarget = state.configs.getById(state.target.id);
      const input = transitionInput(state) as Record<string, unknown>;
      delete input.expectedProposalRevision;
      delete input.expectedTargetRevision;

      await expect(
        (state.proposals.transitionScopeAtomicallyAtRevisionsAsync as any)(input),
      ).rejects.toThrow(/revision/i);
      expect(await state.proposals.findByIdAsync(state.measuring.id)).toEqual(beforeProposal);
      expect(state.configs.getById(state.target.id)).toEqual(beforeTarget);
      db.close();
    });

    it('atomically transitions an approved claim and exact target to applied', async () => {
      // Regression caught: the intermediate claim exists but package C has no
      // one-transaction primitive to make the target and proposal applied.
      const db = makeDb();
      setDb(db);
      const configs = new AgentConfigsRepository();
      const target = configs.insert({
        id: 'approved-apply-target',
        label: 'Approved apply target',
        icon: 'shield',
        allowedSkillsJson: '["base"]',
      });
      const proposals = new AgentOrgProposalsRepository(db);
      const changeJson = JSON.stringify({
        agentConfigId: target.id,
        field: 'allowedSkillsJson',
        add: ['extra'],
      });
      const snapshotJson = JSON.stringify(createScopeStateV2Snapshot(
        target.id,
        'allowedSkillsJson',
        '["base"]',
        '["base","extra"]',
        changeJson,
        'broaden-scope',
      ));
      const proposal = await proposals.createAsync({
        id: 'approved-apply-proposal',
        kind: 'broaden-scope',
        risk: 'high',
        title: 'Approved apply proposal',
        changeJson,
      });
      const approved = await proposals.claimScopeApprovedWithSnapshotAsync({
        id: proposal.id,
        decidedByUserId: 7,
        expectedRevision: proposal.revision,
        expectedKind: 'broaden-scope',
        expectedChangeJson: changeJson,
        beforeSnapshotJson: snapshotJson,
        validateSnapshot: () => true,
      });

      const applied = await proposals.transitionScopeAtomicallyAtRevisionsAsync({
        proposalId: proposal.id,
        expectedProposalStatus: 'approved',
        nextProposalStatus: 'applied',
        expectedProposalRevision: approved!.revision,
        expectedKind: 'broaden-scope',
        expectedChangeJson: changeJson,
        expectedBeforeSnapshotJson: snapshotJson,
        targetId: target.id,
        field: 'allowedSkillsJson',
        expectedTargetValue: '["base"]',
        nextTargetValue: '["base","extra"]',
        expectedTargetRevision: target.revision,
        nextBaselineScore: null,
        nextPostScore: null,
        nextMeasureReason: null,
      });

      expect(applied?.proposal).toMatchObject({ status: 'applied', revision: 2 });
      expect(applied?.target).toMatchObject({
        allowedSkillsJson: '["base","extra"]',
        revision: 1,
      });
      db.close();
    });

    it('atomically compensates an applied target back to the approved claim', async () => {
      // Regression caught: projection failure after approved -> applied had no
      // exact atomic inverse, forcing package C either to leave target bytes
      // applied or to expose a split proposal/target pair while compensating.
      const db = makeDb();
      setDb(db);
      const configs = new AgentConfigsRepository();
      const target = configs.insert({
        id: 'approved-compensation-target',
        label: 'Approved compensation target',
        icon: 'shield',
        allowedSkillsJson: '["base"]',
      });
      const proposals = new AgentOrgProposalsRepository(db);
      const changeJson = JSON.stringify({
        agentConfigId: target.id,
        field: 'allowedSkillsJson',
        add: ['extra'],
      });
      const snapshotJson = JSON.stringify(createScopeStateV2Snapshot(
        target.id,
        'allowedSkillsJson',
        '["base"]',
        '["base","extra"]',
        changeJson,
        'broaden-scope',
      ));
      const proposal = await proposals.createAsync({
        id: 'approved-compensation-proposal',
        kind: 'broaden-scope',
        risk: 'high',
        title: 'Approved compensation proposal',
        changeJson,
      });
      const approved = await proposals.claimScopeApprovedWithSnapshotAsync({
        id: proposal.id,
        decidedByUserId: 7,
        expectedRevision: proposal.revision,
        expectedKind: 'broaden-scope',
        expectedChangeJson: changeJson,
        beforeSnapshotJson: snapshotJson,
        validateSnapshot: () => true,
      });
      const applied = await proposals.transitionScopeAtomicallyAtRevisionsAsync({
        proposalId: proposal.id,
        expectedProposalStatus: 'approved',
        nextProposalStatus: 'applied',
        expectedProposalRevision: approved!.revision,
        expectedKind: 'broaden-scope',
        expectedChangeJson: changeJson,
        expectedBeforeSnapshotJson: snapshotJson,
        targetId: target.id,
        field: 'allowedSkillsJson',
        expectedTargetValue: '["base"]',
        nextTargetValue: '["base","extra"]',
        expectedTargetRevision: target.revision,
        nextBaselineScore: null,
        nextPostScore: null,
        nextMeasureReason: null,
      });

      const compensated = await proposals.transitionScopeAtomicallyAtRevisionsAsync({
        proposalId: proposal.id,
        expectedProposalStatus: 'applied',
        nextProposalStatus: 'approved',
        expectedProposalRevision: applied!.proposal.revision,
        expectedKind: 'broaden-scope',
        expectedChangeJson: changeJson,
        expectedBeforeSnapshotJson: snapshotJson,
        targetId: target.id,
        field: 'allowedSkillsJson',
        expectedTargetValue: '["base","extra"]',
        nextTargetValue: '["base"]',
        expectedTargetRevision: applied!.target.revision,
        nextBaselineScore: null,
        nextPostScore: null,
        nextMeasureReason: 'projection failed; target restored',
      });

      expect(compensated?.proposal).toMatchObject({
        status: 'approved',
        revision: applied!.proposal.revision + 1,
        measureReason: 'projection failed; target restored',
      });
      expect(compensated?.target).toMatchObject({
        allowedSkillsJson: '["base"]',
        revision: applied!.target.revision + 1,
      });
      db.close();
    });

    for (const table of ['agent_configs', 'agent_org_proposals'] as const) {
      for (const timing of ['BEFORE', 'AFTER'] as const) {
        it(`rolls back both rows on ${timing} ${table} trigger failure`, async () => {
          // Regression caught: an error after the target update leaks a split
          // target/proposal pair instead of rolling the transaction back.
          const db = makeDb();
          const state = await setupAtomic(db, `${timing}-${table}`);
          const beforeProposal = await state.proposals.findByIdAsync(state.measuring.id);
          const beforeTarget = state.configs.getById(state.target.id);
          db.exec(
            `CREATE TRIGGER fail_atomic_${timing}_${table}
             ${timing} UPDATE ON ${table}
             BEGIN SELECT RAISE(ABORT, 'atomic trigger failure'); END`,
          );

          await expect(
            state.proposals.transitionScopeAtomicallyAsync(transitionInput(state)),
          ).rejects.toThrow(/atomic trigger failure/);
          expect(await state.proposals.findByIdAsync(state.measuring.id)).toEqual(beforeProposal);
          expect(state.configs.getById(state.target.id)).toEqual(beforeTarget);
          db.close();
        });
      }
    }
  });

  describe('B4 agent-config revision schema and repository fencing', () => {
    it('migrates an existing config row to revision zero', () => {
      // Regression caught: legacy profiles receive null rather than a safe
      // initial projection generation during additive migration.
      const db = makeDb();
      dropRevisionInvariants(db, 'agent_configs');
      runMigrations(db);
      const row = db.prepare(
        `SELECT revision FROM agent_configs WHERE id = 'codex'`,
      ).get() as { revision: number };
      expect(row.revision).toBe(0);
      db.close();
    });

    it('exposes revision zero and increments generic updates exactly once', () => {
      // Regression caught: full-profile writers receive no monotonic token or
      // one update advances it multiple times while changing several fields.
      const db = makeDb();
      setDb(db);
      const configs = new AgentConfigsRepository();
      const created = configs.insert({
        id: 'config-revision-sequence',
        label: 'Config revision sequence',
        icon: 'shield',
      });
      const first = configs.update(created.id, {
        label: 'Changed label',
        allowedSkillsJson: '["one"]',
      });
      const second = configs.update(created.id, { systemPrompt: 'Changed prompt' });

      expect([created.revision, first?.revision, second?.revision]).toEqual([0, 1, 2]);
      db.close();
    });

    it('increments legacy fixed-column CAS and provides an explicit revision-bound primitive', () => {
      // Regression caught: exact bytes return to an earlier value and a stale
      // target writer succeeds because the fixed-column CAS ignores revision.
      const db = makeDb();
      setDb(db);
      const configs = new AgentConfigsRepository();
      const created = configs.insert({
        id: 'config-revision-cas',
        label: 'Config revision CAS',
        icon: 'shield',
        allowedSkillsJson: '["one"]',
      });
      const legacy = configs.compareAndSetScopeField(
        created.id,
        'allowedSkillsJson',
        '["one"]',
        '["two"]',
      );
      expect(legacy?.revision).toBe(1);

      const winner = configs.compareAndSetScopeFieldAtRevision(
        created.id,
        'allowedSkillsJson',
        '["two"]',
        1,
        '["one"]',
      );
      expect(winner).toMatchObject({ allowedSkillsJson: '["one"]', revision: 2 });

      const stale = configs.compareAndSetScopeFieldAtRevision(
        created.id,
        'allowedSkillsJson',
        '["one"]',
        0,
        '["stale"]',
      );
      expect(stale).toBeNull();
      expect(configs.getById(created.id)).toMatchObject({
        allowedSkillsJson: '["one"]',
        revision: 2,
      });
      db.close();
    });
  });

  describe('B5 revision-bound intermediate human scope claim', () => {
    async function setupClaim(db: Database.Database, suffix: string) {
      setDb(db);
      const proposals = new AgentOrgProposalsRepository(db);
      const changeJson = ` { "agentConfigId": "claim-target-${suffix}", "field": "allowedSkillsJson", "add": ["x"] } `;
      const snapshotJson = `{"version":"scope-state-v2","targetId":"claim-target-${suffix}"}`;
      const proposal = await proposals.createAsync({
        id: `scope-claim-${suffix}`,
        kind: 'broaden-scope',
        risk: 'high',
        title: `Scope claim ${suffix}`,
        changeJson,
      });
      const validateSnapshot = (material: {
        expectedKind: string;
        expectedChangeJson: string;
        beforeSnapshotJson: string;
      }) => material.expectedKind === 'broaden-scope' &&
        material.expectedChangeJson === changeJson &&
        material.beforeSnapshotJson === snapshotJson;
      return { proposals, proposal, changeJson, snapshotJson, validateSnapshot };
    }

    it('forbids generic scope approved-to-applied outside the atomic target pair', async () => {
      const db = makeDb();
      const state = await setupClaim(db, 'generic-applied-bypass');
      const approved = await state.proposals.claimScopeApprovedWithSnapshotAsync({
        id: state.proposal.id,
        decidedByUserId: 0,
        expectedRevision: state.proposal.revision,
        expectedKind: 'broaden-scope',
        expectedChangeJson: state.changeJson,
        beforeSnapshotJson: state.snapshotJson,
        validateSnapshot: state.validateSnapshot,
      });

      await expect(state.proposals.updateStatusAtRevisionAsync(
        approved!.id,
        approved!.revision,
        'applied',
      )).rejects.toThrow(/scope|atomic|applied/i);
      expect(await state.proposals.findByIdAsync(approved!.id)).toEqual(approved);
      db.close();
    });

    it('allows exactly one concurrent approved claim and retains exact bound bytes', async () => {
      // Regression caught: a read-then-write claim lets two actors win or
      // exposes applied before the target transaction has happened.
      const db = makeDb();
      const state = await setupClaim(db, 'winner');
      const base = {
        id: state.proposal.id,
        expectedRevision: state.proposal.revision,
        expectedKind: 'broaden-scope' as const,
        expectedChangeJson: state.changeJson,
        beforeSnapshotJson: state.snapshotJson,
        validateSnapshot: state.validateSnapshot,
      };

      const [first, second] = await Promise.all([
        state.proposals.claimScopeApprovedWithSnapshotAsync({ ...base, decidedByUserId: 7 }),
        state.proposals.claimScopeApprovedWithSnapshotAsync({ ...base, decidedByUserId: 8 }),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
      expect([first, second].filter((row) => row === null)).toHaveLength(1);
      expect(await state.proposals.findByIdAsync(state.proposal.id)).toMatchObject({
        status: 'approved',
        revision: 1,
        kind: 'broaden-scope',
        changeJson: state.changeJson,
        beforeSnapshotJson: state.snapshotJson,
      });
      expect([7, 8]).toContain(
        (await state.proposals.findByIdAsync(state.proposal.id))?.decidedByUserId,
      );
      db.close();
    });

    it('rejects omitted/null change or snapshot, unsafe actor, and failed validation before effects', async () => {
      // Regression caught: the direct claim persists an arbitrary or legacy
      // snapshot/change pair that package C cannot safely apply or revert.
      const invalidCases: Array<(base: Record<string, unknown>) => Record<string, unknown>> = [
        (base) => ({ ...base, expectedChangeJson: undefined }),
        (base) => ({ ...base, expectedChangeJson: null }),
        (base) => ({ ...base, beforeSnapshotJson: undefined }),
        (base) => ({ ...base, beforeSnapshotJson: null }),
        (base) => ({ ...base, decidedByUserId: Number.MAX_SAFE_INTEGER + 1 }),
        (base) => ({ ...base, validateSnapshot: () => false }),
        (base) => ({ ...base, validateSnapshot: async () => false }),
      ];
      for (const [index, mutate] of invalidCases.entries()) {
        const db = makeDb();
        const state = await setupClaim(db, `invalid-${index}`);
        const base = {
          id: state.proposal.id,
          decidedByUserId: 7,
          expectedRevision: state.proposal.revision,
          expectedKind: 'broaden-scope',
          expectedChangeJson: state.changeJson,
          beforeSnapshotJson: state.snapshotJson,
          validateSnapshot: state.validateSnapshot,
        };

        await expect(
          (state.proposals.claimScopeApprovedWithSnapshotAsync as any)(mutate(base)),
        ).rejects.toThrow(/actor|change|snapshot|valid/i);
        expect(await state.proposals.findByIdAsync(state.proposal.id)).toEqual(state.proposal);
        db.close();
      }
    });

    it('returns null with zero mutation for stale revision, wrong kind, or changed stored bytes', async () => {
      // Regression caught: conditional SQL omits one binding dimension and a
      // stale/mislabeled human claim captures a different durable proposal.
      const misses = [
        { expectedRevision: 99 },
        { expectedKind: 'refine-scope' as const },
        { expectedChangeJson: '{"different":true}' },
      ];
      for (const [index, override] of misses.entries()) {
        const db = makeDb();
        const state = await setupClaim(db, `miss-${index}`);
        const result = await state.proposals.claimScopeApprovedWithSnapshotAsync({
          id: state.proposal.id,
          decidedByUserId: 7,
          expectedRevision: state.proposal.revision,
          expectedKind: 'broaden-scope',
          expectedChangeJson: state.changeJson,
          beforeSnapshotJson: state.snapshotJson,
          validateSnapshot: () => true,
          ...override,
        });
        expect(result).toBeNull();
        expect(await state.proposals.findByIdAsync(state.proposal.id)).toEqual(state.proposal);
        db.close();
      }
    });

    it('rejects omitted or changed binding material through the legacy scope seam', async () => {
      // Regression caught by the parent probe: the three-argument legacy
      // method claims a scope proposal with an unrelated snapshot.
      const db = makeDb();
      const state = await setupClaim(db, 'legacy-guard');

      await expect(state.proposals.claimAppliedWithSnapshotAsync(
        state.proposal.id,
        7,
        '{"arbitrary":"not-a-v2-snapshot"}',
        state.changeJson,
      )).rejects.toThrow(/scope|legacy|approved|atomic/i);
      expect(await state.proposals.findByIdAsync(state.proposal.id)).toEqual(state.proposal);

      await expect(
        state.proposals.claimAppliedWithSnapshotAsync(
          state.proposal.id,
          7,
          state.snapshotJson,
        ),
      ).rejects.toThrow(/scope|change|binding/i);
      expect(await state.proposals.findByIdAsync(state.proposal.id)).toEqual(state.proposal);

      await expect(state.proposals.claimAppliedWithSnapshotAsync(
        state.proposal.id,
        7,
        state.snapshotJson,
        '{"different":true}',
      )).rejects.toThrow(/scope|legacy|approved|atomic/i);
      expect(await state.proposals.findByIdAsync(state.proposal.id)).toEqual(state.proposal);
      db.close();
    });
  });

  describe('B9 no scope proposal reaches applied outside the atomic pair', () => {
    it.each(['proposed', 'failed'] as const)(
      'refuses a generic %s -> applied scope transition and never touches the target',
      async (sourceStatus) => {
        // Regression caught: the guard only covered approved->applied, but the
        // state machine also permits proposed->applied and failed->applied, so
        // a scope proposal could walk to applied/measuring/active while
        // agent_configs kept its prior bytes and no target CAS ever ran.
        const db = makeDb();
        setDb(db);
        const configs = new AgentConfigsRepository();
        const target = configs.insert({
          id: `b9-target-${sourceStatus}`,
          label: 'B9 target',
          icon: 'shield',
          allowedSkillsJson: '["base"]',
        });
        const proposals = new AgentOrgProposalsRepository(db);
        const proposal = await proposals.createAsync({
          id: `b9-proposal-${sourceStatus}`,
          kind: 'refine-scope',
          risk: 'high',
          title: 'B9 proposal',
          changeJson: JSON.stringify({
            scopePatch: { agentConfigId: target.id, field: 'allowedSkillsJson', add: ['granted'] },
          }),
        });
        if (sourceStatus === 'failed') {
          expect((await proposals.updateStatusAsync(proposal.id, 'failed'))?.status).toBe('failed');
        }

        await expect(proposals.updateStatusAsync(proposal.id, 'applied')).rejects.toThrow(
          /atomic target pair primitive/,
        );
        expect((await proposals.findByIdAsync(proposal.id))?.status).toBe(sourceStatus);
        expect(configs.getById(target.id)?.allowedSkillsJson).toBe('["base"]');
        db.close();
      },
    );
  });

  describe('B10 revisions move forward only', () => {
    it('refuses a raw revision rollback that would revive a stale CAS token', async () => {
      // Regression caught: the domain guard checked only the value range, so
      // raw SQL could roll a revision back. Bytes A -> B -> A with the
      // revision restored let a caller holding the original token win a
      // revision-bound CAS over history it never observed.
      const db = makeDb();
      setDb(db);
      const configs = new AgentConfigsRepository();
      const target = configs.insert({
        id: 'b10-target', label: 'B10 target', icon: 'shield', allowedSkillsJson: '["A"]',
      });
      const token = { revision: target.revision, bytes: target.allowedSkillsJson };

      const bumped = configs.update(target.id, { allowedSkillsJson: '["B"]' })!;
      expect(bumped.revision).toBe(token.revision + 1);

      expect(() => db.prepare(
        'UPDATE agent_configs SET allowed_skills_json = ?, revision = ? WHERE id = ?',
      ).run('["A"]', token.revision, target.id)).toThrow(/revision/i);
      expect(configs.getById(target.id)).toMatchObject({
        allowedSkillsJson: '["B"]',
        revision: token.revision + 1,
      });

      // The stale token can therefore never win.
      expect(configs.compareAndSetScopeFieldAtRevision(
        target.id, 'allowedSkillsJson', token.bytes, token.revision, '["A","late-grant"]',
      )).toBeNull();
      db.close();
    });

    it('still allows a forward explicit revision write and the raw-writer auto-bump', () => {
      const db = makeDb();
      setDb(db);
      const configs = new AgentConfigsRepository();
      const target = configs.insert({ id: 'b10-forward', label: 'B10 forward', icon: 'shield' });
      db.prepare('UPDATE agent_configs SET revision = revision + 1 WHERE id = ?').run(target.id);
      expect(configs.getById(target.id)?.revision).toBe(target.revision + 1);
      db.prepare(`UPDATE agent_configs SET label = 'raw' WHERE id = ?`).run(target.id);
      expect(configs.getById(target.id)).toMatchObject({
        label: 'raw',
        revision: target.revision + 2,
      });
      db.close();
    });
  });

  describe('B8 engine parity for the revision invariants', () => {
    it.each([
      { label: 'negative', value: -1 },
      { label: 'fractional', value: 1.5 },
      { label: 'infinite', value: Infinity },
      { label: 'unsafe', value: Number.MAX_SAFE_INTEGER + 1 },
      { label: 'string', value: '3' },
    ])('refuses to map a $label persisted revision', ({ value }) => {
      // Defense in depth behind the schema triggers: the hosted Postgres
      // engine and any hand-repaired row still reach the caller through this
      // mapper, and a CAS token that never described the stored bytes must
      // never be handed out as a plausible number.
      expect(() => readPersistedRevision(value, 'probe revision')).toThrow(
        /unsafe persisted revision/,
      );
    });

    it('maps only the legacy pre-column shape to revision zero', () => {
      expect(readPersistedRevision(undefined, 'probe revision')).toBe(0);
      expect(readPersistedRevision(null, 'probe revision')).toBe(0);
      expect(readPersistedRevision(0, 'probe revision')).toBe(0);
      expect(readPersistedRevision(7, 'probe revision')).toBe(7);
    });

    const sqliteSource = readFileSync(
      join(__dirname, '..', 'database', 'migrations.ts'),
      'utf8',
    );
    const postgresSource = readFileSync(
      join(__dirname, '..', 'database', 'postgres_bootstrap.ts'),
      'utf8',
    );

    it('installs the SQLite invariants before any seed or content repair can write', () => {
      // Regression caught: the revision column/triggers were installed at the
      // end of runMigrations, so every profile repair above them mutated rows
      // while the lifecycle CAS token was missing or unguarded.
      const install = sqliteSource.indexOf("installRevisionInvariants(db, 'agent_configs')");
      const seed = sqliteSource.indexOf('INSERT OR IGNORE INTO agent_configs');
      const relabel = sqliteSource.indexOf("label      = 'OpenRouter'");
      expect(install).toBeGreaterThan(-1);
      expect(seed).toBeGreaterThan(install);
      expect(relabel).toBeGreaterThan(install);
      expect(
        sqliteSource.indexOf("installRevisionInvariants(db, 'agent_org_proposals')"),
      ).toBeGreaterThan(-1);
    });

    it('gives Postgres the same non-negative domain and raw-writer auto-bump', () => {
      // Regression caught: the invariants existed only on the local SQLite
      // engine, so the hosted engine accepted negative revisions and let raw
      // writers leave a stale CAS token valid.
      expect(postgresSource).toMatch(
        /agent_configs_revision_non_negative CHECK \(revision >= 0\)/,
      );
      expect(postgresSource).toMatch(
        /agent_org_proposals_revision_non_negative CHECK \(revision >= 0\)/,
      );
      expect(postgresSource).toMatch(
        /IF NEW\.revision = OLD\.revision THEN\s+NEW\.revision := OLD\.revision \+ 1;/,
      );
      expect(postgresSource).toMatch(
        /ELSIF NEW\.revision < OLD\.revision THEN\s+RAISE EXCEPTION/,
      );
      for (const table of ['agent_configs', 'agent_org_proposals']) {
        expect(postgresSource).toContain(
          `DROP TRIGGER IF EXISTS trg_${table}_revision_autobump ON ${table};`,
        );
        expect(postgresSource).toMatch(
          new RegExp(
            `CREATE TRIGGER trg_${table}_revision_autobump\\s+BEFORE UPDATE ON ${table}`,
          ),
        );
      }
    });
  });

  describe('B7 migration writers and stored revision domain', () => {
    it('advances config revision when a rerun migration changes projected profile state', () => {
      // Regression caught: a raw migration writer relabels the profile without
      // touching `revision`, so a lifecycle caller holding the pre-repair token
      // can still commit a revision-fenced write against bytes it never read.
      // Install-time repairs legitimately advance the seeded row, so the
      // assertion is a delta — which also fails on a double increment.
      const db = makeDb();
      setDb(db);
      const configs = new AgentConfigsRepository();
      const seeded = configs.getById('opencode');
      expect(seeded).not.toBeNull();
      const baseline = seeded!.revision;

      const edited = configs.update('opencode', { label: 'OpenCode' });
      expect(edited).toMatchObject({ label: 'OpenCode', revision: baseline + 1 });

      runMigrations(db);

      expect(configs.getById('opencode')).toMatchObject({
        label: 'OpenRouter',
        revision: baseline + 2,
      });
      db.close();
    });

    it('does not inflate revisions when migrations replay with nothing to repair', () => {
      // Regression caught: an auto-bump that fires on every no-op migration
      // write churns the CAS token on each boot, invalidating live tokens and
      // masking real drift.
      const db = makeDb();
      const read = () => db
        .prepare('SELECT id, revision FROM agent_configs ORDER BY id')
        .all();
      const before = read();
      runMigrations(db);
      runMigrations(db);
      expect(read()).toEqual(before);
      db.close();
    });

    it.each([
      { label: 'negative', value: -1 },
      { label: 'fractional', value: 1.5 },
      { label: 'infinite', value: Infinity },
      { label: 'unsafe', value: Number.MAX_SAFE_INTEGER + 1 },
    ])('rejects $label stored revisions for both mutable tables', async ({ value }) => {
      const db = makeDb();
      setDb(db);
      const configs = new AgentConfigsRepository();
      const config = configs.insert({
        id: `revision-domain-config-${String(value)}`,
        label: 'Revision domain config',
        icon: 'shield',
      });
      const proposals = new AgentOrgProposalsRepository(db);
      const proposal = await proposals.createAsync({
        id: `revision-domain-proposal-${String(value)}`,
        kind: 'refine-config',
        risk: 'low',
        title: 'Revision domain proposal',
      });

      expect(() => db.prepare(
        'UPDATE agent_configs SET revision = ? WHERE id = ?',
      ).run(value, config.id)).toThrow(/revision|constraint|integer/i);
      expect(() => db.prepare(
        'UPDATE agent_org_proposals SET revision = ? WHERE id = ?',
      ).run(value, proposal.id)).toThrow(/revision|constraint|integer/i);
      expect(configs.getById(config.id)?.revision).toBe(0);
      expect((await proposals.findByIdAsync(proposal.id))?.revision).toBe(0);
      db.close();
    });
  });
});
