import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
});
