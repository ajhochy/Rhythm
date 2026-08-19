/**
 * C5-1 — the normalized immutable behavioral fact view (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C5, requirement 1).
 *
 * Proves the view is a faithful, safe-only projection of the existing W4
 * ledger row: stable factId, source session/event identity, detector
 * version, profile/config revision, fact family, evidence availability, and
 * only closed enum/aggregate values — never raw content (the ledger row
 * never carries any, so this is a structural guarantee, not a redaction
 * step).
 */

import { describe, expect, it } from 'vitest';

import type { AgentRunOutcome } from '../agent_run_outcome';
import {
  BEHAVIORAL_FACT_FAMILIES,
  RUN_OUTCOME_DETECTOR_VERSION,
  behavioralFactFromRunOutcome,
} from '../behavioral_fact';

function outcome(overrides: Partial<AgentRunOutcome> = {}): AgentRunOutcome {
  return {
    id: 'out-1',
    rootSessionId: 'ses-root',
    sessionId: 'ses-child',
    runEpisodeId: null,
    scheduledOccurrenceId: null,
    experimentVariant: null,
    proposalId: null,
    profileId: 'church-admin',
    configRevision: 4,
    terminalStatus: 'completed',
    objectiveVerdict: 'success',
    objectiveEvidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    attribution: { v: 1, tools: [], skills: [], configRevision: 4 },
    finalizedAt: '2026-08-18T00:00:00.000Z',
    createdAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('C5-1 behavioralFactFromRunOutcome', () => {
  it('carries a stable factId equal to the immutable ledger row id', () => {
    const fact = behavioralFactFromRunOutcome(outcome({ id: 'out-42' }));
    expect(fact.factId).toBe('out-42');
  });

  it('names a fact family from the closed registry and the detector that produced it', () => {
    const fact = behavioralFactFromRunOutcome(outcome());
    expect(BEHAVIORAL_FACT_FAMILIES).toContain(fact.factFamily);
    expect(fact.detectorVersion).toBe(RUN_OUTCOME_DETECTOR_VERSION);
  });

  it('carries profileId/configRevision straight from the ledger row', () => {
    const fact = behavioralFactFromRunOutcome(outcome({ profileId: 'worship-planning', configRevision: 9 }));
    expect(fact.profileId).toBe('worship-planning');
    expect(fact.configRevision).toBe(9);
  });

  it('dedupes root and child session ids into sourceSessionIds', () => {
    const fact = behavioralFactFromRunOutcome(outcome({ rootSessionId: 'ses-1', sessionId: 'ses-1' }));
    expect(fact.sourceSessionIds).toEqual(['ses-1']);
  });

  it('records sourceEventIds bound to this fact (the ledger row itself)', () => {
    const fact = behavioralFactFromRunOutcome(outcome({ id: 'out-7' }));
    expect(fact.sourceEventIds).toEqual(['out-7']);
  });

  it('marks evidenceAvailable=false when both producedArtifact and errorCount are absent (never guessed)', () => {
    const fact = behavioralFactFromRunOutcome(
      outcome({ objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null } }),
    );
    expect(fact.evidenceAvailable).toBe(false);
  });

  it('marks evidenceAvailable=true when at least one objective evidence field is observed', () => {
    const fact = behavioralFactFromRunOutcome(
      outcome({ objectiveEvidence: { producedArtifact: null, errorCount: 2, approvalDenied: null } }),
    );
    expect(fact.evidenceAvailable).toBe(true);
  });

  it('carries only closed enum/aggregate values in `aggregate` — never a raw content field', () => {
    const fact = behavioralFactFromRunOutcome(
      outcome({ terminalStatus: 'error', objectiveVerdict: 'failure', objectiveEvidence: { producedArtifact: false, errorCount: 3, approvalDenied: false } }),
    );
    expect(fact.aggregate).toEqual({
      terminalStatus: 'error',
      objectiveVerdict: 'failure',
      producedArtifact: false,
      errorCount: 3,
    });
    expect(Object.keys(fact.aggregate).sort()).toEqual(
      ['errorCount', 'objectiveVerdict', 'producedArtifact', 'terminalStatus'].sort(),
    );
  });
});
