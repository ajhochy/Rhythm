/**
 * D1.1 (#1426) — ToolSafetyReport model round-trip + closed verdict enum.
 */
import { describe, expect, it } from 'vitest';

import {
  isToolSafetyVerdict,
  toolSafetyReportFromJson,
  toolSafetyReportToJson,
  type ToolSafetyReport,
} from '../tool_safety_report';

describe('D1.1 ToolSafetyReport model', () => {
  const report: ToolSafetyReport = {
    id: 'report-1',
    proposalId: 'proposal-1',
    toolName: 'example-tool',
    toolVersion: '1.2.3',
    packageSource: 'npm:example-tool',
    installMethod: 'npm install',
    sandboxDurationMs: 4200,
    testPromptsRunCount: 3,
    forbiddenPathViolationsJson: '[]',
    networkCallsObservedJson: '[]',
    fileSystemWritesObservedJson: '[]',
    credentialAccessAttemptsCount: 0,
    verdict: 'safe',
    reason: null,
    evidenceJson: '{"sha256":"abc"}',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  };

  it('round-trips losslessly through toJson/fromJson', () => {
    const roundTripped = toolSafetyReportFromJson(toolSafetyReportToJson(report));
    expect(roundTripped).toEqual(report);
  });

  it('isToolSafetyVerdict accepts only the closed enum', () => {
    expect(isToolSafetyVerdict('safe')).toBe(true);
    expect(isToolSafetyVerdict('conditional')).toBe(true);
    expect(isToolSafetyVerdict('unsafe')).toBe(true);
    expect(isToolSafetyVerdict('unknown')).toBe(true);
    expect(isToolSafetyVerdict('super-safe')).toBe(false);
    expect(isToolSafetyVerdict(undefined)).toBe(false);
  });

  it('fromJson defaults an unrecognised verdict to unknown rather than trusting bad input', () => {
    const parsed = toolSafetyReportFromJson({ ...toolSafetyReportToJson(report), verdict: 'bogus' });
    expect(parsed.verdict).toBe('unknown');
  });
});
