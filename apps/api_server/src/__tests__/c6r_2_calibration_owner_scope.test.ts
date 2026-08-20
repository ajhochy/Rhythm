/**
 * C6 (repair) item 2 — owner-scoped immutable calibration.
 *
 * docs/ai/contracts/issue-c6.json, criterion c6r-2. Proves the nullable-
 * owner scope contract on `calibration_observations`
 * (CalibrationOwnerScope, owner_id, source_event_id, observation_type,
 * proposal_id, experiment_id) added on top of the C6-1 ledger: owner
 * isolation, duplicate-event idempotency (per scope), the additive
 * migration backfill for a pre-repair-shape database, and that the new
 * columns remain covered by the same immutability triggers as every other
 * column.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { CalibrationObservationsRepository } from '../repositories/calibration_observations_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';

let db: Database.Database;
let originalCalibrationEnabled: boolean;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  // Real owner rows exercise historical owner provenance and deletion.
  db.prepare(`INSERT INTO users (id, name, email) VALUES (1, 'Owner One', 'owner1@example.test')`).run();
  db.prepare(`INSERT INTO users (id, name, email) VALUES (2, 'Owner Two', 'owner2@example.test')`).run();
  db.prepare(`INSERT INTO users (id, name, email) VALUES (5, 'Owner Five', 'owner5@example.test')`).run();
  originalCalibrationEnabled = env.calibrationEnabled;
  env.calibrationEnabled = true;
});

afterEach(() => {
  env.calibrationEnabled = originalCalibrationEnabled;
});

const FAMILY = {
  generatorVersion: 'gen-v1',
  detectorVersion: 'det-v1',
  kind: 'refine-config',
  treatmentVersion: 'system-prompt-v1',
  metricVersion: 'objective-success-rate-v1',
};

describe('C6 item 2 — AgentOrgProposal exposes the durable owner_user_id column', () => {
  it('a proposal created with ownerUserId round-trips through the real repository insert/read path', async () => {
    const repo = new AgentOrgProposalsRepository();
    const created = await repo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'owner-scoped proposal',
      ownerUserId: 1,
    });
    expect(created.ownerUserId).toBe(1);

    const reread = await repo.findByIdAsync(created.id);
    expect(reread!.ownerUserId).toBe(1);
  });

  it('a proposal created without ownerUserId is system-global (null), never inferred', async () => {
    const repo = new AgentOrgProposalsRepository();
    const created = await repo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      title: 'system-global proposal',
    });
    expect(created.ownerUserId).toBeNull();
  });
});

describe('C6 item 2 — owner isolation', () => {
  it('a system-global list never returns an owner-scoped row, and vice versa', async () => {
    const repo = new CalibrationObservationsRepository();
    await repo.createAsync({
      ...FAMILY,
      scope: { kind: 'owner', ownerId: 1 },
      sourceEventId: 'owner-1-event',
      observationType: 'experiment-decision',
      proposalId: 'p1',
      initialConfidence: 0.5,
      humanDecision: null,
    });
    await repo.createAsync({
      ...FAMILY,
      scope: { kind: 'system-global' },
      sourceEventId: 'system-event',
      observationType: 'experiment-decision',
      proposalId: 'p2',
      initialConfidence: 0.5,
      humanDecision: null,
    });

    const ownerRows = await repo.listByFamilyAsync(
      { kind: 'owner', ownerId: 1 },
      FAMILY.generatorVersion, FAMILY.detectorVersion, FAMILY.kind, FAMILY.treatmentVersion, FAMILY.metricVersion,
    );
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0].sourceEventId).toBe('owner-1-event');

    const globalRows = await repo.listByFamilyAsync(
      { kind: 'system-global' },
      FAMILY.generatorVersion, FAMILY.detectorVersion, FAMILY.kind, FAMILY.treatmentVersion, FAMILY.metricVersion,
    );
    expect(globalRows).toHaveLength(1);
    expect(globalRows[0].sourceEventId).toBe('system-event');
  });

  it('two different owners never see each other\'s rows for the family', async () => {
    const repo = new CalibrationObservationsRepository();
    await repo.createAsync({
      ...FAMILY,
      scope: { kind: 'owner', ownerId: 1 },
      sourceEventId: 'owner-1-only',
      observationType: 'experiment-decision',
      proposalId: 'p1',
      initialConfidence: 0.5,
      humanDecision: null,
    });

    const owner2Rows = await repo.listByFamilyAsync(
      { kind: 'owner', ownerId: 2 },
      FAMILY.generatorVersion, FAMILY.detectorVersion, FAMILY.kind, FAMILY.treatmentVersion, FAMILY.metricVersion,
    );
    expect(owner2Rows).toHaveLength(0);
  });
});

describe('C6 item 2 — duplicate-event idempotency', () => {
  it('creating the same (scope, sourceEventId, observationType) twice returns the SAME row, never a duplicate', async () => {
    const repo = new CalibrationObservationsRepository();
    const first = await repo.createAsync({
      ...FAMILY,
      scope: { kind: 'system-global' },
      sourceEventId: 'idempotent-event',
      observationType: 'experiment-decision',
      proposalId: 'p1',
      initialConfidence: 0.5,
      humanDecision: null,
    });
    const second = await repo.createAsync({
      ...FAMILY,
      scope: { kind: 'system-global' },
      sourceEventId: 'idempotent-event',
      observationType: 'experiment-decision',
      proposalId: 'p1',
      // A different confidence/decision on the retry attempt must NOT
      // overwrite the original row — proves this is idempotent-create, not
      // an upsert.
      initialConfidence: 0.99,
      humanDecision: 'changed-mind',
    });
    expect(second!.id).toBe(first!.id);
    expect(second!.initialConfidence).toBe(0.5);
    expect(second!.humanDecision).toBeNull();

    const rowCount = db
      .prepare(`SELECT COUNT(*) as n FROM calibration_observations WHERE source_event_id = ?`)
      .get('idempotent-event') as { n: number };
    expect(rowCount.n).toBe(1);
  });

  it('the SAME sourceEventId+observationType is NOT deduped across two different owners', async () => {
    const repo = new CalibrationObservationsRepository();
    const owner1 = await repo.createAsync({
      ...FAMILY,
      scope: { kind: 'owner', ownerId: 1 },
      sourceEventId: 'shared-event-id',
      observationType: 'experiment-decision',
      proposalId: 'p1',
      initialConfidence: 0.5,
      humanDecision: null,
    });
    const owner2 = await repo.createAsync({
      ...FAMILY,
      scope: { kind: 'owner', ownerId: 2 },
      sourceEventId: 'shared-event-id',
      observationType: 'experiment-decision',
      proposalId: 'p1',
      initialConfidence: 0.7,
      humanDecision: null,
    });
    expect(owner1!.id).not.toBe(owner2!.id);
    expect(owner1!.initialConfidence).toBe(0.5);
    expect(owner2!.initialConfidence).toBe(0.7);
  });

  it('the same sourceEventId is NOT deduped across two different observationTypes', async () => {
    const repo = new CalibrationObservationsRepository();
    const decision = await repo.createAsync({
      ...FAMILY,
      scope: { kind: 'system-global' },
      sourceEventId: 'multi-type-event',
      observationType: 'experiment-decision',
      proposalId: 'p1',
      initialConfidence: 0.5,
      humanDecision: null,
    });
    const regression = await repo.createAsync({
      ...FAMILY,
      scope: { kind: 'system-global' },
      sourceEventId: 'multi-type-event',
      observationType: 'post-deploy-regression',
      proposalId: 'p1',
      initialConfidence: 0.5,
      humanDecision: null,
    });
    expect(decision!.id).not.toBe(regression!.id);
  });
});

describe('C6 item 2 — additive migration backfill for a pre-repair-shape database', () => {
  it('backfills owner NULL, source_event_id = id, observation_type = legacy for rows created under the old schema', () => {
    // Simulate a database that already created calibration_observations
    // under the pre-repair shape (before owner_id/source_event_id/
    // observation_type/proposal_id/experiment_id existed) and had a real
    // row in it, then re-run runMigrations — the exact upgrade path a
    // developer's pre-existing local SQLite file would take.
    const legacyDb = new Database(':memory:');
    legacyDb.pragma('foreign_keys = ON');
    legacyDb.exec(`
      CREATE TABLE calibration_observations (
        id TEXT PRIMARY KEY,
        generator_version TEXT NOT NULL,
        detector_version TEXT NOT NULL,
        kind TEXT NOT NULL,
        treatment_version TEXT NOT NULL,
        metric_version TEXT NOT NULL,
        initial_confidence REAL NOT NULL,
        human_decision TEXT,
        experiment_decision TEXT,
        experiment_effect REAL,
        post_deploy_regression REAL,
        revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TRIGGER calibration_observations_no_update
      BEFORE UPDATE ON calibration_observations
      BEGIN
        SELECT RAISE(ABORT, 'calibration observations are immutable once recorded');
      END;
    `);
    legacyDb
      .prepare(
        `INSERT INTO calibration_observations
           (id, generator_version, detector_version, kind, treatment_version, metric_version, initial_confidence, human_decision)
         VALUES ('legacy-row-1', 'gen-v0', 'det-v0', 'refine-config', 'system-prompt-v1', 'objective-success-rate-v1', 0.5, NULL)`,
      )
      .run();

    runMigrations(legacyDb);

    const row = legacyDb
      .prepare(`SELECT * FROM calibration_observations WHERE id = 'legacy-row-1'`)
      .get() as Record<string, unknown>;
    expect(row.owner_id).toBeNull();
    expect(row.source_event_id).toBe('legacy-row-1');
    expect(row.observation_type).toBe('legacy');

    // The immutability guard survives the drop/recreate the backfill needed.
    expect(() =>
      legacyDb.prepare(`UPDATE calibration_observations SET initial_confidence = 0.99 WHERE id = 'legacy-row-1'`).run(),
    ).toThrow(/immutable/);

    legacyDb.close();
  });
});

describe('C6 item 2 — the new columns stay covered by the existing immutability triggers', () => {
  it('a raw UPDATE targeting owner_id specifically is still rejected', async () => {
    const repo = new CalibrationObservationsRepository();
    const created = await repo.createAsync({
      ...FAMILY,
      scope: { kind: 'owner', ownerId: 5 },
      sourceEventId: 'immutable-owner-test',
      observationType: 'experiment-decision',
      proposalId: 'p1',
      initialConfidence: 0.5,
      humanDecision: null,
    });
    expect(() =>
      db.prepare(`UPDATE calibration_observations SET owner_id = 9 WHERE id = ?`).run(created!.id),
    ).toThrow(/immutable/);
  });

  it('keeps historical owner provenance without blocking user deletion', async () => {
    const created = await new CalibrationObservationsRepository().createAsync({
      ...FAMILY,
      scope: { kind: 'owner', ownerId: 5 },
      sourceEventId: 'deleted-owner-history',
      observationType: 'experiment-decision',
      proposalId: 'p1',
      initialConfidence: 0.5,
      humanDecision: null,
    });

    db.prepare(`DELETE FROM users WHERE id = 5`).run();

    expect(db.prepare(`SELECT id FROM users WHERE id = 5`).get()).toBeUndefined();
    expect(
      (db.prepare(`SELECT owner_id FROM calibration_observations WHERE id = ?`).get(created!.id) as { owner_id: number }).owner_id,
    ).toBe(5);
  });
});
