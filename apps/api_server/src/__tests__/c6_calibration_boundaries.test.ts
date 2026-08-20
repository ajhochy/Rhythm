import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { CalibrationObservationsRepository } from '../repositories/calibration_observations_repository';
import { computeCalibrationSnapshotAsync } from '../services/calibration_snapshot_service';
import { classifyProposalRisk, requiresSecurityNote } from '../services/org_risk_classifier';

describe('C6 calibration remains ranking-only', () => {
  it('task-c6-calibration-c7: auto-apply, risk, promotion, CAS, authorization, and approval gates do not consume calibration', () => {
    const roots = ['src/services', 'src/repositories', 'src/middleware', 'src/controllers'];
    const allowed = new Set([
      'src/services/calibration_snapshot_service.ts',
      'src/services/proposal_experiment_summary_service.ts',
      'src/controllers/org_proposals_controller.ts',
    ]);
    const productionFiles: string[] = [];
    const visit = (relativePath: string): void => {
      const absolutePath = resolve(process.cwd(), relativePath);
      if (statSync(absolutePath).isDirectory()) {
        for (const entry of readdirSync(absolutePath)) visit(`${relativePath}/${entry}`);
        return;
      }
      if (relativePath.endsWith('.ts') && !relativePath.includes('/__tests__/') && !relativePath.endsWith('.test.ts')) {
        productionFiles.push(relativePath);
      }
    };
    for (const root of roots) visit(root);

    for (const relativePath of productionFiles.filter((path) => !allowed.has(path))) {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      expect(source, relativePath).not.toContain('calibratedConfidence');
      expect(source, relativePath).not.toContain('calibrationStatus');
      expect(source, relativePath).not.toContain('computeCalibrationSnapshotAsync');
      expect(source, relativePath).not.toContain('buildExperimentSummaryAsync');
      expect(source, relativePath).not.toContain('attachExperimentSummariesAsync');
    }
  });

  it('keeps observable risk and human-gate classification identical after a family becomes calibrated', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const originalEnabled = env.calibrationEnabled;
    env.calibrationEnabled = true;
    const input = { kind: 'refine-skill', changeJson: '{}' };
    const before = {
      risk: classifyProposalRisk(input),
      securityNote: requiresSecurityNote(input.kind),
    };
    const repo = new CalibrationObservationsRepository();
    for (let index = 0; index < 5; index += 1) {
      await repo.createAsync({
        scope: { kind: 'system-global' },
        sourceEventId: `ranking-only-${index}`,
        observationType: 'experiment-decision',
        proposalId: `proposal-${index}`,
        generatorVersion: 'gen-v1',
        detectorVersion: 'det-v1',
        kind: 'refine-skill',
        treatmentVersion: 'system-prompt-v1',
        metricVersion: 'metric-v1',
        initialConfidence: 0.8,
        humanDecision: 'approve',
        experimentDecision: 'promote',
      });
    }
    const snapshot = await computeCalibrationSnapshotAsync(
      {
        generatorVersion: 'gen-v1',
        detectorVersion: 'det-v1',
        kind: 'refine-skill',
        treatmentVersion: 'system-prompt-v1',
        metricVersion: 'metric-v1',
      },
      { kind: 'system-global' },
    );
    expect(snapshot.status).toBe('calibrated');
    expect({
      risk: classifyProposalRisk(input),
      securityNote: requiresSecurityNote(input.kind),
    }).toEqual(before);
    env.calibrationEnabled = originalEnabled;
    db.close();
  });
});
