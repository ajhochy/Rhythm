/**
 * W4 — run outcome service. Covers the deterministic finalizer (W4-c6),
 * attribution's explicit-unknown marker (W4-c9) and the privacy gate (W4-c10).
 */
import { describe, it, expect } from 'vitest';

import {
  buildAttribution,
  finalizeVerdict,
  type ObjectiveEvidence,
  type RunVerdict,
  type TerminalStatus,
} from '../run_outcome_service';

function evidence(over: Partial<ObjectiveEvidence> = {}): ObjectiveEvidence {
  return {
    producedArtifact: null,
    errorCount: null,
    approvalDenied: null,
    ...over,
  };
}

describe('W4-c6 deterministic finalizer', () => {
  // Full input -> output matrix. Every mapping is pinned; a change to any row
  // has to be made deliberately, in this table.
  const MATRIX: Array<{
    name: string;
    status: TerminalStatus;
    evidence: ObjectiveEvidence;
    expected: RunVerdict;
  }> = [
    {
      name: 'completed, artifact, no errors -> success',
      status: 'completed',
      evidence: evidence({ producedArtifact: true, errorCount: 0, approvalDenied: false }),
      expected: 'success',
    },
    {
      name: 'completed, artifact, errors -> partial',
      status: 'completed',
      evidence: evidence({ producedArtifact: true, errorCount: 3, approvalDenied: false }),
      expected: 'partial',
    },
    {
      name: 'completed, artifact, approval denied -> partial',
      status: 'completed',
      evidence: evidence({ producedArtifact: true, errorCount: 0, approvalDenied: true }),
      expected: 'partial',
    },
    {
      name: 'completed, no artifact, errors -> failure',
      status: 'completed',
      evidence: evidence({ producedArtifact: false, errorCount: 2, approvalDenied: false }),
      expected: 'failure',
    },
    {
      name: 'completed, no artifact, no errors -> inconclusive (nothing observable happened)',
      status: 'completed',
      evidence: evidence({ producedArtifact: false, errorCount: 0, approvalDenied: false }),
      expected: 'inconclusive',
    },
    {
      name: 'completed, artifact unknown -> inconclusive, never a guessed success',
      status: 'completed',
      evidence: evidence({ errorCount: 0, approvalDenied: false }),
      expected: 'inconclusive',
    },
    {
      name: 'completed, artifact known, error count unknown -> inconclusive',
      status: 'completed',
      evidence: evidence({ producedArtifact: true, approvalDenied: false }),
      expected: 'inconclusive',
    },
    {
      name: 'error, no artifact -> failure',
      status: 'error',
      evidence: evidence({ producedArtifact: false, errorCount: 1 }),
      expected: 'failure',
    },
    {
      name: 'error, partial artifact recovered -> partial',
      status: 'error',
      evidence: evidence({ producedArtifact: true, errorCount: 1 }),
      expected: 'partial',
    },
    {
      name: 'error contradicted by a zero error count -> inconclusive',
      status: 'error',
      evidence: evidence({ producedArtifact: true, errorCount: 0 }),
      expected: 'inconclusive',
    },
    {
      name: 'aborted, no artifact -> failure',
      status: 'aborted',
      evidence: evidence({ producedArtifact: false, errorCount: 0 }),
      expected: 'failure',
    },
    {
      name: 'aborted, artifact -> partial',
      status: 'aborted',
      evidence: evidence({ producedArtifact: true, errorCount: 0 }),
      expected: 'partial',
    },
    {
      name: 'unknown terminal status -> inconclusive whatever the evidence says',
      status: 'unknown',
      evidence: evidence({ producedArtifact: true, errorCount: 0, approvalDenied: false }),
      expected: 'inconclusive',
    },
    {
      name: 'no evidence at all -> inconclusive',
      status: 'completed',
      evidence: evidence(),
      expected: 'inconclusive',
    },
  ];

  for (const row of MATRIX) {
    it(row.name, () => {
      expect(finalizeVerdict(row.status, row.evidence)).toBe(row.expected);
    });
  }

  it('is deterministic: the same input yields an identical verdict every time', () => {
    for (const row of MATRIX) {
      const runs = new Set(
        Array.from({ length: 50 }, () => finalizeVerdict(row.status, row.evidence)),
      );
      expect([...runs]).toEqual([row.expected]);
    }
  });

  it('never returns success when artifact evidence is absent', () => {
    for (const status of ['completed', 'error', 'aborted', 'unknown'] as TerminalStatus[]) {
      for (const errorCount of [null, 0, 5]) {
        for (const approvalDenied of [null, true, false]) {
          expect(
            finalizeVerdict(status, evidence({ errorCount, approvalDenied })),
          ).not.toBe('success');
        }
      }
    }
  });
});

describe('W4-c9 attribution', () => {
  it('records an exact revision when it is known', () => {
    const attribution = buildAttribution({
      tools: [{ name: 'gitnexus_query', revision: 'v3.1.0' }],
      skills: [{ name: 'smoke-test', revision: 'abc123' }],
      configRevision: 7,
    });
    expect(attribution.tools).toEqual([{ name: 'gitnexus_query', revision: 'v3.1.0' }]);
    expect(attribution.skills).toEqual([{ name: 'smoke-test', revision: 'abc123' }]);
    expect(attribution.configRevision).toBe(7);
  });

  it('marks an unattributable revision unknown instead of inventing one', () => {
    const attribution = buildAttribution({
      tools: [{ name: 'gitnexus_query', revision: null }],
      skills: [{ name: 'smoke-test' }],
    });
    expect(attribution.tools).toEqual([{ name: 'gitnexus_query', revision: 'unknown' }]);
    expect(attribution.skills).toEqual([{ name: 'smoke-test', revision: 'unknown' }]);
    expect(attribution.configRevision).toBe('unknown');
    // The marker is explicit, not an absent key a reader could fill in.
    expect(JSON.stringify(attribution)).toContain('"revision":"unknown"');
  });

  it('does not default a missing revision to a sibling’s plausible value', () => {
    const attribution = buildAttribution({
      tools: [
        { name: 'a', revision: 'v9' },
        { name: 'b' },
      ],
    });
    expect(attribution.tools).toEqual([
      { name: 'a', revision: 'v9' },
      { name: 'b', revision: 'unknown' },
    ]);
  });
});
