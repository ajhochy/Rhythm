/**
 * C1 — pre-run episode enrollment.
 *
 * Today (base commit) cohort assignment happens at run FINALIZATION
 * (`resolveRunEnrollment`, called from `recordTerminalOutcome`). There is no
 * record of a reservation made BEFORE dispatch, so nothing can gate treatment
 * application on "did this exact run episode already reserve a cohort" or
 * enforce the exposure cap atomically against reservations rather than
 * finished runs.
 *
 * This is the first RED test for C1: a dedicated reservation keyed by a
 * stable `runEpisodeId`, persisted before any run outcome exists, and
 * idempotent per episode (reserving the same episode twice never mints a
 * second cohort assignment — a retried dispatch for the same episode must see
 * the original commitment, not a fresh coin flip).
 */

import Database from 'better-sqlite3';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentOrgExperimentsRepository } from '../agent_org_experiments_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../agent_org_experiment_enrollments_repository';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

async function declaredExperiment(overrides: { maxExposure?: number } = {}) {
  const experiments = new AgentOrgExperimentsRepository();
  return experiments.declareAsync({
    proposalId: 'prop-1',
    adapter: 'paired-cohort-outcome',
    evidenceBundleJson: JSON.stringify({ version: 'proposal-evidence-v1' }),
    baselineSpecJson: JSON.stringify({ configRevision: 4 }),
    candidateSpecJson: JSON.stringify({ configRevision: 5 }),
    assignmentKey: 'exp-key-1',
    stoppingRule: { minSamplesPerCohort: 10, minEffect: 0.05 },
    maxExposure: overrides.maxExposure ?? 20,
  });
}

function seedEnrollment(params: {
  experimentId: string;
  proposalId: string;
  runEpisodeId: string;
  state: 'reserved' | 'dispatched' | 'treatment_failed' | 'terminalized';
}) {
  db.prepare(
    `INSERT INTO agent_org_experiment_enrollments
       (id, run_episode_id, experiment_id, proposal_id, profile_id, cohort,
        assignment_digest, baseline_target_revision_hash, treatment_spec_hash, state, reserved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `seed-${params.runEpisodeId}`,
    params.runEpisodeId,
    params.experimentId,
    params.proposalId,
    'seed-profile',
    'baseline',
    `digest-${params.runEpisodeId}`,
    `rev-${params.runEpisodeId}`,
    `spec-${params.runEpisodeId}`,
    params.state,
    new Date().toISOString(),
  );
}

function countActiveReservations(experimentId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM agent_org_experiment_enrollments
       WHERE experiment_id = ? AND state IN ('reserved','dispatched')`,
    )
    .get(experimentId) as { n: number };
  return row.n;
}

function countReservations(experimentId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) as n FROM agent_org_experiment_enrollments WHERE experiment_id = ?`)
    .get(experimentId) as { n: number };
  return row.n;
}

function makeTempEnrollmentDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c1-c-a-'));
  return path.join(dir, 'agent-org-experiment-enrollments.sqlite');
}

function cleanupTempEnrollmentDb(dbPath: string, ...extraFiles: string[]): void {
  extraFiles.forEach((extraFile) => {
    if (fs.existsSync(extraFile)) fs.unlinkSync(extraFile);
  });
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  const parentDir = path.dirname(dbPath);
  if (fs.existsSync(parentDir)) {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
}

function seedEnrollmentRow(
  dbConn: Database.Database,
  params: {
    id: string;
    runEpisodeId: string;
    experimentId: string;
    proposalId: string;
    state: string;
  },
) {
  dbConn
    .prepare(
      `INSERT INTO agent_org_experiment_enrollments
         (id, run_episode_id, experiment_id, proposal_id, profile_id, cohort,
          assignment_digest, baseline_target_revision_hash, treatment_spec_hash, state, reserved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.id,
      params.runEpisodeId,
      params.experimentId,
      params.proposalId,
      'profile-1',
      'baseline',
      `seed-digest-${params.runEpisodeId}`,
      `seed-rev-${params.runEpisodeId}`,
      `seed-spec-${params.runEpisodeId}`,
      params.state,
      new Date().toISOString(),
    );
}

