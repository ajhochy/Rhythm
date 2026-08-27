import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, 'issue_1479_1482_optimizer_scope_live_e2e.test.ts'),
  'utf8',
);

describe('issue #1482 live harness contract', () => {
  it('fails closed unless two catalog-visible connected servers back the fixture', () => {
    expect(source).toContain('requires two distinct connected API servers mapped to the real engine catalog');
    expect(source).toContain('secondaryTool = choices.find');
  });

  it('diagnoses the unused control eligibility before running the optimizer', () => {
    expect(source).toContain('expect(scopeBytes(ids.control)).toBe(JSON.stringify([secondaryTool.serverName]))');
    expect(source).toContain("expect(qualifyingSessions).toHaveLength(OBSERVED_SESSIONS)");
    expect(source).toContain("expect(outputRows).toHaveLength(OBSERVED_SESSIONS)");
    expect(source).toContain("expect(controlToolEvidence).toEqual({ completed: 0, denied: 0 })");
    expect(source).toContain("expect(existingDedup).toBeUndefined()");
  });

  it('fails closed when the scope optimizer family is disabled', () => {
    expect(source).toContain("expect(disabledFamilies).not.toContain('scope')");
  });

  it('captures the audit run before asserting its nonvacuous result', () => {
    expect(source.indexOf('auditRunId = run.auditRunId')).toBeGreaterThan(-1);
    expect(source.indexOf('expect(run.skipped')).toBeGreaterThan(source.indexOf('auditRunId = run.auditRunId'));
    expect(source).toContain('expect(run.capped).toBe(false)');
    expect(source).toContain('expect(run.proposalsCreated).toBeGreaterThan(0)');
  });

  it('binds proposal assertions and cleanup to the exact audit run', () => {
    expect(source).toContain("expect(proposal.auditRunId).toBe(auditRunId)");
    expect(source).toContain("expect(proposal.kind).toBe('tighten-scope')");
    expect(source).toContain("DELETE FROM agent_org_proposals WHERE audit_run_id = ?");
  });
});
