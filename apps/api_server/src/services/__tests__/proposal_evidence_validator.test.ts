/**
 * W6-c1 / W6-c2 / W6-c13 — the versioned proposal evidence bundle and its
 * fail-closed validator.
 *
 * These assert BEHAVIOUR: what the validator admits and what it refuses, and
 * that the refusal names the missing element. Nothing here asserts that a
 * particular function was called.
 */

import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_ADAPTERS,
  PROPOSAL_EVIDENCE_BUNDLE_VERSION,
  type ProposalEvidenceBundle,
} from '../../models/proposal_evidence_bundle';
import { validateEvidenceBundle } from '../proposal_evidence_validator';

/** An otherwise-complete, current-version bundle. Every case mutates a copy. */
export function makeValidBundle(): ProposalEvidenceBundle {
  return {
    version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
    sourceEvidence: { sessionIds: ['ses-1', 'ses-2'], eventIds: ['evt-1'] },
    counterEvidenceSearch: {
      query: 'sessions where the tighter allowlist would have blocked a used tool',
      searchedAt: '2026-08-15T00:00:00.000Z',
      contradictingCount: 0,
    },
    target: { ref: 'agent_configs:cfg-1', hash: 'sha256:abc123' },
    expectedOutcome: 'fewer failed runs on the research profile',
    primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
    guardrails: ['terminal-error-rate must not rise'],
    experimentAdapter: 'paired-cohort-outcome',
    rollbackRule: 'restore before_snapshot_json and set status=reverted',
    generatorVersion: 'scope-hygiene-generator@3',
    confidenceCalibrationVersion: 'calibration@2026-08-01',
  };
}

/** The ten independently-required elements of W6-c1. */
const REQUIRED_ELEMENTS = [
  'sourceEvidence',
  'counterEvidenceSearch',
  'target',
  'expectedOutcome',
  'primaryMetric',
  'guardrails',
  'experimentAdapter',
  'rollbackRule',
  'generatorVersion',
  'confidenceCalibrationVersion',
] as const;

describe('W6-c1 versioned evidence bundle', () => {
  it('admits a complete current-version bundle', () => {
    const result = validateEvidenceBundle(makeValidBundle());
    expect(result.valid).toBe(true);
  });

  it('carries its version in the PERSISTED payload, not implied by code shape', () => {
    const stored = JSON.stringify(makeValidBundle());
    expect(JSON.parse(stored).version).toBe(PROPOSAL_EVIDENCE_BUNDLE_VERSION);
    // An older bundle is recognisable as older rather than reinterpreted.
    const legacy = { ...makeValidBundle(), version: 'proposal-evidence-v0' };
    const result = validateEvidenceBundle(legacy);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reasons.join(' ')).toContain('version');
  });

  it.each(REQUIRED_ELEMENTS)('rejects a bundle missing %s', (element) => {
    const bundle = makeValidBundle() as unknown as Record<string, unknown>;
    delete bundle[element];
    const result = validateEvidenceBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reasons.join(' ')).toContain(element);
  });

  it('permits additional structural fields — this is a floor, not a shape assertion', () => {
    const result = validateEvidenceBundle({
      ...makeValidBundle(),
      id: 'bundle-1',
      created_at: '2026-08-15T00:00:00.000Z',
    });
    expect(result.valid).toBe(true);
  });
});

describe('W6-c2 validator refusals', () => {
  it('rejects a missing target hash naming the hash', () => {
    const bundle = makeValidBundle();
    const result = validateEvidenceBundle({ ...bundle, target: { ref: bundle.target.ref } });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reasons.join(' ')).toContain('target.hash');
  });

  it('rejects a missing outcome metric', () => {
    const bundle = makeValidBundle() as unknown as Record<string, unknown>;
    delete bundle.primaryMetric;
    const result = validateEvidenceBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reasons.join(' ')).toContain('primaryMetric');
  });

  it('rejects an unknown primary metric name — a metric nothing can compute is not a metric', () => {
    const result = validateEvidenceBundle({
      ...makeValidBundle(),
      primaryMetric: { name: 'vibes', direction: 'increase' },
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reasons.join(' ')).toContain('primaryMetric.name');
  });

  it('rejects empty source evidence', () => {
    const result = validateEvidenceBundle({
      ...makeValidBundle(),
      sourceEvidence: { sessionIds: [], eventIds: [] },
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reasons.join(' ')).toContain('sourceEvidence');
  });

  it('rejects an absent counter-evidence search', () => {
    const bundle = makeValidBundle() as unknown as Record<string, unknown>;
    delete bundle.counterEvidenceSearch;
    const result = validateEvidenceBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reasons.join(' ')).toContain('counterEvidenceSearch');
  });

  it('rejects an unsupported adapter against the closed registry', () => {
    const result = validateEvidenceBundle({
      ...makeValidBundle(),
      experimentAdapter: 'vibes-based-adapter',
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reasons.join(' ')).toContain('experimentAdapter');
  });

  it('is TOTAL — a bundle with several omissions reports them all and admits nothing', () => {
    const bundle = makeValidBundle() as unknown as Record<string, unknown>;
    delete bundle.rollbackRule;
    delete bundle.guardrails;
    const result = validateEvidenceBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reasons.length).toBe(2);
  });

  it('rejects a non-object payload rather than best-effort parsing it', () => {
    for (const junk of [null, undefined, 'a string', 42, []]) {
      expect(validateEvidenceBundle(junk).valid).toBe(false);
    }
  });
});

describe('W6-c13 closed adapter registry', () => {
  it('declares for every registered adapter whether it can establish verified improvement', () => {
    for (const adapter of Object.values(EXPERIMENT_ADAPTERS)) {
      expect(typeof adapter.canEstablishVerified).toBe('boolean');
    }
  });

  it('registers all six W6-c6 proxies as non-promoting', () => {
    for (const proxy of [
      'single-replay',
      'usage-count',
      'allowlist-shrink',
      'output-length',
      'regex-disappearance',
      'llm-body-score',
    ]) {
      expect(EXPERIMENT_ADAPTERS[proxy]).toBeDefined();
      expect(EXPERIMENT_ADAPTERS[proxy].canEstablishVerified).toBe(false);
    }
  });

  it('registers at least one adapter that CAN establish verified improvement', () => {
    const promoting = Object.values(EXPERIMENT_ADAPTERS).filter((a) => a.canEstablishVerified);
    expect(promoting.length).toBeGreaterThan(0);
  });
});