interface WorkerResult {
  workerId: string;
  reachedReserveAsync: boolean;
  outcome: 'reserved' | 'refused' | 'error';
  reservation: {
    id: string;
    runEpisodeId: string;
    experimentId: string;
    proposalId: string;
    profileId: string;
    cohort: 'baseline' | 'candidate';
    assignmentDigest: string;
    baselineTargetRevisionHash: string;
    treatmentSpecHash: string;
    state: 'reserved' | 'dispatched' | 'treatment_failed' | 'terminalized';
    reservedAt: string;
  } | null;
  error?: {
    name: string;
    message: string;
    code?: string;
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForWorkerReady(readyDir: string, workerIds: string[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (workerIds.every((workerId) => fs.existsSync(path.join(readyDir, `${workerId}.ready`)))) {
      return;
    }
    await sleep(10);
  }

  throw new Error('SQLite contention test timed out waiting for worker readiness barrier');
}

function spawnReservationWorker(
  dbPath: string,
  workerId: string,
  runEpisodeId: string,
  experimentId: string,
  proposalId: string,
  cohort: 'baseline' | 'candidate',
  readyDir: string,
  goFile: string,
): { child: ChildProcess; resultPromise: Promise<WorkerResult> } {
  const workerScript = path.join(__dirname, 'c1_c_a_reserve_worker.ts');
  const payload = JSON.stringify({
    dbPath,
    workerId,
    runEpisodeId,
    experimentId,
    proposalId,
    cohort,
    readyDir,
    goFile,
    maxExposure: 1,
    barrierTimeoutMs: 4000,
    profileId: `profile-${workerId}`,
    assignmentDigest: `digest-${workerId}`,
    baselineTargetRevisionHash: `rev-${workerId}`,
    treatmentSpecHash: `spec-${workerId}`,
  });

  const child = spawn(process.execPath, ['--import', 'tsx', workerScript], {
    env: {
      ...process.env,
      C1_C_A_RESERVE_WORKER: payload,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const output: string[] = [];

  const resultPromise = new Promise<WorkerResult>((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output.push(chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      output.push(chunk.toString());
    });

    child.on('error', reject);

    child.on('close', (code) => {
      try {
        const lines = output.join('');
        const jsonLines = lines
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('{') && line.endsWith('}'));
        const resultLine = jsonLines[jsonLines.length - 1];

        if (!resultLine) {
          reject(new Error(`Worker ${workerId} produced no JSON result. Output: ${lines}`));
          return;
        }

        const parsed = JSON.parse(resultLine) as WorkerResult;
        if (code !== 0) {
          reject(new Error(`Worker ${workerId} exited ${code} with payload ${resultLine}`));
          return;
        }
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse worker result for ${workerId}: ${String(err)}. Output: ${output.join('')}`));
      }
    });
  });

  return { child, resultPromise };
}

function spawnTimeoutPromise<T>(ms: number): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error(`Worker did not complete within timeout (${ms}ms)`));
    }, ms);
  });
}

function cleanupChildren(children: ChildProcess[]): void {
  for (const child of children) {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
}

describe('C1 pre-run enrollment reservation', () => {
  it('persists a reservation keyed by a stable runEpisodeId before any outcome exists', async () => {
    const experiment = await declaredExperiment();
    const enrollments = new AgentOrgExperimentEnrollmentsRepository();

    const reserved = await enrollments.reserveAsync({
      maxExposure: experiment.maxExposure,
      runEpisodeId: 'episode-1',
      experimentId: experiment.id,
      proposalId: experiment.proposalId,
      profileId: 'profile-1',
      cohort: 'baseline',
      assignmentDigest: 'digest-1',
      baselineTargetRevisionHash: 'rev-hash-1',
      treatmentSpecHash: 'spec-hash-1',
    });

    expect(reserved).not.toBeNull();
    expect(reserved!.runEpisodeId).toBe('episode-1');
    expect(reserved!.cohort).toBe('baseline');
    expect(reserved!.state).toBe('reserved');
    expect(reserved!.baselineTargetRevisionHash).toBe('rev-hash-1');
    expect(reserved!.treatmentSpecHash).toBe('spec-hash-1');

    const found = await enrollments.findByRunEpisodeIdAsync('episode-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(reserved!.id);
  });

  it('is idempotent per run episode — reserving the same episode twice returns the original cohort', async () => {
    const experiment = await declaredExperiment({ maxExposure: 1 });
    const enrollments = new AgentOrgExperimentEnrollmentsRepository();

    const first = await enrollments.reserveAsync({
      maxExposure: experiment.maxExposure,
      runEpisodeId: 'episode-2',
      experimentId: experiment.id,
      proposalId: experiment.proposalId,
      profileId: 'profile-1',
      cohort: 'candidate',
      assignmentDigest: 'digest-2',
      baselineTargetRevisionHash: 'rev-hash-2',
      treatmentSpecHash: 'spec-hash-2',
    });

    // A retried dispatch for the SAME episode must never mint a second
    // reservation or flip the cohort — it must see the original commitment.
    const second = await enrollments.reserveAsync({
      maxExposure: experiment.maxExposure,
      runEpisodeId: 'episode-2',
      experimentId: experiment.id,
      proposalId: experiment.proposalId,
      profileId: 'profile-1',
      cohort: 'baseline',
      assignmentDigest: 'digest-2',
      baselineTargetRevisionHash: 'rev-hash-2',
      treatmentSpecHash: 'spec-hash-2',
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.id).toBe(first!.id);
    expect(second!.cohort).toBe('candidate');
    expect(second!.state).toBe('reserved');

    const all = db
      .prepare(`SELECT COUNT(*) as n FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
      .get('episode-2') as { n: number };
    expect(all.n).toBe(1);

    const denied = await enrollments.reserveAsync({
      maxExposure: experiment.maxExposure,
      runEpisodeId: 'episode-3',
      experimentId: experiment.id,
      proposalId: experiment.proposalId,
      profileId: 'profile-1',
      cohort: 'baseline',
      assignmentDigest: 'digest-3',
      baselineTargetRevisionHash: 'rev-hash-3',
      treatmentSpecHash: 'spec-hash-3',
    });
    expect(denied).toBeNull();

    const total = db
      .prepare(`SELECT COUNT(*) as n FROM agent_org_experiment_enrollments WHERE experiment_id = ?`)
      .get(experiment.id) as { n: number };
    expect(total.n).toBe(1);
  });

  it('proves SQLite cap enforcement under real cross-process contention on one temp file', async () => {
    // C1-C-A marker: this test proves SQLite cap behavior only.
    // C1-C-B state transition tests and Postgres parity are deferred.
    const dbPath = makeTempEnrollmentDbPath();
    const barrierDir = `${dbPath}-barrier`;
    const readyDir = path.join(barrierDir, 'ready');
    const goFile = path.join(barrierDir, 'start');
    fs.mkdirSync(readyDir, { recursive: true });

    const experimentId = 'experiment-0';
    const proposalId = 'proposal-0';

    const dbMaster = new Database(dbPath);
    dbMaster.pragma('foreign_keys = ON');
    runMigrations(dbMaster);
    dbMaster.close();

    const one = spawnReservationWorker(dbPath, 'one', 'episode-a', experimentId, proposalId, 'baseline', readyDir, goFile);
    const two = spawnReservationWorker(dbPath, 'two', 'episode-b', experimentId, proposalId, 'candidate', readyDir, goFile);

    const children: ChildProcess[] = [one.child, two.child];

    try {
      await waitForWorkerReady(readyDir, ['one', 'two'], 2500);
      fs.writeFileSync(goFile, 'go');

      const results = await Promise.all([
        Promise.race([one.resultPromise, spawnTimeoutPromise<WorkerResult>(9000)]),
        Promise.race([two.resultPromise, spawnTimeoutPromise<WorkerResult>(9000)]),
      ]);
      expect(results[0].reachedReserveAsync).toBe(true);
      expect(results[1].reachedReserveAsync).toBe(true);

      const successes = results.filter((result) => result.outcome === 'reserved');
      const losers = results.filter((result) => result.outcome !== 'reserved');

      expect(successes).toHaveLength(1);
      expect(losers).toHaveLength(1);

      expect(successes[0]!.reservation).not.toBeNull();
      expect(successes[0]!.reservation!.state).toBe('reserved');
      expect(successes[0]!.reservation!.experimentId).toBe(experimentId);
      expect(successes[0]!.reservation!.proposalId).toBe(proposalId);

      const loser = losers[0]!;
      expect(loser.outcome === 'refused' || loser.outcome === 'error').toBe(true);
      if (loser.outcome === 'error') {
        expect(loser.error).toBeDefined();
        expect(loser.error!.message).toMatch(/database is (?:busy|locked)|SQLITE_(?:BUSY|LOCKED)/i);
      } else {
        expect(loser.reservation).toBeNull();
      }

      const assertDb = new Database(dbPath);
      assertDb.pragma('foreign_keys = ON');
      const total = assertDb
        .prepare(`SELECT COUNT(*) as n FROM agent_org_experiment_enrollments WHERE experiment_id = ?`)
        .get(experimentId) as { n: number };
      const active = assertDb
        .prepare(
          `SELECT COUNT(*) as n FROM agent_org_experiment_enrollments
           WHERE experiment_id = ? AND state IN ('reserved', 'dispatched')`,
        )
        .get(experimentId) as { n: number };
      assertDb.close();

      expect(total.n).toBe(1);
      expect(active.n).toBe(1);
    } finally {
      cleanupChildren(children);
      if (fs.existsSync(goFile)) {
        fs.unlinkSync(goFile);
      }
      if (fs.existsSync(barrierDir)) {
        fs.rmSync(barrierDir, { recursive: true, force: true });
      }
      cleanupTempEnrollmentDb(dbPath);
    }
  });

  it('rejects invalid and lock-like future state writes on legacy enrollment tables', () => {
    const dbPath = makeTempEnrollmentDbPath();
    const legacyDb = new Database(dbPath);
    legacyDb.pragma('foreign_keys = ON');
    legacyDb.exec(`
      CREATE TABLE agent_org_experiment_enrollments (
        id TEXT PRIMARY KEY,
        run_episode_id TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        cohort TEXT NOT NULL,
        assignment_digest TEXT NOT NULL,
        baseline_target_revision_hash TEXT NOT NULL,
        treatment_spec_hash TEXT NOT NULL,
        state TEXT NOT NULL,
        reserved_at TEXT NOT NULL
      );
    `);

    seedEnrollmentRow(legacyDb, {
      id: 'legacy-invalid',
      runEpisodeId: 'legacy-invalid',
      experimentId: 'legacy-exp',
      proposalId: 'legacy-prop',
      state: 'invalid-legacy-state',
    });

    seedEnrollmentRow(legacyDb, {
      id: 'legacy-valid',
      runEpisodeId: 'legacy-valid',
      experimentId: 'legacy-exp',
      proposalId: 'legacy-prop',
      state: 'reserved',
    });

    expect(() => runMigrations(legacyDb)).not.toThrow();
    expect(() =>
      legacyDb.prepare(
        `INSERT INTO agent_org_experiment_enrollments
           (id, run_episode_id, experiment_id, proposal_id, profile_id, cohort, assignment_digest,
            baseline_target_revision_hash, treatment_spec_hash, state, reserved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'new-invalid',
        'new-invalid',
        'legacy-exp',
        'legacy-prop',
        'profile-1',
        'candidate',
        'digest',
        'rev',
        'spec',
        'bogus-state',
        new Date().toISOString(),
      ),
    ).toThrow();

    expect(() =>
      legacyDb
        .prepare(`UPDATE agent_org_experiment_enrollments SET state = ? WHERE id = ?`)
        .run('bad-state', 'legacy-valid'),
    ).toThrow();

    expect(() =>
      legacyDb
        .prepare(`UPDATE agent_org_experiment_enrollments SET state = ? WHERE id = ?`)
        .run('dispatched', 'legacy-valid'),
    ).not.toThrow();

    const updated = legacyDb
      .prepare(`SELECT state FROM agent_org_experiment_enrollments WHERE id = ?`)
      .get('legacy-valid') as { state: string };
    expect(updated.state).toBe('dispatched');

    legacyDb.close();
    cleanupTempEnrollmentDb(dbPath);
  });

  it('propagates write-lock/storage failures instead of returning null', async () => {
    const dbPath = makeTempEnrollmentDbPath();
    const holderDb = new Database(dbPath);
    const waiterDb = new Database(dbPath);
    holderDb.pragma('foreign_keys = ON');
    waiterDb.pragma('foreign_keys = ON');
    holderDb.pragma('busy_timeout = 0');
    waiterDb.pragma('busy_timeout = 0');
    runMigrations(holderDb);
    runMigrations(waiterDb);

    holderDb.exec('BEGIN IMMEDIATE');
    holderDb
      .prepare(
        `INSERT INTO agent_org_experiment_enrollments
           (id, run_episode_id, experiment_id, proposal_id, profile_id, cohort,
            assignment_digest, baseline_target_revision_hash, treatment_spec_hash, state, reserved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'holder-reservation',
        'holder-lock-episode',
        'experiment-locked',
        'proposal-locked',
        'profile-locked',
        'baseline',
        'holder-digest',
        'holder-rev',
        'holder-spec',
        'reserved',
        new Date().toISOString(),
      );

    try {
      const repo = new AgentOrgExperimentEnrollmentsRepository(waiterDb);
      await expect(
        repo.reserveAsync({
          maxExposure: 1,
          runEpisodeId: 'episode-locked',
          experimentId: 'experiment-locked',
          proposalId: 'proposal-locked',
          profileId: 'profile-locked',
          cohort: 'baseline',
          assignmentDigest: 'digest-locked',
          baselineTargetRevisionHash: 'rev-hash-locked',
          treatmentSpecHash: 'spec-hash-locked',
        }),
      ).rejects.toThrow(/database is locked|database is busy|SQLITE_(BUSY|LOCKED)/i);
    } finally {
      holderDb.exec('ROLLBACK');
      holderDb.close();
      waiterDb.close();
      cleanupTempEnrollmentDb(dbPath);
    }
  });

  it('does not consume capacity for terminalized or failed rows', async () => {
    const experiment = await declaredExperiment({ maxExposure: 1 });

    seedEnrollment({
      experimentId: experiment.id,
      proposalId: experiment.proposalId,
      runEpisodeId: 'legacy-terminalized',
      state: 'terminalized',
    });
    seedEnrollment({
      experimentId: experiment.id,
      proposalId: experiment.proposalId,
      runEpisodeId: 'legacy-failed',
      state: 'treatment_failed',
    });

    expect(countActiveReservations(experiment.id)).toBe(0);

    const reserved = await new AgentOrgExperimentEnrollmentsRepository().reserveAsync({
      maxExposure: experiment.maxExposure,
      runEpisodeId: 'episode-3',
      experimentId: experiment.id,
      proposalId: experiment.proposalId,
      profileId: 'profile-1',
      cohort: 'baseline',
      assignmentDigest: 'digest-3',
      baselineTargetRevisionHash: 'rev-hash-3',
      treatmentSpecHash: 'spec-hash-3',
    });

    expect(reserved).not.toBeNull();
    expect(reserved!.state).toBe('reserved');
    expect(countActiveReservations(experiment.id)).toBe(1);
    expect(countReservations(experiment.id)).toBe(3);
  });
});
