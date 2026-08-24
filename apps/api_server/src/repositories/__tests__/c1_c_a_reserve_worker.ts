import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

import { AgentOrgExperimentEnrollmentsRepository } from '../agent_org_experiment_enrollments_repository';

type ReserveWorkerConfig = {
  dbPath: string;
  workerId: string;
  runEpisodeId: string;
  experimentId: string;
  proposalId: string;
  profileId: string;
  cohort: 'baseline' | 'candidate';
  assignmentDigest: string;
  baselineTargetRevisionHash: string;
  treatmentSpecHash: string;
  readyDir: string;
  goFile: string;
  maxExposure: number;
  barrierTimeoutMs: number;
};

async function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function awaitStartSignal(config: ReserveWorkerConfig): Promise<void> {
  const readyPath = path.join(config.readyDir, `${config.workerId}.ready`);
  fs.writeFileSync(readyPath, 'ready');

  const deadline = Date.now() + config.barrierTimeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(config.goFile)) {
      return;
    }
    await waitMs(10);
  }

  throw new Error(`worker ${config.workerId} timed out waiting for start signal`);
}

function toErrorPayload(err: unknown) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      code: (err as { code?: string }).code,
    };
  }

  return {
    name: 'UnknownError',
    message: String(err),
  };
}

async function main() {
  const rawConfig = process.env.C1_C_A_RESERVE_WORKER;
  if (!rawConfig) {
    throw new Error('C1_C_A_RESERVE_WORKER env missing');
  }

  const config = JSON.parse(rawConfig) as ReserveWorkerConfig;

  const db = new Database(config.dbPath);
  db.pragma('foreign_keys = ON');

  let reachedReserveAsync = false;

  try {
    await awaitStartSignal(config);

    const repo = new AgentOrgExperimentEnrollmentsRepository(db);
    reachedReserveAsync = true;
    const result = await repo.reserveAsync({
      maxExposure: config.maxExposure,
      runEpisodeId: config.runEpisodeId,
      experimentId: config.experimentId,
      proposalId: config.proposalId,
      profileId: config.profileId,
      cohort: config.cohort,
      assignmentDigest: config.assignmentDigest,
      baselineTargetRevisionHash: config.baselineTargetRevisionHash,
      treatmentSpecHash: config.treatmentSpecHash,
    });

    if (result === null) {
      console.log(
        JSON.stringify({
          workerId: config.workerId,
          outcome: 'refused',
          reachedReserveAsync,
          reservation: null,
        }),
      );
      return;
    }

    console.log(
      JSON.stringify({
        workerId: config.workerId,
        outcome: 'reserved',
        reachedReserveAsync,
        reservation: {
          id: result.id,
          runEpisodeId: result.runEpisodeId,
          experimentId: result.experimentId,
          proposalId: result.proposalId,
          profileId: result.profileId,
          cohort: result.cohort,
          assignmentDigest: result.assignmentDigest,
          baselineTargetRevisionHash: result.baselineTargetRevisionHash,
          treatmentSpecHash: result.treatmentSpecHash,
          state: result.state,
          reservedAt: result.reservedAt,
        },
      }),
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        workerId: config.workerId,
        outcome: 'error',
        reachedReserveAsync,
        reservation: null,
        error: toErrorPayload(err),
      }),
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.log(
    JSON.stringify({
      workerId: 'unknown',
      outcome: 'error',
      reachedReserveAsync: false,
      reservation: null,
      error: {
        name: err instanceof Error ? err.name : 'UnknownError',
        message: err instanceof Error ? err.message : String(err),
        code: err instanceof Error ? (err as { code?: string }).code : undefined,
      },
    }),
  );
});
