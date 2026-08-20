import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('C6 calibration remains ranking-only', () => {
  it('task-c6-calibration-c7: auto-apply, risk, promotion, CAS, authorization, and approval gates do not consume calibration', () => {
    for (const relativePath of [
      'src/services/org_optimizer_run_service.ts',
      'src/services/org_proposal_apply.ts',
      'src/services/org_risk_classifier.ts',
      'src/services/org_proposal_experiment_service.ts',
      'src/repositories/agent_org_proposals_repository.ts',
      'src/middleware/auth_middleware.ts',
    ]) {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      expect(source, relativePath).not.toContain('calibratedConfidence');
      expect(source, relativePath).not.toContain('computeCalibrationSnapshotAsync');
    }
  });
});
